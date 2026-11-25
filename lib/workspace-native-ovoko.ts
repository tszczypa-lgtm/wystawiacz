import {accountContext} from "./account-api";
import {openConnection,sealConnection} from "./allegro-api";
import {requireOvokoAccess} from "./ovoko-access";
import {loadOvokoConnection,ovokoConnectionKey} from "./ovoko-connection";
import {bulkOvokoPart} from "./ovoko-bulk";
import type {OvokoPublishEnv} from "./ovoko-publish";
import {additionalOvokoCodes,type OvokoSourcePreview} from "./ovoko-preparation";
import {OvokoError,parseOvokoRead,ovokoPageData} from "./ovoko-read";
import {suggestOvokoCategories} from "./ovoko-suggestions";
import {ovokoWriteClient,ovokoWriteDigest} from "./ovoko-write-client";
import {workspaceVehicleId} from "./workspace-vehicles";
import {workspaceVehicleOvoko} from "./workspace-vehicle-ovoko";

type Context=Awaited<ReturnType<typeof accountContext>>;
type Prepared={brandId:string;modelId:string;donorId:string;categoryId:string;qualityId:string;statusId:string;manufacturerCode:string;additionalCodes:string};
type Ticket={hash:string;fingerprint:string;prepared:Prepared;expires:number};
export function nativeOvokoSource(value:unknown):OvokoSourcePreview{
 const row=value as Record<string,unknown>;
 if(!row||typeof row!=="object"||Array.isArray(row)||Object.keys(row).some(k=>!["title","notes","images","stock","condition","number","price","currency"].includes(k))||typeof row.title!=="string"||!row.title.trim()||row.title.length>500||typeof row.notes!=="string"||row.notes.length>40000||/\0/.test(row.notes)||typeof row.number!=="string"||row.number.length>255||!Number.isSafeInteger(row.stock)||Number(row.stock)<1||Number(row.stock)>10000||!["used","new","damaged","restored"].includes(String(row.condition))||typeof row.price!=="string"||!/^\d{1,7}(\.\d{1,2})?$/.test(row.price)||Number(row.price)<=0||!["PLN","EUR"].includes(String(row.currency))||!Array.isArray(row.images)||!row.images.length||row.images.length>50)throw new OvokoError(400,"Sprawdz tytul, cene Ovoko, sztuki i zdjecia.");
 const images=row.images.map(value=>{
  if(typeof value!=="string"||value.length>2000)throw new OvokoError(400,"Nieprawidlowe zdjecie.");
  let url:URL;try{url=new URL(value);}catch{throw new OvokoError(400,"Nieprawidlowy adres zdjecia.");}
  if(url.protocol!=="https:"||url.username||url.password||!url.hostname.endsWith(".allegroimg.com"))throw new OvokoError(400,"Zdjecia musza pochodzic z bezpiecznego uploadu formularza.");
  return url.href;
 });
 return {id:"0",title:row.title.trim(),description:row.notes,images:[...new Set(images)],stock:Number(row.stock),condition:row.condition as OvokoSourcePreview["condition"],price:row.price,currency:String(row.currency),parameters:row.number?[{id:"",name:"Numer katalogowy czesci",values:[row.number]}]:[],skippedImages:0,rejectedImages:0,duplicateImages:0,status:"ACTIVE",categoryId:"",shippingRateId:"",externalId:"",suggestedCode:row.number,bundle:false};
}
export async function workspaceOvokoCategory(env:OvokoPublishEnv,context:Context,input:Record<string,unknown>){
 if(Object.keys(input).some(k=>k!=="title")||typeof input.title!=="string"||input.title.length>500)throw new OvokoError(400,"Nieprawidlowy tytul.");
 const credentials=await loadOvokoConnection(context,await ovokoConnectionKey(env));
 const rows=parseOvokoRead("categories",await ovokoWriteClient(credentials)("/get/categories")).rows;
 const suggested=suggestOvokoCategories(input.title,rows).find(row=>rows.some(item=>item.id===row.id&&item.level==="3"));
 return {category:suggested?{id:suggested.id,name:rows.find(row=>row.id===suggested.id)!.name}:null};
}
export async function workspaceNativeOvoko(request:Request,env:OvokoPublishEnv,context:Context,input:Record<string,unknown>){
 try{return await nativeDraft(request,env,context,input);}catch(error){if(error instanceof OvokoError&&!error.code)error.code="native_not_sent";throw error;}
}
async function nativeDraft(request:Request,env:OvokoPublishEnv,context:Context,input:Record<string,unknown>){
 if(env.OVOKO_PUBLISH_ENABLED!=="true")throw new OvokoError(503,"Publikacja Ovoko jest wylaczona.");
 if(Object.keys(input).some(k=>!["operation","productId","source","vehicleId","categoryId","ticket"].includes(k))||!["prepare","item"].includes(String(input.operation))||!workspaceVehicleId(input.productId)||input.vehicleId!==undefined&&input.vehicleId!==""&&!workspaceVehicleId(input.vehicleId)||input.categoryId!==undefined&&(typeof input.categoryId!=="string"||input.categoryId!==""&&!/^[1-9]\d{0,11}$/.test(input.categoryId)))throw new OvokoError(400,"Nieprawidlowy szkic Ovoko.");
 const source=nativeOvokoSource(input.source),key=await ovokoConnectionKey(env),credentials=await loadOvokoConnection(context,key);
 const fingerprint=await ovokoWriteDigest(JSON.stringify(credentials)),account=await ovokoWriteDigest(credentials.username.trim().toLowerCase());
 const hash=await ovokoWriteDigest(JSON.stringify({productId:input.productId,source,vehicleId:input.vehicleId||"",categoryId:input.categoryId||""}));
 const selector=`owner_id=eq.${context.user.id}&product_id=eq.${input.productId}&ovoko_account=eq.${account}`;
 const db=async(query:string,options?:RequestInit)=>{try{return await context.db(`workspace_ovoko_drafts${query}`,options);}catch{throw new OvokoError(503,"Nie odczytano rejestru publikacji Ovoko. Wymagany SQL 028.");}};
 const existing=await db(`?${selector}&select=*`);
 if(!Array.isArray(existing)||existing.length>1)throw new OvokoError(503,"Nieprawidlowy rejestr szkicu.");
 let row=existing[0];
 const result=(record:Record<string,any>,alreadyCreated=false)=>({ok:true,partId:record.part_ids.at(-1)||"",partIds:record.part_ids,moreUnits:record.completed<record.quantity,completedUnits:record.completed,totalUnits:record.quantity,alreadyCreated});
 if(row){
  if(row.snapshot_hash!==hash){
   if(input.operation!=="prepare"||row.state!=="ready"||row.completed!==0)throw new OvokoError(409,"Rozpoczety szkic Ovoko ma inne dane. Nie zmieniono juz wyslanych czesci.","native_locked");
   const changed=await db(`?${selector}&state=eq.ready&completed=eq.0&snapshot_hash=eq.${row.snapshot_hash}&attempt_id=eq.${row.attempt_id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({snapshot_hash:hash,quantity:source.stock,attempt_id:crypto.randomUUID(),updated_at:new Date().toISOString()})});
   if(!Array.isArray(changed)||changed.length!==1)throw new OvokoError(409,"Szkic zmienil sie w innej karcie. Odswiez wynik.","native_locked");
   row=changed[0];
  }
  if(row.state==="created")return result(row,true);
  if(row.state!=="ready")throw new OvokoError(409,"Poprzednia wysylka Ovoko jest w toku lub niepewna. Sprawdz Ovoko przed ponowieniem.","native_locked");
  if(!Number.isInteger(row.completed)||row.completed<0||row.completed>=row.quantity||!Array.isArray(row.part_ids)||row.part_ids.length!==row.completed)throw new OvokoError(503,"Nieprawidlowy postep szkicu Ovoko.","native_locked");
 }
 if(input.operation==="prepare"){
  const prepared=await bulkOvokoPart(request,env,context,{operation:"prepare",offerId:"0",notes:source.description,adjustment:{mode:"none",value:"0"},binding:{sellerId:"0",fingerprint},expectedSource:source,allowTechnicalModel:true,...(input.vehicleId?{workspaceVehicleId:input.vehicleId}:{}),...(input.categoryId?{overrides:{categoryId:input.categoryId}}:{})},source);
  if("webPending" in prepared&&prepared.webPending)return prepared;
  if(!("prepared" in prepared))throw new OvokoError(502,"Nie przygotowano szkicu.");
  return {...prepared,ticket:await sealConnection({hash,fingerprint,prepared:prepared.prepared,expires:Date.now()+3600000},key,`ovoko-draft:v1:${context.user.id}`)};
 }
 let ticket:Ticket;
 try{if(typeof input.ticket!=="string"||input.ticket.length>10000)throw Error();ticket=await openConnection<Ticket>(input.ticket,key,`ovoko-draft:v1:${context.user.id}`);}catch{throw new OvokoError(400,"Odswiez przygotowanie Ovoko.");}
 if(ticket.hash!==hash||ticket.fingerprint!==fingerprint||!Number.isFinite(ticket.expires)||ticket.expires<Date.now())throw new OvokoError(409,"Dane lub konto Ovoko zmienily sie. Przygotuj szkic ponownie.");
 const remote=ovokoWriteClient(credentials),p=ticket.prepared;
 if(input.vehicleId){const car=await workspaceVehicleOvoko(request,env,context,input.vehicleId);if(car.carId!==p.donorId||car.modelId!==p.modelId||car.brandId!==p.brandId)throw new OvokoError(409,"Zmienil sie wybrany dawca.");}
 const categories=parseOvokoRead("categories",await remote("/get/categories")).rows;
 let category=categories.find(row=>row.id===p.categoryId&&row.level==="3");const names=[];
 for(let i=0;category&&i<4;i++){names.push(category.name);category=categories.find(row=>row.id===category!.parentId);}
 if(!names.length||/opon|felg|tires|rims/i.test(names.join(" ")))throw new OvokoError(400,"Sprawdz kategorie Ovoko. Opony i felgi nie sa obslugiwane.");
 const qualities=parseOvokoRead("qualities",await remote("/get/part_quality")).rows,statuses=parseOvokoRead("statuses",await remote("/get/part_status")).rows;
 if(!qualities.some(row=>row.id===p.qualityId)||!statuses.some(row=>row.id===p.statusId&&["na stanie","in stock"].includes(row.name.toLowerCase())))throw new OvokoError(409,"Zmienil sie stan lub status czesci Ovoko.");
 const models=parseOvokoRead("models",await remote(`/get/car_models/${p.brandId}`),p.brandId).rows;
 const cars=await remote(`/v2/get/cars?car_ids=${p.donorId}&page=1&limit=1`);
 if(!models.some(row=>row.id===p.modelId)||!Array.isArray(cars.data)||cars.data.length!==1||String(cars.data[0].id)!==p.donorId||String(cars.data[0].car_model)!==p.modelId)throw new OvokoError(409,"Nie potwierdzono auta Ovoko.");
 const ordinal=(row?.completed||0)+1,externalId=`tymo:draft:${context.user.id}:${input.productId}:u:${ordinal}`;
 const duplicates=ovokoPageData(await remote(`/v2/get/parts?external_ids=${encodeURIComponent(externalId)}&page=1&limit=1`),{page:1,limit:1},"part-external");
 if(duplicates.data.length||duplicates.pagination.total!==0)throw new OvokoError(409,"Ovoko ma juz czesc z tym ID. Nie tworzymy kolejnej kopii.");
 const permission=await accountContext(request,env);requireOvokoAccess(permission,env);
 if(permission.user.id!==context.user.id||JSON.stringify(await loadOvokoConnection(permission,key))!==JSON.stringify(credentials))throw new OvokoError(409,"Konto zmienilo sie przed publikacja.");
 if(!row){const reserved=await db("?on_conflict=owner_id,product_id,ovoko_account",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify({owner_id:context.user.id,product_id:input.productId,ovoko_account:account,snapshot_hash:hash,quantity:source.stock,attempt_id:crypto.randomUUID()})});if(!Array.isArray(reserved)||reserved.length!==1)throw new OvokoError(409,"Szkic jest juz przetwarzany. Odswiez wynik.");row=reserved[0];}
 const attempt=crypto.randomUUID();
 const reserved=await db(`?${selector}&state=eq.ready&completed=eq.${ordinal-1}&snapshot_hash=eq.${hash}&attempt_id=eq.${row.attempt_id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({state:"sending",attempt_id:attempt,updated_at:new Date().toISOString()})});
 if(!Array.isArray(reserved)||reserved.length!==1||reserved[0].attempt_id!==attempt)throw new OvokoError(409,"Szkic jest juz wysylany. Nie wyslano kolejnej kopii.");
 const code=p.manufacturerCode.replace(/-/g,""),codes=additionalOvokoCodes(p.additionalCodes,p.manufacturerCode)||[];
 if(p.manufacturerCode!==code&&!codes.includes(p.manufacturerCode))codes.unshift(p.manufacturerCode);
 const form=new URLSearchParams({car_id:p.donorId,category_id:p.categoryId,quality:p.qualityId,status:p.statusId,price:source.price,original_currency:source.currency,notes:source.description,external_id:externalId,photo:source.images[0],...(code?{manufacturer_code:code}:{})});
 source.images.forEach((url,i)=>form.append(`photos[${i}]`,url));codes.filter(value=>value!==code).forEach((value,i)=>form.append(`optional_codes[${i}]`,value));
 try{
  const response=await remote("/crm/importPart",form),partId=String(response.part_id);
  if(!/^[1-9]\d{0,11}$/.test(partId))throw Error("part id");
  const saved=await db(`?${selector}&state=eq.sending&attempt_id=eq.${attempt}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({state:ordinal===row.quantity?"created":"ready",completed:ordinal,part_ids:[...row.part_ids,partId],updated_at:new Date().toISOString()})});
  if(!Array.isArray(saved)||saved.length!==1||saved[0].completed!==ordinal||saved[0].part_ids.at(-1)!==partId)throw Error("confirmation");
  return result(saved[0]);
 }catch{
  const check=await db(`?${selector}&select=*`).catch(()=>null);
  if(Array.isArray(check)&&check.length===1&&check[0].attempt_id===attempt&&check[0].completed===ordinal)return result(check[0]);
  await db(`?${selector}&state=eq.sending&attempt_id=eq.${attempt}`,{method:"PATCH",body:JSON.stringify({state:"uncertain",updated_at:new Date().toISOString()})}).catch(()=>null);
  throw new OvokoError(409,"Niepewny wynik wysylki Ovoko. Sprawdz czesc po SKU "+externalId+". Nie ponawiamy zapisu w ciemno.","native_uncertain");
 }
}
