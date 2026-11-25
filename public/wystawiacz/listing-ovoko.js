/* Optional Ovoko channel; the existing Allegro form remains the default. */
window.ListingOvoko = (() => {
  const $ = id => document.getElementById(id);
  const esc = value => { const el=document.createElement("span"); el.textContent=String(value??""); return el.innerHTML; };
  let hooks, library=[], offset=0, more=true, loading=false, modelsRun=0, pendingVehicleId="", restoredVehicle=null;
  const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const carKeys=["brandId","modelId","year","vin","engineCode","capacity","power","mileage","color","place"];
  async function request(path,body,method="POST") {
    const token=await window.getWystawiaczToken();
    if(!token)throw new Error("Zaloguj sie ponownie do Wystawiacza.");
    const response=await fetch(path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw new Error(`Serwer nie zwrocil JSON (HTTP ${response.status}). Sprawdz wynik przed ponowieniem.`);}
    if(!response.ok)throw new Error(data.message||`HTTP ${response.status}`);
    return data;
  }
  const read=async(operation,extra={})=>(await request("/api/ovoko/read",{useSaved:true,operation,...extra})).rows;
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
    $("workspaceCarsMore").hidden=!more;
    $("workspaceCarsList").querySelectorAll("[data-library-car]").forEach(button=>button.onclick=()=>{
      const row=library.find(item=>item.id===button.dataset.libraryCar);
      hooks.importVehicle({...row.payload,id:row.id,libraryId:row.id,libraryRevision:row.revision});
      $("workspaceCarsStatus").textContent="Dodano zapisane auto do tej sesji. Wybierz jego przycisk przy czesci.";
    });
  }
  async function loadLibrary(reset=false){
    if(loading)return;loading=true;$("workspaceCarsStatus").textContent="Wczytuje Moje samochody...";
    try{
      const page=reset?0:offset;
      const result=await request(`/api/workspace/vehicles?offset=${page}`,null,"GET");
      if(!Array.isArray(result.vehicles))throw new Error("Nieprawidlowa lista samochodow.");
      if(reset)library=[];
      for(const row of result.vehicles){library=library.filter(old=>old.id!==row.id);library.push(row);}
      offset=page+result.vehicles.length;more=result.vehicles.length===100;
      libraryRender();$("workspaceCarsStatus").textContent="Auta zostaja na koncie takze po rozpoczeciu nowej sesji. Usun z sesji nie usuwa ich z Moich samochodow.";
    }catch(error){showError(error);}finally{loading=false;}
  }
  function mount(callbacks){
    hooks=callbacks;
    const channel=document.createElement("section");channel.className="workspace-ovoko-panel";
    channel.innerHTML=`<label><input type="checkbox" id="listingOvokoEnabled"> Wystaw takze w Ovoko</label><div id="listingOvokoFields" hidden><p>Najpierw Allegro, potem Ovoko. Te same zdjecia i opis; czesc trafi do wybranego samochodu. Synchronizacje sprzedazy wlaczasz osobno.</p><div class="workspace-ovoko-grid"><label>Cena Ovoko za sztuke (waluta jak w Allegro)<input id="listingOvokoPrice" type="number" min="0.01" step="0.01" placeholder="Osobna cena Ovoko"></label><label>Wiele sztuk<select id="listingOvokoStock"><option value="shared">Jedna pozycja dla calego zapasu</option><option value="separate">Kazda sztuka osobno</option></select></label></div><details id="listingOvokoCategoryDetails"><summary>Kategoria Ovoko (opcjonalnie, gdy automat nie dopasuje)</summary><select id="listingOvokoCategory" aria-label="Kategoria Ovoko"><option value="">Automatycznie</option></select></details><p id="listingOvokoVehicle"></p></div>`;
    $("priceInput").closest(".pricing-final-row").after(channel);
    $("listingOvokoEnabled").onchange=()=>{$("listingOvokoFields").hidden=!$("listingOvokoEnabled").checked;refreshVehicle();};
    $("listingOvokoCategoryDetails").ontoggle=async()=>{
      if(!$("listingOvokoCategoryDetails").open||$("listingOvokoCategory").options.length>1)return;
      try{options($("listingOvokoCategory"),(await read("categories")).filter(row=>row.level==="3"),"Automatycznie");}catch(error){hooks.toast(error.message);}
    };
    const archive=document.createElement("section");archive.className="workspace-ovoko-panel";
    archive.innerHTML=`<h3>Moje samochody - ze wszystkich sesji</h3><input id="workspaceCarsSearch" type="search" placeholder="Szukaj auta / VIN" aria-label="Szukaj w Moich samochodach"><button type="button" id="workspaceCarsReload">Odswiez liste</button><div id="workspaceCarsList" class="workspace-cars-library"></div><button type="button" id="workspaceCarsMore" hidden>Wczytaj starsze auta</button><p id="workspaceCarsStatus" role="status"></p>`;
    $("vehicleList").before(archive);
    $("workspaceCarsSearch").oninput=libraryRender;
    $("workspaceCarsReload").onclick=()=>loadLibrary(true);
    $("workspaceCarsMore").onclick=()=>loadLibrary();
    new MutationObserver(()=>{if($("vehiclesDialog").open)loadLibrary(true);}).observe($("vehiclesDialog"),{attributes:true,attributeFilter:["open"]});
    const form=document.createElement("details");form.id="workspaceCarOvokoDetails";form.className="workspace-ovoko-panel";
    form.innerHTML=`<summary>Dane samochodu w Ovoko (opcjonalnie)</summary><label><input type="checkbox" id="workspaceCarOvokoEnabled"> Zapisz ten samochod takze w Ovoko</label><p>Utworzymy konkretnego dawce. Zapisane dane techniczne polaczonego auta sa stale; nazwe i opis mozesz edytowac.</p><div class="workspace-ovoko-grid"><label>Marka Ovoko<select id="workspaceCarBrandId"><option value="">Wybierz marke</option></select></label><label>Model Ovoko<select id="workspaceCarModelId"><option value="">Wybierz model</option></select></label>${[["year","Rok produkcji","number"],["vin","VIN (opcjonalnie)","text"],["engineCode","Kod silnika","text"],["capacity","Pojemnosc cm3","number"],["power","Moc kW","number"],["mileage","Przebieg km","number"],["color","Kolor","text"],["place","Miejsce w magazynie","text"]].map(([key,label,type])=>`<label>${label}<input id="workspaceCar${key[0].toUpperCase()+key.slice(1)}" type="${type}" ${type==="number"?'min="0" step="1"':'maxlength="100"'}></label>`).join("")}</div>`;
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
    loadLibrary(true);
    return vehicle;
  }
  function capture(vehicle){
    if(!$("listingOvokoEnabled"))return undefined;
    return {enabled:$("listingOvokoEnabled").checked,price:$("listingOvokoPrice").value.trim(),stockMode:$("listingOvokoStock").value,categoryId:$("listingOvokoCategory").value,vehicleId:vehicle?vehicle.libraryId||"":restoredVehicle?.vehicleId||"",vehicleName:vehicle?vehicle.short||"":restoredVehicle?.vehicleName||""};
  }
  function restore(product){
    if(!$("listingOvokoEnabled"))return;
    const data=product?.ovokoListing||{};
    restoredVehicle=product?.ovokoListing||null;
    $("listingOvokoEnabled").checked=data.enabled===true;$("listingOvokoFields").hidden=!data.enabled;
    $("listingOvokoPrice").value=data.price||"";$("listingOvokoStock").value=data.stockMode||"shared";
    if(data.categoryId&&!Array.from($("listingOvokoCategory").options).some(row=>row.value===data.categoryId))$("listingOvokoCategory").add(new Option(`Kategoria ${data.categoryId}`,data.categoryId));
    $("listingOvokoCategory").value=data.categoryId||"";refreshVehicle();
  }
  function refreshVehicle(){
    if(!$("listingOvokoVehicle"))return;
    const selected=hooks?.selected(),name=selected?.libraryId?selected.short:!selected?restoredVehicle?.vehicleName:"";
    $("listingOvokoVehicle").textContent=name?`Samochod: ${name}`:"Wybierz auto z listy sesji. Uzupelnij jego dane Ovoko w oknie samochodow.";
  }
  async function preflight(product){
    const data=product.ovokoListing;if(!data?.enabled)return;
    if(!data.vehicleId)throw new Error("Ovoko: wybierz samochod zapisany w Moich samochodach.");
    if(!/^\d{1,7}(\.\d{1,2})?$/.test(data.price)||Number(data.price)<=0)throw new Error("Podaj osobna dodatnia cene Ovoko.");
    if(!["shared","separate"].includes(data.stockMode))throw new Error("Wybierz tryb zapasu Ovoko.");
    await request("/api/ovoko/workspace-vehicle",{vehicleId:data.vehicleId,create:false});
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
      let result=await request("/api/ovoko/workspace-listing",{...base,operation:"prepare"});
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
        if(!car.value||!/^\d{1,7}(\.\d{1,2})?$/.test(price.value)||Number(price.value)<=0){status.textContent="Wybierz auto i podaj dodatnia cene.";return;}
        product.ovokoListing={...data,vehicleId:car.value,vehicleName:car.options[car.selectedIndex].textContent,price:price.value,categoryId:category.value};
        product.ovokoError="";render();document.dispatchEvent(new Event("wystawiacz-session-change"));dialog.close();
      };
    }catch(error){status.textContent=error.message;}
  }
  return {mount,capture,restore,refreshVehicle,editorReset,editorRestore,saveVehicle,preflight,publish,notes,editPublished};
})();
