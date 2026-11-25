window.OvokoEditor={
 async open({partIds,request,notify,popup}){
  const ids=[...new Set(partIds.map(String).filter(id=>/^[1-9]\d{0,11}$/.test(id)))];
  if(!ids.length){notify("Brak ID opublikowanej czesci Ovoko.");popup?.close();return;}
  let id=ids[0];
  if(ids.length>1){id=window.prompt(`Ktora czesc Ovoko edytowac? ID: ${ids.join(", ")}`,ids[0]);if(!ids.includes(id)){popup?.close();return;}}
  const tab=popup||window.open("about:blank","_blank");
  if(!tab){notify("Przegladarka zablokowala okno Ovoko.");return;}
  tab.opener=null;
  const origin=value=>{
   const url=new URL(value);
   if(url.protocol!=="https:"||url.username||url.password||url.port||!url.hostname.endsWith(".rrr.lt")||url.hostname==="api.rrr.lt")throw Error("Wklej adres swojego panelu https://...rrr.lt, bez loginu i hasla.");
   return url.origin;
  };
  try{
   const result=await request("/api/ovoko/editor",{partId:id});
   if(!/^[a-f0-9]{64}$/.test(result.accountKey)||result.partId!==id)throw Error("Nie potwierdzono konta Ovoko.");
   const key=`wystawiacz-ovoko-panel:${result.accountKey}`;
   let saved="";try{saved=localStorage.getItem(key)||"";}catch{}
   let base="";if(saved)try{base=origin(saved);}catch{}
   if(!base){
    const value=window.prompt("Wklej adres swojego panelu Ovoko z paska przegladarki (https://...rrr.lt). Zapamietamy go dla tego konta.","");
    if(!value){tab.close();return;}
    base=origin(value.trim());try{localStorage.setItem(key,base);}catch{}
   }
   tab.location.href=`${base}/v2/parts/view/${id}`;
  }catch(error){tab.close();notify(error.message);}
 }
};
