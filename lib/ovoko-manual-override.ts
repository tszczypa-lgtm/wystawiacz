import { openConnection,sealConnection } from "./allegro-api";
import { syncAuthorization,syncConnections,type SalesSyncEnv } from "./sales-sync-connections";
import { salesSyncDb,syncRows,syncJson } from "./sales-sync-store";
import { ovokoConnectionKey } from "./ovoko-connection";
import { OvokoError,ovokoPageData,parseOvokoRead } from "./ovoko-read";
import { ovokoPublicationPresent } from "./ovoko-publication-presence";
import { inventoryLinkRecovery } from "./inventory-link-recovery";
type Data=Record<string,unknown>;
type Proof={id:string;owner:string;kind:"part"|"vehicle";offer:string;seller:string;account:string;fingerprint:string;client:string;brand:string|null;model:string|null;year:string|null;row:Data;planId?:string;expires:number};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const positive=(v:unknown):v is string=>typeof v==="string"&&/^[1-9]\d{0,11}$/.test(v);
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
 const found=rows.filter(r=>r.years===p.year).sort((a,b)=>Number(a.id)-Number(b.id))[0];
 return found?.id||null;
}
export async function manualOvokoOverride(owner:string,env:SalesSyncEnv,input:Data){
 const operation=input.operation;
 const allowed=operation==="check"?["operation","kind","offerId","brandId","modelId","year"]:["operation","token","brandId","confirmRisk","checkedOvoko","typedOfferId","reason","confirmManual"];
 if(!["check","confirm"].includes(String(operation))||Object.keys(input).some(k=>!allowed.includes(k)))throw new OvokoError(400,"Nieprawidlowe reczne rozstrzygniecie.");
 const raw=salesSyncDb(env),db:typeof raw=async(path,init)=>{try{return await raw(path,init);}catch{throw new OvokoError(409,"Nie potwierdzono recznego rozstrzygniecia. Wymagana migracja 021; sprawdz wlasciciela kont, wylaczenie obu kierunkow synchronizacji oraz trwajace operacje. Nie ponowiono wysylki.");}};
 const c=await syncConnections(db,owner,env),key=await ovokoConnectionKey(env),aad=`ovoko-manual-override:${owner}`;
 let p:Proof;
 if(operation==="check"){
  if(!["part","vehicle"].includes(String(input.kind))||typeof input.offerId!=="string"||!/^\d{1,30}$/.test(input.offerId))throw new OvokoError(400,"Wybierz rodzaj blokady i aukcje.");
  const vehicle=input.kind==="vehicle";
  if(vehicle&&(!positive(input.brandId)||!positive(input.modelId)||typeof input.year!=="string"||!/^[12]\d{3}$/.test(input.year)||Number(input.year)<1886||Number(input.year)>new Date().getUTCFullYear()+1))throw new OvokoError(400,"Wybierz model i rok auta.");
  const table=vehicle?`ovoko_vehicle_creations?ovoko_account=eq.${c.account}&model_id=eq.${input.modelId}&vehicle_year=eq.${input.year}`:`ovoko_single_publications?ovoko_account=eq.${c.account}&allegro_seller_id=eq.${c.sellerId}&allegro_offer_id=eq.${input.offerId}`;
  const rows=syncRows<Data>(await db(`${table}&select=*`)),row=rows[0]||{};
  if(rows.length>1||rows.length===1&&(!["sending","uncertain","created"].includes(String(row.state))||typeof row.owner_id!=="string"||!uuid.test(row.owner_id)||typeof row.updated_at!=="string"||!Number.isFinite(Date.parse(row.updated_at))))throw new OvokoError(409,"Nieprawidlowy rejestr. Sprawdz migracje 012/013 i uprawnienia zapisu.");
  if(rows.length&&Date.now()-Date.parse(String(row.updated_at))<1800000)throw new OvokoError(409,"Proba jest mlodsza niz 30 minut i moze jeszcze trwac. Nie odblokowujemy trwajacych wysylek.");
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
 if(operation==="check"&&!Object.keys(p.row).length){
  if(p.kind==="part"&&found){
   const plan=await inventoryLinkRecovery(owner,env,{operation:"check",offerId:p.offer,partId:found});
   if("alreadyLinked" in plan&&plan.alreadyLinked)return{resolved:true,kind:p.kind,foundId:found,message:`Ta czesc jest juz w Ovoko (ID ${found}). Powiazanie jest poprawne; nie tworzymy drugiej.`};
   if(!("id" in plan)||typeof plan.id!=="string"||!uuid.test(plan.id))throw new OvokoError(503,"Nie potwierdzono naprawy powiazania. Nie wyslano czesci.");
   p.planId=plan.id;
  }else return{resolved:true,kind:p.kind,foundId:found,message:found?`Znaleziono auto ID ${found}. Nie ma blokady; kliknij Wystaw.`:"Nie ma zapisanej blokady. Mozesz ponownie kliknac Wystaw; oferty nie wyslano automatycznie."};
 }
 if(operation==="check")return{token:await sealConnection(p,key,aad),kind:p.kind,offerId:p.offer,modelId:p.model,year:p.year,foundId:found,message:found?`Znaleziono istniejacy rekord ${p.kind==="part"?"czesci":"auta"} ID ${found}. Zamiast tworzyc duplikat, potwierdzenie naprawi rejestr.`:p.kind==="vehicle"?"Nie znaleziono auta z tym rokiem na pierwszej stronie (do 20). Sprawdz recznie pozostale auta. Potwierdzenie zwolni stara blokade, bez tworzenia auta.":"Nie znaleziono powiazanej czesci. Nie jest to gwarancja braku fizycznego duplikatu, zwlaszcza po utracie odpowiedzi importu. Sprawdz recznie wszystkie statusy Ovoko."};
 if(p.planId){
  const applied=await inventoryLinkRecovery(owner,env,{operation:"confirm",planId:p.planId,confirm:true});
  if(!("state" in applied)||applied.state!=="applied")throw new OvokoError(503,"Nie potwierdzono naprawy powiazania.");
  return{resolved:true,kind:"part",foundId:found,message:`Naprawiono powiazanie z czescia Ovoko ID ${found}. Ona juz tam jest; nie utworzono duplikatu. Kliknij Wystaw, aby odswiezyc wynik.`};
 }
 await syncAuthorization(db,owner,env);
 const reason=input.confirmManual===true?"Reczne odblokowanie potwierdzone przez uzytkownika; zaakceptowano ryzyko duplikatu.":String(input.reason).trim();
 const rows=syncRows<Data>(await db("rpc/apply_ovoko_manual_override",syncJson({p_owner:owner,p_id:p.id,p_kind:p.kind,p_account:p.account,p_seller:p.seller,p_offer:p.offer,p_model:p.model,p_year:p.year,p_expected:p.row,p_found:found,p_reason:reason,p_allegro:c.allegroSealed,p_ovoko:c.ovokoSealed})));
 if(rows.length!==1||rows[0].id!==p.id)throw new OvokoError(503,"Nie potwierdzono zapisu decyzji. Sprawdz status przed kolejna proba; nie wyslano czesci.");
 return{resolved:true,kind:p.kind,action:rows[0].action,foundId:found,modelId:p.model,year:p.year,message:found?"Naprawiono rejestr istniejacego rekordu. Niczego nie utworzono i nie zmieniono Allegro.":"Zwolniono stara blokade na Twoje jawne zlecenie, zachowujac historie. Niczego nie wystawiono. Sprawdz formularz i osobno kliknij Wystaw; wszystkie kontrole danych nadal obowiazuja."};
}
