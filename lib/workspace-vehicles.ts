import type {accountContext} from "./account-api";
import {OvokoError} from "./ovoko-read";
type Context=Awaited<ReturnType<typeof accountContext>>;
export type WorkspaceVehicle={manufacturer:string;short:string;buttonLabel:string;full:string;ovoko:{brandId:string;modelId:string;year:string;vin:string;engineCode:string;capacity:string;power:string;mileage:string;color:string;place:string}|null};
export const workspaceVehicleId=(id:unknown):id is string=>typeof id==="string"&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function validateWorkspaceVehicle(value:unknown):WorkspaceVehicle{
 const data=obj(value),fields={manufacturer:100,short:160,buttonLabel:40,full:10000};
 if(Object.keys(data).some(k=>![...Object.keys(fields),"ovoko"].includes(k)))throw new OvokoError(400,"Nieprawidlowe pola samochodu.");
 for(const [key,max] of Object.entries(fields))if(typeof data[key]!=="string"||(data[key] as string).length>max||/\0/.test(data[key] as string))throw new OvokoError(400,"Sprawdz dane samochodu.");
 if(!String(data.manufacturer).trim()||!String(data.short).trim()||!String(data.full).trim())throw new OvokoError(400,"Podaj producenta, nazwe do tytulu i opis auta.");
 const result:WorkspaceVehicle={manufacturer:String(data.manufacturer).trim(),short:String(data.short).trim(),buttonLabel:String(data.buttonLabel).trim(),full:String(data.full).trim(),ovoko:null};
 if(data.ovoko!=null){
  const car=obj(data.ovoko),keys=["brandId","modelId","year","vin","engineCode","capacity","power","mileage","color","place"];
  if(Object.keys(car).some(k=>!keys.includes(k))||keys.some(k=>typeof car[k]!=="string"||(car[k] as string).length>100||/\0/.test(car[k] as string)))throw new OvokoError(400,"Nieprawidlowe dane auta Ovoko.");
  if(!/^[1-9]\d{0,11}$/.test(String(car.brandId))||!/^[1-9]\d{0,11}$/.test(String(car.modelId))||!/^\d{4}$/.test(String(car.year))||Number(car.year)<1886||Number(car.year)>new Date().getUTCFullYear()+1)throw new OvokoError(400,"Wybierz marke, model i rok auta Ovoko.");
  if(car.vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(String(car.vin)))throw new OvokoError(400,"VIN musi miec 17 znakow, bez I, O i Q; albo pozostaw go pusty.");
  for(const k of ["capacity","power","mileage"])if(car[k]&&!/^\d{1,8}$/.test(String(car[k])))throw new OvokoError(400,"Pojemnosc, moc i przebieg musza byc liczbami calkowitymi lub pozostac puste.");
  result.ovoko=Object.fromEntries(keys.map(k=>[k,String(car[k]).trim()])) as NonNullable<WorkspaceVehicle["ovoko"]>;
 }
 return result;
}
export async function readWorkspaceVehicle(context:Context,id:unknown){
 if(!workspaceVehicleId(id))throw new OvokoError(400,"Nieprawidlowy identyfikator auta.");
 const rows=await context.db(`workspace_vehicles?owner_id=eq.${context.user.id}&id=eq.${id}&select=id,revision,payload,updated_at`) as {id:string;revision:number;payload:WorkspaceVehicle;updated_at:string}[];
 if(!Array.isArray(rows)||rows.length!==1)throw new OvokoError(404,"Nie znaleziono auta na tym koncie Wystawiacza.");
 return {...rows[0],payload:validateWorkspaceVehicle(rows[0].payload)};
}
export async function workspaceVehicles(request:Request,context:Context){
 const url=new URL(request.url);
 if(request.method==="GET"){
  if(url.searchParams.has("id"))return {vehicle:await readWorkspaceVehicle(context,url.searchParams.get("id"))};
  const offset=url.searchParams.get("offset")||"0";
  if(!/^\d{1,6}$/.test(offset))throw new OvokoError(400,"Nieprawidlowa strona aut.");
  const rows=await context.db(`workspace_vehicles?owner_id=eq.${context.user.id}&select=id,revision,payload,updated_at&order=updated_at.desc,id&limit=100&offset=${offset}`);
  return {vehicles:rows};
 }
 if(request.method!=="PUT")throw new OvokoError(405,"Nieprawidlowa metoda.");
 if(request.headers.get("Origin")!==url.origin)throw new OvokoError(403,"Nieprawidlowe zrodlo zadania.");
 if(request.headers.get("Content-Type")?.split(";")[0]!=="application/json")throw new OvokoError(415,"Wyslij JSON.");
 const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
 if(!reader)throw new OvokoError(400,"Brak danych samochodu.");
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000){await reader.cancel();throw new OvokoError(413,"Dane auta sa zbyt dlugie.");}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new OvokoError(400,"Nieprawidlowy JSON samochodu.");}
 const input=obj(parsed);
 if(!workspaceVehicleId(input.id)||!Number.isSafeInteger(input.revision)||Number(input.revision)<0||Object.keys(input).some(k=>!["id","revision","payload"].includes(k)))throw new OvokoError(400,"Nieprawidlowa wersja samochodu.");
 const payload=validateWorkspaceVehicle(input.payload), selector=`owner_id=eq.${context.user.id}&id=eq.${input.id}`;
 if(input.revision){
  const old=await readWorkspaceVehicle(context,input.id);
  if(JSON.stringify(old.payload.ovoko)!==JSON.stringify(payload.ovoko)){
   const links=await context.db(`workspace_vehicle_ovoko?owner_id=eq.${context.user.id}&vehicle_id=eq.${input.id}&select=state&limit=1`) as unknown[];
   if(links.length)throw new OvokoError(409,"Auto bylo juz laczone z Ovoko. Dodaj nowe auto zamiast zmieniac jego dane techniczne. Nazwe i opis mozna edytowac.");
  }
 }
 const rows=await context.db(input.revision?`workspace_vehicles?${selector}&revision=eq.${input.revision}`:"workspace_vehicles?on_conflict=owner_id,id",{method:input.revision?"PATCH":"POST",headers:{Prefer:input.revision?"return=representation":"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(input.revision?{payload,revision:Number(input.revision)+1,updated_at:new Date().toISOString()}:{owner_id:context.user.id,id:input.id,payload,revision:1})}) as unknown[];
 if(!Array.isArray(rows)||rows.length!==1)throw new OvokoError(409,"Auto zmieniono w innej karcie. Otworz najnowsza wersje; nie nadpisano zmian.");
 return {vehicle:rows[0]};
}
