import { openConnection,sealConnection } from "./allegro-api";
import { syncAuthorization,syncConnections,type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb,syncRows,syncJson,SyncDbError } from "./sales-sync-store";
import { ovokoConnectionKey } from "./ovoko-connection";
import { OvokoError,ovokoPageData,parseOvokoRead } from "./ovoko-read";
import { ovokoPublicationPresent } from "./ovoko-publication-presence";
import { preferredOvokoCar } from "./ovoko-car-selection";
type Data=Record<string,unknown>;
type Proof={id:string;owner:string;kind:"part"|"vehicle";offer:string;seller:string;account:string;fingerprint:string;client:string;brand:string|null;model:string|null;year:string|null;row:Data;foundId?:string|null;expires:number};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const positive=(v:unknown):v is string=>typeof v==="string"&&/^[1-9]\d{0,11}$/.test(v);
export function overrideDatabaseError(error:unknown,path:string):OvokoError {
 const stage=path.startsWith("rpc/")?"zapis decyzji":path.startsWith("ovoko_single_publications?")||path.startsWith("ovoko_vehicle_creations?")?"odczyt blokady":"kontrola konta";
 if(error instanceof SyncDbError){
  const reasons:Record<string,string>={"physical account ownership conflict":"Te konta sa przypisane do synchronizacji innego konta Wystawiacza. Nie zmieniono wlasciciela synchronizacji.","link recovery pending":"Trwa osobne odzyskiwanie powiazan. Zakoncz lub anuluj jego plan.","synchronization check in progress":"Wlasnie trwa kontrola synchronizacji tych kont. Sprobuj po jej zakonczeniu.","pending sale action for this offer":"Dla tej konkretnej oferty trwa lub pozostala niepewna operacja sprzedazy. Nie wolno jej ponownie wystawic przed wyjasnieniem.","connection changed":"Polaczenie konta zmienilo sie podczas operacji. Sprawdz ponownie.","operation too recent":"Poprzednia wysylka jest mlodsza niz 30 minut. Nie przerwano jej.","operation changed":"Blokada zmienila sie podczas sprawdzania. Sprawdz ja ponownie.","no stale attempt to release":"Nie ma zapisanej proby do zwolnienia lub jej stan jest nieprawidlowy. Sprawdz wynik oferty ponownie.","pause synchronization and settle writes":"Baza ma starsza wersje odblokowania wymagajaca zatrzymania synchronizacji.","conflicting part ids":"Ovoko i rejestr wskazuja rozne ID czesci. Nie nadpisano powiazania."};
  const missing=error.databaseCode&&["42883","42P01","42703","PGRST202","PGRST204","PGRST205"].includes(error.databaseCode);
  const vehicleBusy=error.databaseReason==="vehicle operation in progress";
  const vehicleFunctionMissing=path==="rpc/release_ovoko_vehicle_attempt"&&["42883","PGRST202"].includes(error.databaseCode||"");
  const message=vehicleBusy?"Tworzenie auta jeszcze trwa. Nie przerwano wysylki; sprawdz ponownie po 5 minutach.":vehicleFunctionMissing?"Baza nie ma jeszcze poprawki odblokowania aut (025). Wklej poprawke SQL w Supabase; sam Push origin nie aktualizuje bazy.":error.databaseReason?reasons[error.databaseReason]:missing?`W bazie brakuje ${path==="rpc/release_stale_ovoko_attempt"?"funkcji zwalniania starej proby. Wymagana jednorazowa poprawka bazy":"wymaganej funkcji, tabeli lub kolumny"}.`:error.databaseCode==="42501"?"Serwer bazy odmowil uprawnien do odblokowania.":"Baza nie potwierdzila operacji. Nie uznano tego automatycznie za brak migracji.";
  return new OvokoError(409,`${message} Etap: ${stage}. Kod bazy: ${error.databaseCode||`HTTP ${error.databaseStatus}`}. Nie wyslano czesci.`,"override_database");
 }
 return new OvokoError(503,`Utracono odpowiedz bazy (etap: ${stage}). Sprawdz wynik przed ponowieniem; nie wyslano czesci.`,"override_transport");
}
async function inspect(c:Awaited<ReturnType<typeof syncConnections>>,p:Proof,brand:unknown){
 if(p.kind==="part"){
  const external=`tymo:${c.sellerId}:${p.offer}`;
  const page=ovokoPageData(await c.ovoko(`/v2/get/parts?external_ids=${encodeURIComponent(external)}&page=1&limit=2`),{page:1,limit:2},"override.external");
  if(page.pagination.total>1||page.data.some(r=>r.external_id!==external))throw new OvokoError(409,"Kilka czesci lub niezgodne powiazanie w Ovoko. Najpierw wyjasnij duplikaty recznie.");
  if(page.pagination.total===1&&page.data.length===1){
   const found=String(page.data[0].id);if(!positive(found)||p.row.part_id&&p.row.part_id!==found)throw new OvokoError(409,"Znalezione i zapisane ID czesci sa rozne. Nie zwalniamy tej blokady.");return found;
  }
  if(page.pagination.total!==0||page.data.length)throw new OvokoError(502,"Nie potwierdzono odczytu Ovoko.");
  if(p.row.part_id&&await ovokoPublicationPresent(c.ovoko,String(p.row.part_id),external))throw new OvokoError(409,"Czesc lub zapisane ID nadal istnieje w Ovoko. Nie tworzymy jej drugi raz; sprawdz powiazanie.");
  return null;
 }
 if(!positive(brand)||!p.model||!p.year)throw new OvokoError(400,"Najpierw wybierz marke, model i rok w formularzu.");
 const models=parseOvokoRead("models",await c.ovoko(`/get/car_models/${brand}`),brand).rows;
 const model=models.find(r=>r.id===p.model);if(!model)throw new OvokoError(409,"Model nie nalezy do wybranej marki.");
 const range=model.years?.match(/^(\d{4})? - (\d{4})?$/);
 if(range&&(range[1]&&Number(p.year)<Number(range[1])||range[2]&&Number(p.year)>Number(range[2])))throw new OvokoError(400,"Rok nie pasuje do modelu.");
 const rows=parseOvokoRead("cars",await c.ovoko(`/v2/get/cars?model_ids=${p.model}&page=1&limit=20`),p.model).rows;
 const found=preferredOvokoCar(rows,p.year);
 if(found&&!positive(found.id))throw new OvokoError(502,"Ovoko zwrocilo nieprawidlowe ID auta. Nie odblokowano zapisu i nie wyslano czesci.");
 return found?.id||null;
}
export async function manualOvokoOverride(owner:string,env:SalesSyncEnv,input:Data){
 const operation=input.operation;
 const allowed=operation==="check"?["operation","kind","offerId","brandId","modelId","year","binding"]:["operation","token","brandId","confirmRisk","checkedOvoko","typedOfferId","reason","confirmManual"];
 if(!["check","confirm"].includes(String(operation))||Object.keys(input).some(k=>!allowed.includes(k)))throw new OvokoError(400,"Nieprawidlowe reczne rozstrzygniecie.");
 const raw=salesSyncDb(env),db:typeof raw=async(path,init)=>{try{return await raw(path,init);}catch(error){throw overrideDatabaseError(error,path);}};
 const c=await syncConnections(db,owner,env),key=await ovokoConnectionKey(env),aad=`ovoko-manual-override:${owner}`;
 if(operation==="check"&&input.binding!==undefined){
  const binding=input.binding as Data|null;
  if(!binding||typeof binding!=="object"||Array.isArray(binding)||Object.keys(binding).some(k=>!["sellerId","fingerprint"].includes(k))||binding.sellerId!==c.sellerId||binding.fingerprint!==c.fingerprint)throw new OvokoError(409,"Konto Allegro lub Ovoko zmienilo sie od rozpoczecia partii. Nie odblokowano auta.","account_changed");
 }
 let p:Proof;
 if(operation==="check"){
  if(!["part","vehicle"].includes(String(input.kind))||typeof input.offerId!=="string"||!/^\d{1,30}$/.test(input.offerId))throw new OvokoError(400,"Wybierz rodzaj blokady i aukcje.");
  const vehicle=input.kind==="vehicle";
  if(vehicle&&(!positive(input.brandId)||!positive(input.modelId)||typeof input.year!=="string"||!/^[12]\d{3}$/.test(input.year)||Number(input.year)<1886||Number(input.year)>new Date().getUTCFullYear()+1))throw new OvokoError(400,"Wybierz model i rok auta.");
  const table=vehicle?`ovoko_vehicle_creations?ovoko_account=eq.${c.account}&model_id=eq.${input.modelId}&vehicle_year=eq.${input.year}`:`ovoko_single_publications?ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&allegro_offer_id=eq.${input.offerId}`;
  const rows=syncRows<Data>(await db(`${table}&select=*`)),row=rows[0]||{};
  if(rows.length>1||rows.length===1&&(!["sending","uncertain","created"].includes(String(row.state))||typeof row.owner_id!=="string"||!uuid.test(row.owner_id)||typeof row.updated_at!=="string"||!Number.isFinite(Date.parse(row.updated_at))))throw new OvokoError(409,"Nieprawidlowy rejestr. Sprawdz migracje 012/013 i uprawnienia zapisu.");
  p={id:crypto.randomUUID(),owner,kind:vehicle?"vehicle":"part",offer:input.offerId,seller:c.sellerId,account:c.account,fingerprint:c.fingerprint,client:c.clientId,brand:vehicle?String(input.brandId):null,model:vehicle?String(input.modelId):null,year:vehicle?String(input.year):null,row,expires:Date.now()+300000};
 }else{
  if(input.confirmManual!==undefined&&input.confirmManual!==true)throw new OvokoError(400,"Potwierdz reczne odblokowanie.");
  if(typeof input.token!=="string"||input.token.length>16000||input.confirmManual!==true&&(input.confirmRisk!==true||input.checkedOvoko!==true||typeof input.reason!=="string"||input.reason.trim().length<10||input.reason.length>1000))throw new OvokoError(400,"Potwierdz reczne odblokowanie i ryzyko duplikatu.");
  try{p=await openConnection<Proof>(input.token,key,aad);}catch{throw new OvokoError(409,"Nieprawidlowy podglad. Sprawdz blokade ponownie.");}
  if(p.owner!==owner||p.seller!==c.sellerId||p.account!==c.account||p.fingerprint!==c.fingerprint||p.client!==c.clientId||!uuid.test(p.id)||p.expires<Date.now()||p.expires>Date.now()+300000||input.confirmManual!==true&&input.typedOfferId!==p.offer)throw new OvokoError(409,"Podglad wygasl lub zmienily sie konta. Sprawdz ponownie.");
  const prior=syncRows<Data>(await db(`ovoko_manual_overrides?id=eq.${p.id}&owner_id=eq.${owner}&select=kind,action,found_id`));
  if(prior.length===1)return{resolved:true,kind:prior[0].kind,action:prior[0].action,foundId:prior[0].found_id,modelId:p.model,year:p.year,message:"Ta decyzja zostala juz zapisana. Nie ponowiono zadnej wysylki."};
 }
 const owned=await c.allegro(`/sale/offers?offer.id=${p.offer}&limit=1`);
 if(!Array.isArray(owned.offers)||owned.offers.length!==1||(owned.offers[0]as Data).id!==p.offer)throw new OvokoError(409,"Nie potwierdzono aukcji na Twoim koncie Allegro.");
 if(p.kind==="vehicle"&&input.brandId!==p.brand)throw new OvokoError(409,"Marka zmienila sie. Sprawdz blokade ponownie.");
 const found=await inspect(c,p,p.brand);
 if(!found&&Object.keys(p.row).length){
  const age=Date.now()-Date.parse(String(p.row.updated_at));
  if(p.kind==="part"&&age<1800000)throw new OvokoError(409,"Proba jest mlodsza niz 30 minut i moze jeszcze trwac. Nie odblokowujemy trwajacych wysylek.");
  if(p.kind==="vehicle"&&p.row.state==="sending"&&age<300000)throw new OvokoError(409,"Tworzenie auta jest w toku lub utracono jego odpowiedz przed chwila. Nie przerywamy trwajacego zapisu; sprawdz ponownie po 5 minutach.","vehicle_in_progress");
 }
 if(operation==="confirm"&&p.foundId!==found)throw new OvokoError(409,"Wynik odczytu Ovoko zmienil sie. Sprawdz blokade ponownie; niczego nie wyslano.");
 if(operation==="check"&&p.kind==="vehicle"&&found)return{resolved:true,kind:"vehicle",foundId:found,modelId:p.model,year:p.year,message:`Potwierdzono zapisane auto ID ${found}. Uzyjemy go bez tworzenia drugiego i bez zmiany wlasciciela synchronizacji.`};
 if(operation==="check"&&!Object.keys(p.row).length){
  if(p.kind!=="part"||!found)return{resolved:true,kind:p.kind,foundId:found,message:found?`Znaleziono auto ID ${found}. Nie ma blokady; kliknij Wystaw.`:"Nie ma zapisanej blokady. Mozesz ponownie kliknac Wystaw; oferty nie wyslano automatycznie."};
 }
 if(operation==="check")p.foundId=found;
 if(operation==="check")return{token:await sealConnection(p,key,aad),kind:p.kind,offerId:p.offer,modelId:p.model,year:p.year,foundId:found,message:found?`Znaleziono istniejacy rekord ${p.kind==="part"?"czesci":"auta"} ID ${found}. Zamiast tworzyc duplikat, potwierdzenie naprawi rejestr.`:p.kind==="vehicle"?"Nie znaleziono auta z tym rokiem na pierwszej stronie (do 20). Sprawdz recznie pozostale auta. Potwierdzenie zwolni stara blokade, bez tworzenia auta.":"Nie znaleziono powiazanej czesci. Nie jest to gwarancja braku fizycznego duplikatu, zwlaszcza po utracie odpowiedzi importu. Sprawdz recznie wszystkie statusy Ovoko."};
 await syncAuthorization(db,owner,env);
 const reason=input.confirmManual===true?"Reczne odblokowanie potwierdzone przez uzytkownika; zaakceptowano ryzyko duplikatu.":String(input.reason).trim();
 const staleOnly=!found&&["sending","uncertain","created"].includes(String(p.row.state));
 const decision=syncJson({p_owner:owner,p_id:p.id,p_kind:p.kind,p_account:p.account,p_seller:p.seller,p_offer:p.offer,p_model:p.model,p_year:p.year,p_expected:p.row,p_found:found,p_reason:reason,p_allegro:c.allegroSealed,p_ovoko:c.ovokoSealed});
 let applied:unknown;
 const endpoint=p.kind==="vehicle"&&!found?"rpc/release_ovoko_vehicle_attempt":"rpc/apply_ovoko_manual_override";
 try{applied=await raw(endpoint,decision);}
 catch(error){
  // Only a known rolled-back guard failure permits the narrower release. Never retry a lost acknowledgement.
  if(p.kind==="part"&&staleOnly&&error instanceof SyncDbError&&error.databaseCode==="P0001"&&["physical account ownership conflict","pause synchronization and settle writes"].includes(error.databaseReason||"")) applied=await db("rpc/release_stale_ovoko_attempt",decision);
  else throw overrideDatabaseError(error,endpoint);
 }
 const rows=syncRows<Data>(applied);
 if(rows.length!==1||rows[0].id!==p.id)throw new OvokoError(503,"Nie potwierdzono zapisu decyzji. Sprawdz status przed kolejna proba; nie wyslano czesci.");
 return{resolved:true,kind:p.kind,action:rows[0].action,foundId:found,modelId:p.model,year:p.year,message:found?"Naprawiono rejestr istniejacego rekordu. Niczego nie utworzono i nie zmieniono Allegro.":"Zwolniono stara blokade na Twoje jawne zlecenie, zachowujac historie. Niczego nie wystawiono. Sprawdz formularz i osobno kliknij Wystaw; wszystkie kontrole danych nadal obowiazuja."};
}
