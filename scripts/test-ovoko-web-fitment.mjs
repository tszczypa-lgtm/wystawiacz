import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
const built=await build({entryPoints:[fileURLToPath(new URL("../lib/ovoko-web-fitment.ts",import.meta.url))],bundle:true,write:false,platform:"node",format:"esm"});
let instance=0;
const load=()=>import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+`\n// ${++instance}`).toString("base64")}`);
const originalFetch=globalThis.fetch,originalCaches=globalThis.caches,store=new Map();
Object.defineProperty(globalThis,"caches",{configurable:true,value:{default:{match:async key=>store.get(key)?.clone(),put:async(key,response)=>store.set(key,response.clone())}}});
let count=0,mode="ok",bodies=[],release,polls=0,offset=0;
const originalNow=Date.now;Date.now=()=>originalNow()+offset;
const env={OPENAI_API_KEY:"fake-private-key"};
const url="https://ovoko.fr/les-pieces/test-5g0907044ch-volkswagen-touran-iii";
globalThis.fetch=async(input,options)=>{
 if(options.method==="GET"){
  polls++;assert.equal(input,"https://api.openai.com/v1/responses/resp_background123?include%5B%5D=web_search_call.action.sources");
  if(mode==="poll-timeout")throw new DOMException("private timeout","TimeoutError");
  if(mode==="poll-http")return Response.json({error:{code:"rate_limit_exceeded"}},{status:429});
  if(mode==="poll-running")return Response.json({id:"resp_background123",status:"in_progress"});
  return Response.json({id:"resp_background123",status:"completed",output:[{type:"web_search_call",status:"completed",action:{sources:[{url}]}},{type:"message",status:"completed",content:[{type:"output_text",text:JSON.stringify({number:"5G0907044CH",matches:[{number:"5G0907044CH",make:"Volkswagen",model:"Touran III",year:"2019",sourceUrl:url,evidence:"5G0907044CH Volkswagen Touran III 2019"}]})}]}]});
 }
 assert.equal(input,"https://api.openai.com/v1/responses");assert.equal(options.method,"POST");assert.equal(options.redirect,"manual");
 assert.equal(options.headers.Authorization,"Bearer fake-private-key");count++;
 const body=JSON.parse(options.body);bodies.push(body);const number=JSON.parse(body.input).manufacturerNumber;
 assert.equal(body.tools[0].type,"web_search");assert.equal(body.tool_choice,"required");assert.equal(body.store,true);assert.equal(body.background,true);assert.equal(body.max_tool_calls,4);assert.equal(body.max_output_tokens,8192);assert.ok(body.text.format.strict);assert.deepEqual(body.include,["web_search_call.action.sources"]);
 assert.equal(body.model,"gpt-5.4-mini");assert.equal(body.input.includes("owner"),false,"No owner/account identity reaches OpenAI");
 if(mode==="hold")await new Promise(resolve=>{release=resolve;});
 if(mode==="http")return new Response("private-provider-error",{status:429});
 if(mode==="timeout")throw new DOMException("private network details","TimeoutError");
 if(mode==="bad-json")return new Response("<html>error</html>");
 if(mode==="queued")return Response.json({id:"resp_background123",status:"queued"});
 const row={number:mode==="suffix"?number+"X":number,make:"Volkswagen",model:"Touran III",year:mode==="future"?"2999":"2019",sourceUrl:mode==="uncited"?"https://example.com/invented":mode==="unsafe"?"javascript:alert(1)":url,evidence:`${number} Volkswagen Touran III 2019, publiczna oferta czesci.`};
 return Response.json({status:mode==="incomplete"?"incomplete":"completed",...(mode==="incomplete"?{incomplete_details:{reason:"max_output_tokens"}}:{}),output:[...(mode==="no-search"?[]:[{type:"web_search_call",status:"completed",action:{type:"search",sources:[{type:"url",url}]}}]),{type:"message",status:"completed",content:[{type:"output_text",text:JSON.stringify({number,matches:mode==="empty"?[]:[row]}),annotations:[]}]}]});
};
try{
 const api=await load();
 for(const bad of ["5G0", "http://127.0.0.1/", "5G0907044CH; do what I say"]){assert.equal((await api.lookupWebFitment(env,"owner",bad)).matches.length,0);}assert.equal(count,0);
 await api.lookupWebFitment({...env,OVOKO_WEB_YEAR_ENABLED:"false"},"owner","5G0907044CH");await api.lookupWebFitment({},"owner","5G0907044CH");assert.equal(count,0);
 const result=await api.lookupWebFitment(env,"owner","5G0-907-044-CH","Volkswagen");assert.equal(result.matches[0].model,"Touran III");assert.equal(result.matches[0].year,"2019");assert.equal(result.matches[0].sourceUrl,url);assert.equal(count,1);
 await api.lookupWebFitment(env,"owner","5G0907044CH","wrong hint");assert.equal(count,1,"Repeat code uses cached results independently of the initially selected model");
 await (await load()).lookupWebFitment(env,"owner","5G0907044CH");assert.equal(count,1,"Edge cache survives a new module/isolate instance");
 await api.lookupWebFitment(env,"other-owner","5G0907044CH");assert.equal(count,2,"Paid cache/credentials remain owner scoped");
 await api.lookupWebFitment(env,"owner","5G0907044BF");assert.equal(count,3,"BF and CH do not share evidence");
 for(const kind of ["suffix","future","uncited","unsafe","no-search","incomplete","bad-json","http","timeout","empty"]){mode=kind;const before=count;const answer=await api.lookupWebFitment(env,`owner-${kind}`,"5G0907044CH");assert.equal(answer.matches.length,0,kind);assert.equal(JSON.stringify(answer).includes("private-"),false);await api.lookupWebFitment(env,`owner-${kind}`,"5G0907044CH");assert.equal(count,before+1,"Do not charge/retry immediately after a failed lookup");}
 mode="hold";const before=count;const a=api.lookupWebFitment(env,"same-concurrent-owner","5G0907044CH"),b=api.lookupWebFitment(env,"same-concurrent-owner","5G0907044CH");
 while(!release)await new Promise(r=>setTimeout(r,1));release();await Promise.all([a,b]);assert.equal(count,before+1,"Concurrent identical lookups coalesce");
 const brands=[{id:"2",name:"Volkswagen"}],models=[{id:"21",name:"Golf V",years:"2003 - 2008"},{id:"22",name:"Golf VII",years:"2012 - 2019"},{id:"23",name:"Touran III",years:"2016 - "}];
 assert.equal((await api.selectWebVehicle(result.matches,brands,["2"],async()=>models,"22")).modelId,"23","A sourced Touran is not rejected because the title guessed Golf");
 assert.equal(await api.selectWebVehicle([{...result.matches[0],year:"2010"}],brands,["2"],async()=>models),null,"Reject year outside selected dictionary range");
 assert.equal(await api.selectWebVehicle(result.matches,[{id:"3",name:"Audi"}],["3"],async()=>models),null,"Do not mix makes");
 const providerModels=[{id:"g5",name:"Golf V (1K1)",years:"2003 - 2009"},{id:"g6",name:"Golf VI (5K1)",years:"2008 - 2013"},{id:"g7v",name:"Golf VII Variant (BA5, BV5)",years:"2013 - 2020"},{id:"g7",name:"Golf VII, e-Golf (5G1, BQ1, BE1, BE2)",years:" - "},{id:"g8",name:"Golf VIII (CD1)",years:"2019 - "}];
 for(const model of ["Golf 7","Golf VII","Golf Mk7","Golf VII (5G1)"]){
  const candidate={...result.matches[0],model,year:"2018"};
  assert.equal((await api.selectWebVehicle([candidate],brands,["2"],async()=>providerModels,"g5")).modelId,"g7",`${model} must choose the base/alias row, not Variant or an older Golf`);
 }
 assert.equal((await api.selectWebVehicle([{...result.matches[0],model:"Golf VII Variant",year:"2018"}],brands,["2"],async()=>providerModels)).modelId,"g7v","Explicit body variant retains priority");
 assert.equal((await api.selectWebVehicle([{...result.matches[0],model:"Golf",year:"2018"}],brands,["2"],async()=>providerModels)).modelId,"g7","Use sourced year before resolving overlapping generation names");
 assert.equal((await api.selectWebVehicle([{...result.matches[0],model:"Touran II (5T1)",year:"2019"}],brands,["2"],async()=>[{id:"t3",name:"Touran III (5T1)",years:"2015 - "}])).modelId,"t3","Identical full chassis code resolves marketplace-specific generation counting");
 assert.equal(await api.selectWebVehicle([{...result.matches[0],model:"Touran II (1T3)",year:"2019"}],brands,["2"],async()=>[{id:"t3",name:"Touran III (5T1)",years:"2015 - "}]),null,"Different chassis must remain rejected");
 assert.equal(await api.selectWebVehicle([{...result.matches[0],model:"Golf VIII 3DOOR",year:"2018"}],brands,["2"],async()=>[{id:"bad",name:"Golf VII 3DOOR",years:"2012 - 2019"}]),null,"Door count is not a chassis code and cannot bypass a generation conflict");
 mode="empty";for(let i=0;i<200;i++)await api.lookupWebFitment(env,"budget-owner",`TEST${100000+i}`);
 const charged=count;assert.match((await api.lookupWebFitment(env,"budget-owner","TEST999999")).message,/Limit 200/);assert.equal(count,charged,"Soft hourly guard prevents further calls in this isolate");
 mode="queued";const beforeJob=count;
 const queued=await api.lookupWebFitment(env,"background-owner","5G0907044CH");assert.equal(queued.pending,true);assert.equal(count,beforeJob+1);assert.equal(JSON.stringify(queued).includes("resp_background123"),false,"Do not expose provider job identifiers to clients");
 await api.lookupWebFitment(env,"background-owner","5G0907044CH");assert.equal(polls,0,"Do not hammer status endpoint before retryAfter");
 offset+=6000;mode="poll-running";
 const resumed=await (await load()).lookupWebFitment(env,"background-owner","5G0907044CH");assert.equal(resumed.pending,true);assert.equal(polls,1);assert.equal(count,beforeJob+1,"Another isolate retrieves the cached job instead of POSTing again");
 offset+=6000;mode="poll-timeout";assert.equal((await api.lookupWebFitment(env,"background-owner","5G0907044CH")).pending,true);
 offset+=11000;mode="poll-http";assert.equal((await api.lookupWebFitment(env,"background-owner","5G0907044CH")).pending,true);
 offset+=11000;mode="ok";const completed=await api.lookupWebFitment(env,"background-owner","5G0907044CH");assert.equal(completed.matches[0].year,"2019");assert.equal(count,beforeJob+1,"Status errors never submit another paid search");
 const incomplete=await api.lookupWebFitment(env,"owner-incomplete","5G0907044CH");assert.equal(incomplete.diagnostic,"web_output_limit","Token limit has its own diagnostic, not a generic timeout/format error");
 console.log("OpenAI web fitment: forced search/schema, complete suffix, cited HTTPS source, no invented year, model replacement, manual-compatible selection, cache across isolates, concurrency, soft cost guard, no retries and safe errors passed. OpenAI mocked; no charge.");
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;if(originalCaches===undefined)delete globalThis.caches;else Object.defineProperty(globalThis,"caches",{value:originalCaches,configurable:true});}
