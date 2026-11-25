import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {pathToFileURL,fileURLToPath} from "node:url";
import {mkdirSync} from "node:fs";
import {build} from "esbuild";
const require=createRequire(import.meta.url);
const {Miniflare}=await import(pathToFileURL(require.resolve("miniflare",{paths:[require.resolve("wrangler/package.json")]})).href);
const built=await build({stdin:{contents:'import{lookupWebFitment}from"./lib/ovoko-web-fitment";export default{async fetch(r,e){return Response.json(await lookupWebFitment(e,"fixture-owner"+new URL(r.url).pathname,"5G0907044CH","Volkswagen"));}};',resolveDir:process.cwd()},bundle:true,write:false,format:"esm",platform:"browser",target:"es2022"});
let calls=0,mode="completed",posts=0,gets=0;
const sourceUrl="https://ovoko.fr/les-pieces/fixture-5g0907044ch-touran-iii";
const cacheDir=fileURLToPath(new URL(`../outputs/web-worker-cache-${Date.now()}/`,import.meta.url));mkdirSync(cacheDir,{recursive:true});
const mf=new Miniflare({port:19893,modules:true,cachePersist:cacheDir,script:built.outputFiles[0].text,compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],bindings:{OPENAI_API_KEY:"fake-worker-key",APP_ORIGIN:"https://web-worker.test"},outboundService:async request=>{
 assert.equal(new URL(request.url).hostname,"api.openai.com");calls++;
 assert.equal(request.headers.get("Authorization"),"Bearer fake-worker-key");
 if(mode==="redirect")return new Response(null,{status:302,headers:{Location:"https://not-openai.test/collect"}});
 if(request.method==="POST"){
  posts++;const body=await request.json();assert.equal(body.background,true);
  if(mode==="background")return Response.json({id:"resp_worker123",status:"queued"});
 }else{gets++;assert.equal(request.method,"GET");assert.equal(new URL(request.url).pathname,"/v1/responses/resp_worker123");}
 return Response.json({status:"completed",output:[{type:"web_search_call",status:"completed",action:{sources:[{url:sourceUrl}]}},{type:"message",status:"completed",content:[{type:"output_text",text:JSON.stringify({number:"5G0907044CH",matches:[{number:"5G0907044CH",make:"Volkswagen",model:"Touran III",year:"2019",sourceUrl,evidence:"5G0907044CH Volkswagen Touran III 2019"}]})}]}]});
}});
try{
 const result=await(await mf.dispatchFetch("https://web-worker.test/lookup")).json();
 assert.equal(result.matches?.[0]?.year,"2019",JSON.stringify({result,calls}));assert.equal(calls,1);
 mode="redirect";const redirected=await(await mf.dispatchFetch("https://web-worker.test/redirect")).json();assert.match(redirected.diagnostic,/^web_http_302/);assert.equal(calls,2,"Never forward the API key to a redirected host");
 mode="background";const pending=await(await mf.dispatchFetch("https://web-worker.test/background")).json();assert.equal(pending.pending,true);const posted=posts;
 await new Promise(resolve=>setTimeout(resolve,5500));
 const done=await(await mf.dispatchFetch("https://web-worker.test/background")).json();assert.equal(done.matches?.[0]?.year,"2019",JSON.stringify(done));assert.equal(posts,posted,"Native status polling must not submit a second paid job");assert.equal(gets,1);
 console.log("Web year workerd: native POST, background GET polling, JSON parsing and blocked redirects passed. OpenAI outbound mocked; no charge.");
}finally{await mf.dispose();}
