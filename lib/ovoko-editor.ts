import type {accountContext} from "./account-api";
import {loadOvokoConnection,ovokoConnectionKey} from "./ovoko-connection";
import type {OvokoPublishEnv} from "./ovoko-publish";
import {OvokoError,ovokoPartImage} from "./ovoko-read";
import {ovokoWriteClient,ovokoWriteDigest,OvokoRemoteError} from "./ovoko-write-client";

export async function ovokoEditorTarget(env:OvokoPublishEnv,context:Awaited<ReturnType<typeof accountContext>>,input:Record<string,unknown>){
 if(Object.keys(input).some(key=>!["partId","includeDraft"].includes(key))||input.includeDraft!==undefined&&typeof input.includeDraft!=="boolean"||typeof input.partId!=="string"||!/^[1-9]\d{0,11}$/.test(input.partId))throw new OvokoError(400,"Nieprawidlowe ID czesci Ovoko.");
 const credentials=await loadOvokoConnection(context,await ovokoConnectionKey(env));
 const response=await ovokoWriteClient(credentials)(`/get/part/${input.partId}`).catch(error=>{if(error instanceof OvokoRemoteError&&error.providerCode==="R404")throw new OvokoError(404,"Nie znaleziono tej czesci na polaczonym koncie Ovoko.");throw error;});
 const rows=Array.isArray(response.list)?response.list.flat(1):[];
 if(rows.length!==1||!rows[0]||String(rows[0].id)!==input.partId)throw new OvokoError(404,"Nie potwierdzono tej czesci na polaczonym koncie Ovoko.");
 const part=rows[0],text=(key:string,max=500)=>typeof part[key]==="string"?part[key].slice(0,max):"";
 const draft=input.includeDraft?{title:text("name"),notes:text("notes",40000),price:text("price",30),number:text("manufacturer_code",255),categoryId:/^\d{1,12}$/.test(String(part.category_id))?String(part.category_id):"",currency:["PLN","EUR"].includes(part.original_currency)?String(part.original_currency):"",images:[...new Set([part.photo,...(Array.isArray(part.part_photo_gallery)?part.part_photo_gallery:[])].map(ovokoPartImage).filter(Boolean))].slice(0,50)}:undefined;
 return {partId:input.partId,accountKey:await ovokoWriteDigest(`${context.user.id}:${credentials.username.trim().toLowerCase()}`),...(draft?{draft}:{})};
}
