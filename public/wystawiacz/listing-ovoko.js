/* Optional Ovoko channel; the existing Allegro form remains the default. */
window.ListingOvoko = (() => {
  const $ = id => document.getElementById(id);
  const esc = value => { const el=document.createElement("span"); el.textContent=String(value??""); return el.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;"); };
  let hooks, library=[], loading=false, modelsRun=0, pendingVehicleId="", restoredVehicle=null, listingTarget="allegro", stockMode="shared", categoryTimer, categoryTitle="", categoryRun=0;
  const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const carKeys=["brandId","modelId","year","vin","engineCode","capacity","power","mileage","color","place"];
  async function request(path,body,method="POST") {
    const token=await window.getWystawiaczToken();
    if(!token)throw new Error("Zaloguj sie ponownie do Wystawiacza.");
    const response=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw new Error(`Serwer nie zwrocil JSON (HTTP ${response.status}). Sprawdz wynik przed ponowieniem.`);}
    if(!response.ok){const error=new Error(data.message||`HTTP ${response.status}`);error.code=data.code;throw error;}
    return data;
  }
  const read=async(operation,extra={})=>operation==="brands"?(await request("/api/ovoko/test",{useSaved:true})).brands:(await request("/api/ovoko/read",{useSaved:true,operation,...extra})).rows;
  function showError(error){$("workspaceCarsStatus").textContent=error.message;}
  function options(select,rows,placeholder,value=""){
    select.innerHTML=`<option value="">${esc(placeholder)}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}${row.years?` (${esc(row.years)})`:""}</option>`).join("");
    select.value=value;
  }
  async function brands(){
    if($("workspaceCarBrandId").options.length>1)return;
    options($("workspaceCarBrandId"),await read("brands"),"Wybierz marke");
  }
  async function models(value=""){
    const run=++modelsRun,brand=$("workspaceCarBrandId").value;
    options($("workspaceCarModelId"),[],"Wybierz model");
    if(!brand)return;
    const rows=await read("models",{brandId:brand});
    if(run===modelsRun)options($("workspaceCarModelId"),rows,"Wybierz model",value);
  }
  function libraryRender(){
    const query=$("workspaceCarsSearch").value.trim().toLocaleLowerCase();
    $("workspaceCarsList").innerHTML=library.filter(row=>`${row.payload.short} ${row.payload.full} ${row.payload.ovoko?.vin||""}`.toLocaleLowerCase().includes(query)).map(row=>`<button class="secondary-button" type="button" data-library-car="${esc(row.id)}">${esc(row.payload.buttonLabel||row.payload.short)}${row.payload.ovoko?` / ${esc(row.payload.ovoko.year)} ${esc(row.payload.ovoko.vin)}`:""}</button>`).join("")||"<small>Brak zapisanych aut w tej czesci listy.</small>";
    $("workspaceCarsList").querySelectorAll("[data-library-car]").forEach(button=>button.onclick=()=>{
      const row=library.find(item=>item.id===button.dataset.libraryCar);
      hooks.useHistory({...row.payload,id:row.id,libraryId:row.libraryId||row.payload.libraryId||"",libraryRevision:row.revision||row.payload.libraryRevision||0});
      $("workspaceCarsDialog").close();
    });
  }
  async function loadLibrary(){
    if(loading)return;loading=true;$("workspaceCarsStatus").textContent="Wczytuje Moje samochody...";
    try{
      const all=new Map();library=[];
      for(let offset=0;;offset+=100){
        const result=await request(`/api/workspace/vehicles?offset=${offset}`,null,"GET");
        if(!Array.isArray(result.vehicles))throw new Error("Nieprawidlowa lista samochodow.");
        for(const row of result.vehicles)all.set(row.id,{...row,libraryId:row.id});
        library=[...all.values()];libraryRender();
        if(result.vehicles.length<100)break;
      }
      for(let offset=0;;offset+=100){
        const result=await request(`/api/workspace/vehicle-history?offset=${offset}`,null,"GET");
        if(!Array.isArray(result.sessions))throw new Error("Nie odczytano historii sesji.");
        for(const session of result.sessions)for(const car of Array.isArray(session.vehicles)?session.vehicles:[]){
          if(!car||typeof car.id!=="string"||typeof car.short!=="string"||typeof car.full!=="string")continue;
          const id=car.libraryId||car.id;if(!all.has(id))all.set(id,{id,payload:car});
        }
        library=[...all.values()];libraryRender();
        if(result.sessions.length<100)break;
      }
      $("workspaceCarsStatus").textContent=`Historia: ${library.length} aut. Kliknij auto, aby uzyc go w tej aukcji.`;
    }catch(error){showError(error);}finally{loading=false;}
  }
  function mount(callbacks){
    hooks=callbacks;
    const price=document.createElement("label");price.className="field ovoko-field";
    price.innerHTML='<span>Cena Ovoko</span><div class="suffix-input"><input id="listingOvokoPrice" type="number" min="0.01" step="0.01" placeholder="0,00"><b>PLN</b></div>';
    $("priceInput").closest(".pricing-final-row").append(price);
    const category=document.createElement("label");category.className="ovoko-field ovoko-category";
    category.innerHTML='<span>Kategoria Ovoko</span><select id="listingOvokoCategory" aria-label="Kategoria Ovoko"><option value="">Automatycznie</option></select>';
    $("categoryInput").after(category);
    $("listingOvokoCategory").onfocus=async()=>{
      if($("listingOvokoCategory").dataset.loaded)return;
      try{const value=$("listingOvokoCategory").dataset.manual||"";options($("listingOvokoCategory"),(await read("categories")).filter(row=>row.level==="3"),"Automatycznie",value);$("listingOvokoCategory").dataset.loaded="true";}catch(error){hooks.toast(error.message);}
    };
    $("listingOvokoCategory").onchange=()=>{$("listingOvokoCategory").dataset.manual=$("listingOvokoCategory").value;if(!$("listingOvokoCategory").value){categoryTitle="";scheduleCategory();}};
    $("titleInput").addEventListener("input",scheduleCategory);
    const actions=$("publishCurrentButton").parentElement;
    $("publishCurrentButton").textContent="Wystaw Allegro";
    actions.querySelector("p").textContent="";
    for(const [id,label,target] of [["publishOvokoCurrentButton","Wystaw Ovoko","ovoko"],["publishBothCurrentButton","Wystaw Allegro i Ovoko","both"]]){
      const button=document.createElement("button");button.id=id;button.type="button";button.className="primary-button ovoko-button";button.textContent=label;button.onclick=()=>hooks.publishCurrent(target);actions.append(button);
    }
    const historyButton=document.createElement("button");historyButton.id="openVehicleHistoryButton";historyButton.type="button";historyButton.className="secondary-button";historyButton.textContent="Historia samochodow";
    $("openVehiclesButton").before(historyButton);
    const archive=document.createElement("dialog");archive.id="workspaceCarsDialog";
    archive.innerHTML=`<div class="models-dialog-heading"><h3>Historia samochodow</h3><button class="secondary-button" type="button" id="workspaceCarsClose">Zamknij</button></div><input id="workspaceCarsSearch" type="search" placeholder="Szukaj auta / VIN" aria-label="Szukaj w historii samochodow"><div id="workspaceCarsList" class="workspace-cars-library"></div><p id="workspaceCarsStatus" role="status"></p>`;
    document.body.append(archive);
    historyButton.onclick=()=>{archive.showModal();loadLibrary();};
    $("workspaceCarsClose").onclick=()=>archive.close();
    $("workspaceCarsSearch").oninput=libraryRender;
    const form=document.createElement("details");form.id="workspaceCarOvokoDetails";form.className="workspace-ovoko-panel";
    form.innerHTML=`<summary>Dane samochodu Ovoko</summary><label><input type="checkbox" id="workspaceCarOvokoEnabled"> Zapisz takze w Ovoko</label><div class="workspace-ovoko-grid"><label>Marka Ovoko<select id="workspaceCarBrandId"><option value="">Wybierz marke</option></select></label><label>Model Ovoko<select id="workspaceCarModelId"><option value="">Wybierz model</option></select></label>${[["year","Rok produkcji","number"],["vin","VIN (opcjonalnie)","text"],["engineCode","Kod silnika","text"],["capacity","Pojemnosc cm3","number"],["power","Moc kW","number"],["mileage","Przebieg km","number"],["color","Kolor","text"],["place","Miejsce w magazynie","text"]].map(([key,label,type])=>`<label>${label}<input id="workspaceCar${key[0].toUpperCase()+key.slice(1)}" type="${type}" ${type==="number"?'min="0" step="1"':'maxlength="100"'}></label>`).join("")}</div>`;
    $("addVehicleButton").before(form);
    form.ontoggle=()=>{if(form.open)brands().catch(showError);};
    $("workspaceCarBrandId").onchange=()=>models().catch(showError);
  }
  function editorReset(){
    pendingVehicleId="";
    if(!$("workspaceCarOvokoEnabled"))return;
    modelsRun++;$("workspaceCarOvokoEnabled").checked=false;
    for(const key of carKeys)$("workspaceCar"+key[0].toUpperCase()+key.slice(1)).value="";
  }
  async function editorRestore(vehicle){
    editorReset();if(!vehicle.ovoko)return;
    $("workspaceCarOvokoEnabled").checked=true;
    $("workspaceCarOvokoDetails").open=true;
    for(const key of carKeys.filter(key=>!["brandId","modelId"].includes(key)))$("workspaceCar"+key[0].toUpperCase()+key.slice(1)).value=vehicle.ovoko[key]||"";
    try{await brands();$("workspaceCarBrandId").value=vehicle.ovoko.brandId;await models(vehicle.ovoko.modelId);}catch(error){showError(error);}
  }
  async function saveVehicle(vehicle,existing){
    let ovoko=null;
    if($("workspaceCarOvokoEnabled").checked){
      ovoko=Object.fromEntries(carKeys.map(key=>[key,$("workspaceCar"+key[0].toUpperCase()+key.slice(1)).value.trim()]));
      ovoko.vin=ovoko.vin.toUpperCase();
    }
    const id=existing?.libraryId||pendingVehicleId||(pendingVehicleId=crypto.randomUUID());
    const payload={manufacturer:vehicle.manufacturer,short:vehicle.short,buttonLabel:vehicle.buttonLabel||"",full:vehicle.full,ovoko};
    let result;
    try{result=await request("/api/workspace/vehicles",{id,revision:existing?.libraryRevision||0,payload},"PUT");}
    catch(error){
      const saved=await request(`/api/workspace/vehicles?id=${encodeURIComponent(id)}`,null,"GET").catch(()=>null);
      const same=saved?.vehicle&&["manufacturer","short","buttonLabel","full"].every(key=>saved.vehicle.payload[key]===payload[key])&&carKeys.every(key=>(saved.vehicle.payload.ovoko?.[key]||"")===(payload.ovoko?.[key]||""));
      if(!same)throw error;
      result=saved;
    }
    Object.assign(vehicle,result.vehicle.payload,{libraryId:id,libraryRevision:result.vehicle.revision});
    // Keep the local/persistent identity even if the remote write has an uncertain outcome.
    if(ovoko){try{vehicle.ovokoCarId=(await request("/api/ovoko/workspace-vehicle",{vehicleId:id,create:true})).carId;}catch(error){vehicle.ovokoCarError=error.message;}}
    return vehicle;
  }
  function capture(vehicle){
    if(!$("listingOvokoPrice"))return undefined;
    return {enabled:listingTarget!=="allegro",target:listingTarget,price:$("listingOvokoPrice").value.trim(),stockMode,categoryId:$("listingOvokoCategory").dataset.manual||"",vehicleId:vehicle?vehicle.ovoko&&vehicle.libraryId||"":restoredVehicle?.vehicleId||"",vehicleName:vehicle?vehicle.short||"":restoredVehicle?.vehicleName||""};
  }
  function restore(product){
    if(!$("listingOvokoPrice"))return;
    const data=product?.ovokoListing||{};
    restoredVehicle=product?.ovokoListing||null;
    listingTarget=data.target||(data.enabled?"both":"allegro");stockMode=data.stockMode||"shared";
    $("listingOvokoPrice").value=data.price||"";
    if(data.categoryId&&!Array.from($("listingOvokoCategory").options).some(row=>row.value===data.categoryId))$("listingOvokoCategory").add(new Option(`Kategoria ${data.categoryId}`,data.categoryId));
    $("listingOvokoCategory").value=data.categoryId||"";$("listingOvokoCategory").dataset.manual=data.categoryId||"";categoryTitle="";scheduleCategory();
  }
  function refreshVehicle(){
    if(!$("listingOvokoVehicle"))return;
    const selected=hooks?.selected(),name=selected?.libraryId?selected.short:!selected?restoredVehicle?.vehicleName:"";
    $("listingOvokoVehicle").textContent=name?`Samochod: ${name}`:"Wybierz auto z listy sesji. Uzupelnij jego dane Ovoko w oknie samochodow.";
  }
  function scheduleCategory(){
    if(!$("listingOvokoCategory")||$("listingOvokoCategory").dataset.manual)return;
    const title=$("titleInput").value.trim();if(title===categoryTitle)return;categoryTitle=title;clearTimeout(categoryTimer);const run=++categoryRun;
    if(title.length<3){$("listingOvokoCategory").options[0].textContent="Automatycznie";return;}
    categoryTimer=setTimeout(async()=>{
      try{const result=await request("/api/ovoko/workspace-category",{title});if(run!==categoryRun||$("listingOvokoCategory").dataset.manual)return;$("listingOvokoCategory").value="";$("listingOvokoCategory").options[0].textContent=result.category?`Auto: ${result.category.name}`:"Automatycznie przy wystawianiu";}
      catch{if(run===categoryRun)$("listingOvokoCategory").options[0].textContent="Automatycznie przy wystawianiu";}
    },1100);
  }
  async function preflight(product){
    const data=product.ovokoListing;if(!data?.enabled)return;
    if(!/^\d{1,7}(\.\d{1,2})?$/.test(data.price)||Number(data.price)<=0)throw new Error("Podaj osobna dodatnia cene Ovoko.");
    if(!["shared","separate"].includes(data.stockMode))throw new Error("Wybierz tryb zapasu Ovoko.");
    if(data.vehicleId)await request("/api/ovoko/workspace-vehicle",{vehicleId:data.vehicleId,create:false});
  }
  let nextItem=0;
  async function publish(product,render){
    if(!product.ovokoListing?.enabled||product.ovokoResult?.done)return;
    product.ovokoError="";product.ovokoStatus="Sprawdzam Ovoko...";render();
    try{
      await preflight(product);
      const data=product.ovokoListing;
      const binding=(await request("/api/ovoko/bulk",{operation:"start",adjustment:{mode:"none",value:"0"}})).binding;
      // The server re-reads the owned Allegro offer; this is plain description text only.
      const notes=String(product.ovokoNotes||product.descriptionText||"").slice(0,40000);
      const base={offerId:String(product.allegroOfferId),vehicleId:data.vehicleId,price:data.price,stockMode:data.stockMode,categoryId:data.categoryId||"",notes,binding};
      let result;
      do{result=await request("/api/ovoko/workspace-listing",{...base,operation:"prepare"});if(result.webPending){product.ovokoStatus="Dopasowuje auto...";render();await sleep((result.retryAfter||5)*1000);}}while(result.webPending);
      if(!result.alreadyCreated){
        const prepared=result.prepared,expectedSource=result.expectedSource;
        do{
          product.ovokoStatus="Wystawiam w Ovoko...";render();
          await sleep(Math.max(0,nextItem-Date.now()));nextItem=Date.now()+6250;
          result=await request("/api/ovoko/workspace-listing",{...base,operation:"item",prepared,expectedSource});
        }while(result.moreUnits);
      }
      product.ovokoResult={done:true,partId:result.partId,partIds:result.partIds||[result.partId]};
      product.ovokoStatus=`Ovoko: wystawiono${result.partId?` / ID ${result.partId}`:""}`;
    }catch(error){product.ovokoError=error.message;product.ovokoStatus="Ovoko: wymaga sprawdzenia";}
    render();
  }
  async function publishNative(product,render){
    if(product.ovokoResult?.done)return;
    const wasStarted=product.ovokoNativeStarted===true;
    product.ovokoError="";product.ovokoStatus="Przygotowuje Ovoko...";render();
    try{
      await preflight(product);
      if(!product.ovokoNativeSource){
        const images=await hooks.upload(product),conditionValues=product.parameterValues?.["11323"];
        const values=Array.isArray(conditionValues)?conditionValues:[conditionValues];
        const condition=values.includes("11323_1")?"new":values.some(value=>value&&value!=="11323_2")?"":"used";
        product.ovokoNativeSource={title:product.title,notes:notes(product.description),images,stock:product.stock,condition,number:product.enteredPartNumber||"",price:product.ovokoListing.price,currency:"PLN"};
      }
      const data=product.ovokoListing,base={productId:product.id,source:product.ovokoNativeSource,vehicleId:data.vehicleId||"",categoryId:data.categoryId||""};
      let result;
      do{result=await request("/api/ovoko/workspace-native",{...base,operation:"prepare"});if(result.webPending){product.ovokoStatus="Dopasowuje auto...";render();await sleep((result.retryAfter||5)*1000);}}while(result.webPending);
      if(!result.alreadyCreated){
        const ticket=result.ticket;
        do{
          product.ovokoNativeStarted=true;product.ovokoStatus="Wystawiam w Ovoko...";render();
          await sleep(Math.max(0,nextItem-Date.now()));nextItem=Date.now()+6250;
          result=await request("/api/ovoko/workspace-native",{...base,operation:"item",ticket});
        }while(result.moreUnits);
      }
      product.ovokoResult={done:true,native:true,partId:result.partId,partIds:result.partIds||[result.partId]};
      product.ovokoStatus=`Ovoko: wystawiono / ID ${result.partId}`;
    }catch(error){if(error.code==="native_not_sent"&&!wasStarted)delete product.ovokoNativeStarted;product.ovokoError=error.message;product.ovokoStatus="Ovoko: wymaga sprawdzenia";}
    render();document.dispatchEvent(new Event("wystawiacz-session-change"));
  }
  function notes(description){
    const template=document.createElement("template");
    template.innerHTML=(description?.sections||[]).flatMap(section=>section.items||[]).filter(item=>item.type==="TEXT").map(item=>item.content||"").join("\n");
    template.content.querySelectorAll("script,style,iframe,object,embed,svg,math").forEach(node=>node.remove());
    template.content.querySelectorAll("br").forEach(node=>node.replaceWith(document.createTextNode("\n")));
    template.content.querySelectorAll("p,li,h1,h2,h3,h4,div").forEach(node=>node.appendChild(document.createTextNode("\n")));
    return (template.content.textContent||"").trim().slice(0,40000);
  }
  async function editPublished(product,render){
    const dialog=document.createElement("dialog");dialog.className="workspace-ovoko-panel";
    const data=product.ovokoListing;
    dialog.innerHTML=`<h3>Popraw tylko Ovoko</h3><p>Oferta Allegro pozostaje bez zmian. Poprawienie danych nie usuwa rejestru poprzedniej wysylki.</p><label>Cena Ovoko<input data-price type="number" min="0.01" step="0.01"></label><label>Samochod<select data-car></select></label><label>Kategoria Ovoko<select data-category><option value="">Automatycznie</option></select></label><p data-status role="status">Wczytuje dane...</p><button type="button" data-save disabled>Zapisz ustawienia Ovoko</button> <button type="button" data-close>Zamknij</button>`;
    const price=dialog.querySelector("[data-price]"),car=dialog.querySelector("[data-car]"),category=dialog.querySelector("[data-category]"),status=dialog.querySelector("[data-status]"),save=dialog.querySelector("[data-save]");
    price.value=data.price;
    dialog.querySelectorAll("button").forEach(button=>button.classList.add("secondary-button"));
    dialog.querySelector("[data-close]").onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
    try{
      const result=await request("/api/workspace/vehicles",null,"GET");
      const vehicles=result.vehicles.filter(row=>row.payload.ovoko);
      if(data.vehicleId&&!vehicles.some(row=>row.id===data.vehicleId)){const old=await request(`/api/workspace/vehicles?id=${encodeURIComponent(data.vehicleId)}`,null,"GET");vehicles.push(old.vehicle);}
      options(car,vehicles.map(row=>({id:row.id,name:row.payload.short})),"Wybierz samochod",data.vehicleId);
      try{options(category,(await read("categories")).filter(row=>row.level==="3"),"Automatycznie",data.categoryId);}catch(error){status.textContent=error.message;}
      if(data.categoryId&&!Array.from(category.options).some(row=>row.value===data.categoryId))category.add(new Option(`Kategoria ${data.categoryId}`,data.categoryId));
      category.value=data.categoryId||"";save.disabled=false;status.textContent="Po zapisaniu kliknij Ponow tylko Ovoko przy tej czesci.";
      save.onclick=()=>{
        if(!/^\d{1,7}(\.\d{1,2})?$/.test(price.value)||Number(price.value)<=0){status.textContent="Podaj dodatnia cene.";return;}
        product.ovokoListing={...data,vehicleId:car.value,vehicleName:car.options[car.selectedIndex].textContent,price:price.value,categoryId:category.value};
        if(!product.ovokoNativeStarted)delete product.ovokoNativeSource;
        product.ovokoError="";render();document.dispatchEvent(new Event("wystawiacz-session-change"));dialog.close();
      };
    }catch(error){status.textContent=error.message;}
  }
  return {mount,capture,restore,refreshVehicle,editorReset,editorRestore,saveVehicle,preflight,publish,publishNative,notes,editPublished,scheduleCategory};
})();
