"use client";
import {useState} from "react";
import {createSupabaseBrowserClient} from "@/lib/supabase";

let loading:Promise<void>|undefined;
type EditorWindow=Window&{OvokoEditor?:{open:(options:{partIds:string[];popup:Window;notify:(message:string)=>void;request:(path:string,body:unknown)=>Promise<any>})=>Promise<void>}};
export function OvokoEditButton({partIds}:{partIds:string[]}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 return <><button className="block text-[10px] text-cyan-200 underline disabled:opacity-40" disabled={busy} onClick={async()=>{
  const popup=window.open("about:blank","_blank");if(!popup){setError("Zezwol na otwieranie okien Ovoko.");return;}popup.opener=null;
  setBusy(true);setError("");
  try{
   if(!(window as EditorWindow).OvokoEditor)await (loading||=new Promise<void>((resolve,reject)=>{const script=document.createElement("script");script.src="/wystawiacz/ovoko-editor.js?v=1";script.onload=()=>resolve();script.onerror=()=>{loading=undefined;reject(Error("Nie wczytano edytora Ovoko."));};document.head.appendChild(script);}));
   await (window as EditorWindow).OvokoEditor!.open({partIds,popup,notify:setError,request:async(path,body)=>{
    const {data}=await createSupabaseBrowserClient().auth.getSession();
    const response=await fetch(path,{method:"POST",headers:{Authorization:`Bearer ${data.session?.access_token||""}`,"Content-Type":"application/json"},body:JSON.stringify(body)}),value=await response.json() as Record<string,unknown>;
    if(!response.ok)throw Error(typeof value.message==="string"?value.message:"Nie otwarto Ovoko.");return value;
   }});
  }catch(error){popup.close();setError((error as Error).message);}finally{setBusy(false);}
 }}>Edytuj w Ovoko</button>{error&&<span className="block text-[10px] text-amber-200" role="status">{error}</span>}</>;
}
