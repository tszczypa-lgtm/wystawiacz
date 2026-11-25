import type {accountContext} from "./account-api";
import {handleAllegroApi} from "./allegro-api";
import {bulkOvokoPart} from "./ovoko-bulk";
import type {OvokoPublishEnv} from "./ovoko-publish";
import {OvokoError} from "./ovoko-read";
import {ovokoSourcePreview} from "./ovoko-preparation";
import {workspaceVehicleId} from "./workspace-vehicles";

export async function workspaceListingOvoko(request:Request,env:OvokoPublishEnv,context:Awaited<ReturnType<typeof accountContext>>,input:Record<string,unknown>){
 if(Object.keys(input).some(key=>!["operation","offerId","vehicleId","price","stockMode","binding","notes","expectedSource","prepared","categoryId"].includes(key))||!["prepare","item"].includes(String(input.operation))||typeof input.offerId!=="string"||!/^\d{1,30}$/.test(input.offerId)||!workspaceVehicleId(input.vehicleId)||typeof input.notes!=="string"||input.notes.length>40000||typeof input.price!=="string"||!/^\d{1,7}(\.\d{1,2})?$/.test(input.price)||Number(input.price)<=0||input.categoryId!==undefined&&(typeof input.categoryId!=="string"||input.categoryId!==""&&!/^[1-9]\d{0,11}$/.test(input.categoryId)))throw new OvokoError(400,"Sprawdz dane wystawienia Ovoko.");
 let expected=input.expectedSource;
 if(input.operation==="prepare"){
  const response=await handleAllegroApi(new Request(`${new URL(request.url).origin}/api/allegro/ovoko-source/${input.offerId}`,{headers:{Authorization:request.headers.get("Authorization")||""}}),env);
  const body=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new OvokoError(response.status,String(body.message||"Nie odczytano wystawionej oferty Allegro."));
  const source=ovokoSourcePreview(body.offer,input.offerId,()=>input.notes as string);
  expected={title:source.title,price:source.price,currency:source.currency,stock:source.stock,status:source.status,condition:source.condition,images:source.images};
 }
 const result=await bulkOvokoPart(request,env,context,{operation:input.operation,offerId:input.offerId,workspaceVehicleId:input.vehicleId,adjustment:{mode:"fixed",value:input.price},binding:input.binding,notes:input.notes,expectedSource:expected,...(input.operation==="item"?{prepared:input.prepared}:{}),stockMode:input.stockMode,...(input.categoryId?{overrides:{categoryId:input.categoryId}}:{})});
 return {...result,expectedSource:expected};
}
