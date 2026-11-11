(function () {
  const banner = document.createElement("section"); banner.className = "beta-banner";
  banner.innerHTML = '<div><strong>WYSTAWIACZ BETA - bez publikacji</strong><small>Osobna kopia edytora. Dane i nagrania bety zostaja na tym komputerze. Nie zapisujemy stabilnych sesji.</small></div><a href="/panel" target="_top">Panel konta</a><a href="/panel/offers" target="_top">Stabilny Wystawiacz</a>';
  document.querySelector(".page-shell").prepend(banner);
  document.querySelector(".brand strong").textContent = "Wystawiacz Beta";
  const connectionLink = document.createElement("a"); connectionLink.href = "/panel/allegro"; connectionLink.target = "_blank"; connectionLink.rel = "noopener noreferrer"; connectionLink.textContent = "Polaczenie Allegro w panelu"; banner.append(connectionLink);
  const panel = document.createElement("section"); panel.className = "beta-workflow";
  panel.innerHTML = '<h2>1. Podziel zdjecia na aukcje</h2><small>Kliknij Nowy zestaw, zaznacz zdjecia jednej czesci w galerii i utworz aukcje. Oryginalnych plikow nie przenosimy ani nie usuwamy. QR dodamy w kolejnym etapie.</small><div class="beta-actions"><button id="betaNew" type="button">Nowy zestaw</button><button id="betaCreate" type="button">Utworz aukcje z zaznaczonych zdjec</button><button id="betaSave" type="button">Zapisz bete na komputerze</button><button id="betaRestore" type="button" hidden>Przywroc zapis bety</button></div><p id="betaStorageStatus" class="beta-status" role="status"></p><div id="betaBatches" class="beta-batches" aria-label="Aukcje ze zdjec"></div><h2>2. Komentarz do wybranej aukcji</h2><p id="betaCurrent"></p><textarea id="betaComment" maxlength="6000" placeholder="Napisz lub nagraj: co to za czesc, numer, strona, stan, uszkodzenia, cena, regal..." aria-label="Komentarz do aukcji beta"></textarea><div class="beta-actions"><button id="betaRecord" type="button">Nagraj komentarz</button><button id="betaStop" type="button" disabled>Zatrzymaj nagranie</button><button id="betaDownloadAudio" type="button" disabled>Zapisz nagranie do pliku</button></div><audio id="betaAudio" controls hidden></audio><label class="beta-consent"><input id="betaConsent" type="checkbox"><span>Zgadzam sie wyslac wybrany komentarz lub nagranie do OpenAI w celu transkrypcji i przygotowania pol. Nie wysylamy zdjec. Nie nagrywaj danych klientow ani hasel. Usluga API moze generowac koszty.</span></label><div class="beta-actions"><button id="betaTranscribe" type="button">Przepisz nagranie</button><button id="betaSuggest" type="button">AI: przygotuj pola z komentarza</button><button id="betaCancelAI" type="button" disabled>Anuluj oczekiwanie</button></div><p id="betaStatus" class="beta-status" role="status"></p><div id="betaProposal" class="beta-proposal" hidden></div>';
  document.querySelector(".workspace-grid").before(panel);
  const el = id => document.getElementById(id);
  const aiStatus = document.createElement("small"); aiStatus.id = "betaAIStatus"; aiStatus.textContent = "Sprawdzam konfiguracje AI..."; el("betaConsent").closest("label").before(aiStatus);
  const recordings = new Map(), persistedPhotos = new Map(), persistedAudio = new Map();
  let db, existing, ready = false, saving = false, dirty = false, timer, recording = false, pending = false, recorder, stream, audioUrl = "", lastId = "", controller, proposal = null, aiAvailable = false;
  const current = () => state.products.find(product => product.id === activeProductId);
  function status(message, error = false) { el("betaStatus").textContent = message; el("betaStatus").classList.toggle("error", error); }
  function storageStatus(message, error = false) { el("betaStorageStatus").textContent = message; el("betaStorageStatus").classList.toggle("error", error); }
  function writable() { if (!ready) { status("Najpierw przywroc poprzedni zapis bety albo poczekaj na otwarcie pamieci.", true); return false; } if (recording || pending) { status("Zakoncz nagranie lub przetwarzanie przed zmiana aukcji.", true); return false; } return true; }
  function sync() {
    const product = current();
    const list = el("betaBatches"); list.replaceChildren();
    state.products.forEach((item, index) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.betaProduct = item.id;
      b.textContent = `${index + 1}. ${item.title || "Bez nazwy"} (${item.photoNames?.length || 0} zdj.)`;
      b.setAttribute("aria-pressed", String(item.id === activeProductId));
      b.onclick = () => { if (writable()) editProduct(item.id); }; list.append(b);
    });
    el("betaCurrent").textContent = product ? `Komentarz przypisany do aukcji ${state.products.indexOf(product) + 1}: ${product.title || "Bez nazwy"}${product.betaLocation ? ` | Magazyn: ${product.betaLocation}` : ""}` : "Utworz zestaw zdjec lub wybierz aukcje powyzej.";
    if (lastId !== activeProductId) {
      lastId = activeProductId; el("betaComment").value = product?.betaComment || ""; clearProposal(); status("");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      const audio = recordings.get(activeProductId); audioUrl = audio ? URL.createObjectURL(audio) : "";
      el("betaAudio").hidden = !audioUrl; if (audioUrl) el("betaAudio").src = audioUrl; else el("betaAudio").removeAttribute("src");
    }
    el("betaComment").disabled = !product || pending;
    el("betaRecord").disabled = !product || recording || pending;
    el("betaStop").disabled = !recording || !recorder || recorder.state !== "recording";
    el("betaTranscribe").disabled = !aiAvailable || !product || !recordings.has(activeProductId) || recording || pending;
    el("betaSuggest").disabled = !aiAvailable || !product || !el("betaComment").value.trim() || recording || pending;
    el("betaDownloadAudio").disabled = !product || !recordings.has(activeProductId);
    el("betaCancelAI").disabled = !pending;
    document.querySelectorAll("#publishCurrentButton,#publishSelectedProducts,[data-publish-product-id]").forEach(button => { button.disabled = true; button.title = "Publikacja w becie jest zablokowana"; });
  }
  const originalEdit = editProduct;
  editProduct = function (id) { if (!writable()) return; if (activeProductId && activeProductId !== id) saveActiveProductDraft(); originalEdit(id); sync(); schedule(); };
  const originalRender = renderProducts;
  renderProducts = function () { originalRender(); sync(); };
  const originalTogglePhoto = togglePhoto;
  togglePhoto = function (name) {
    if (!state.selectedPhotoNames.includes(name) && state.products.some(product => product.id !== activeProductId && product.photoNames?.includes(name))) { status("To zdjecie jest juz w innej aukcji. Najpierw usun je z tamtego zestawu, jesli chcesz je przeniesc.", true); return; }
    originalTogglePhoto(name); schedule();
  };
  publishProduct = async function () { status("Publikacja z bety jest zablokowana. Stabilny Wystawiacz pozostaje bez zmian.", true); };
  document.addEventListener("click", event => {
    if ((recording || pending) && event.target.closest("button") && !event.target.closest("#betaStop,#betaCancelAI")) { event.preventDefault(); event.stopImmediatePropagation(); status("Najpierw zakoncz nagranie lub anuluj oczekiwanie.", true); }
  }, true);
  el("betaNew").onclick = () => { if (!writable()) return; if (activeProductId) saveActiveProductDraft(); resetForm(); sync(); schedule(); document.querySelector(".photos-card").scrollIntoView({ block: "start", behavior: "smooth" }); };
  el("betaCreate").onclick = () => {
    if (!writable()) return;
    if (activeProductId) { status("Kliknij Nowy zestaw przed wyborem zdjec kolejnej czesci. Obecna aukcja zostaje zapisana.", true); return; }
    const names = [...state.selectedPhotoNames];
    if (!names.length) { status("Zaznacz zdjecia jednej czesci w galerii.", true); return; }
    const duplicate = state.products.find(product => product.photoNames?.some(name => names.includes(name)));
    if (duplicate) { status("Nie utworzono duplikatu: czesc wybranych zdjec jest juz przypisana do aukcji. Odznacz je albo popraw poprzedni zestaw.", true); return; }
    const product = { ...getFormProduct(crypto.randomUUID()), title: titleInput.value.trim() || `Czesc ${state.products.length + 1}`, betaComment: "", photoNames: names };
    state.products.push(product); editProduct(product.id); status(`Utworzono aukcje z ${names.length} zdjec. Teraz dodaj komentarz.`); schedule();
  };
  el("betaComment").oninput = () => { const product = current(); if (product) product.betaComment = el("betaComment").value; clearProposal(); sync(); schedule(); };
  function clearProposal() { proposal = null; el("betaProposal").replaceChildren(); el("betaProposal").hidden = true; }
  function stopTracks() { stream?.getTracks().forEach(track => track.stop()); stream = null; }
  el("betaRecord").onclick = async () => {
    const product = current(); if (!product || !writable()) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { status("Ta przegladarka nie obsluguje nagrywania. Mozesz wpisac komentarz tekstowy.", true); return; }
    if (recordings.has(product.id) && !confirm("Zastapic poprzednie nagranie tej aukcji? Najpierw mozesz je zapisac do pliku.")) return;
    const id = product.id; recording = true; sync(); status("Oczekiwanie na zgode mikrofonu...");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = []; let size = 0, tooLarge = false;
      recorder.ondataavailable = event => { if (event.data.size) { size += event.data.size; chunks.push(event.data); if (size > 8 * 1024 * 1024) { tooLarge = true; if (recorder.state === "recording") recorder.stop(); } } };
      recorder.onerror = () => { status("Blad mikrofonu. Nie zastapiono poprzedniego nagrania.", true); tooLarge = true; if (recorder.state === "recording") recorder.stop(); };
      const stopTimer = setTimeout(() => { if (recorder?.state === "recording") recorder.stop(); }, 120000);
      recorder.onstop = () => {
        clearTimeout(stopTimer); stopTracks(); recording = false;
        if (!tooLarge && size) { recordings.set(id, new Blob(chunks, { type: recorder.mimeType || "audio/webm" })); lastId = ""; sync(); schedule(); status("Nagranie zapisane przy tej aukcji. Mozesz je odsluchac lub przepisac przez AI."); }
        else { status("Nagranie puste lub za duze (maks. 8 MB). Poprzednie pozostalo bez zmian.", true); sync(); }
      };
      recorder.start(1000); sync(); status("Nagrywam komentarz tej aukcji (maks. 2 minuty). Kliknij Zatrzymaj nagranie.");
    } catch { recording = false; stopTracks(); sync(); status("Brak dostepu do mikrofonu. Zezwol w przegladarce albo wpisz komentarz.", true); }
  };
  el("betaStop").onclick = () => { if (recorder?.state === "recording") recorder.stop(); };
  el("betaDownloadAudio").onclick = () => { const blob = recordings.get(activeProductId); if (!blob) return; const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = `beta-komentarz-${activeProductId}.${blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm"}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  async function ai(path, body, type) {
    if (!el("betaConsent").checked) throw new Error("Najpierw zaznacz zgode na wyslanie wybranego komentarza do AI.");
    const token = await window.getWystawiaczToken();
    const response = await fetch(`/api/beta/${path}`, { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${token}`, ...(type ? { "Content-Type": type } : {}) }, body });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || "Blad AI."); return data;
  }
  async function process(transcribe) {
    const product = current(); if (!product || !writable()) return;
    pending = true; controller = new AbortController(); sync(); clearProposal();
    status(transcribe ? "Przepisuje wybrane nagranie..." : "AI przygotowuje propozycje. Pola nie zostana nadpisane bez zatwierdzenia.");
    try {
      if (transcribe) {
        const blob = recordings.get(product.id); if (!blob) throw new Error("Brak nagrania tej aukcji.");
        const form = new FormData(); form.set("audio", blob, "komentarz.webm");
        const data = await ai("transcribe", form);
        if (product.betaComment && !confirm("Zastapic obecny komentarz transkrypcja nagrania?")) { status("Komentarz pozostawiono bez zmian."); return; }
        product.betaComment = data.text; el("betaComment").value = data.text; status("Przepisano nagranie. Sprawdz szczegolnie numer czesci, potem kliknij AI: przygotuj pola."); schedule();
      } else {
        const data = await ai("suggest", JSON.stringify({ comment: el("betaComment").value }), "application/json");
        proposal = { id: product.id, values: data.proposal }; showProposal(); status("Sprawdz propozycje i zaznacz pola do uzupelnienia. AI nie sprawdza kompatybilnosci ani cen na Allegro.");
      }
    } catch (error) { status(error.name === "AbortError" ? "Anulowano oczekiwanie. Pola pozostaly bez zmian." : error.message, true); }
    finally { pending = false; controller = null; sync(); }
  }
  el("betaTranscribe").onclick = () => void process(true);
  el("betaSuggest").onclick = () => void process(false);
  el("betaCancelAI").onclick = () => controller?.abort();
  function proposalFields(values) {
    const name = [values.partName, values.side].filter(Boolean).join(" ");
    return [
      { id: "title", label: "Nazwa i strona", value: name, current: titleInput.value, empty: !titleInput.value.trim() || /^Czesc \d+$/.test(titleInput.value) },
      { id: "number", label: "Numer czesci", value: values.partNumber, current: partNumber.value, empty: !partNumber.value.trim() },
      { id: "price", label: "Twoja cena PLN", value: values.pricePLN, current: priceInput.value, empty: !priceInput.value.trim() },
      { id: "notes", label: "Stan / uszkodzenia w opisie", value: values.conditionNotes, current: state.descriptionText, empty: !state.descriptionManuallyEdited },
      { id: "location", label: "Lokalizacja magazynowa (notatka)", value: values.location, current: current()?.betaLocation || "", empty: !current()?.betaLocation }
    ].filter(field => typeof field.value === "string" && field.value.trim());
  }
  function showProposal() {
    const box = el("betaProposal"); box.replaceChildren(); box.hidden = false;
    for (const field of proposalFields(proposal.values)) {
      const label = document.createElement("label"), checkbox = document.createElement("input"), text = document.createElement("span");
      checkbox.type = "checkbox"; checkbox.dataset.betaField = field.id; checkbox.checked = field.empty;
      text.textContent = `${field.label}: ${field.value}${field.empty ? "" : " (pole juz ma wartosc - zaznacz tylko jesli chcesz zastapic)"}`;
      label.append(checkbox, text); box.append(label);
    }
    const warning = document.createElement("p"); warning.textContent = ["Numer i stan czesci wymagaja Twojego sprawdzenia.", ...(proposal.values.warnings || [])].join("\n"); box.append(warning);
    const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Zastosuj zaznaczone propozycje"; apply.onclick = applyProposal; box.append(apply);
  }
  function applyProposal() {
    if (!proposal || proposal.id !== activeProductId || !writable()) return;
    const chosen = new Set([...el("betaProposal").querySelectorAll("input:checked")].map(input => input.dataset.betaField));
    const fields = proposalFields(proposal.values).filter(field => chosen.has(field.id));
    if (!fields.length) { status("Zaznacz pola do uzupelnienia.", true); return; }
    if (fields.some(field => !field.empty) && !confirm("Zastapic zaznaczone, juz wypelnione pola propozycjami AI?")) return;
    const values = proposal.values, product = current();
    if (chosen.has("title")) { titleInput.value = [[values.partName, values.side].filter(Boolean).join(" "), getSelectedVehicle()?.short].filter(Boolean).join(" "); state.appendedPartNumber = ""; titleInput.dispatchEvent(new Event("input", { bubbles: true })); }
    if (chosen.has("number")) { partNumber.value = values.partNumber; partNumber.dispatchEvent(new Event("input", { bubbles: true })); }
    else if (chosen.has("title")) appendPartNumberToTitle();
    if (chosen.has("price")) priceInput.value = values.pricePLN.replace(",", ".");
    if (chosen.has("notes")) { descriptionTextInput.value = `{{TYTUL}}\n\n${values.conditionNotes}\n\n{{AUTO}}`; state.descriptionFullLayout = true; descriptionTextInput.dispatchEvent(new Event("input", { bubbles: true })); }
    if (chosen.has("location")) product.betaLocation = values.location;
    saveActiveProductDraft(); updateSummary(); clearProposal(); schedule(); status("Uzupelniono zaznaczone pola. Sprawdz tytul, numer i opis. Niczego nie wystawiono.");
  }
  function schedule() { dirty = true; if (!ready) return; clearTimeout(timer); timer = setTimeout(() => void save(), 900); }
  async function openDb() {
    if (!window.BetaOwner) throw new Error("Otworz bete przez panel konta.");
    return new Promise((resolve, reject) => { const req = indexedDB.open(`wystawiacz-beta-v1-${window.BetaOwner}`, 1); req.onupgradeneeded = () => { for (const name of ["session", "photos", "audio"]) req.result.createObjectStore(name); }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }
  function getAll(store) { return new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function save() {
    if (!ready || !db) return;
    dirty = true; if (saving || recording) return;
    saving = true; dirty = false;
    try {
      const payload = window.BetaSession.snapshot();
      const photos = [...state.localPhotosByName.values()].filter(photo => persistedPhotos.get(photo.name) !== photo.file);
      const audio = [...recordings].filter(([id, blob]) => persistedAudio.get(id) !== blob);
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(["session", "photos", "audio"], "readwrite");
        transaction.objectStore("session").put({ savedAt: Date.now(), payload }, "current");
        for (const photo of photos) transaction.objectStore("photos").put({ name: photo.name, file: photo.file }, photo.name);
        for (const [id, blob] of audio) transaction.objectStore("audio").put({ id, blob }, id);
        transaction.oncomplete = resolve; transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Blad zapisu"));
      });
      for (const photo of photos) persistedPhotos.set(photo.name, photo.file);
      for (const [id, blob] of audio) persistedAudio.set(id, blob);
      storageStatus(`Zapisano bete lokalnie: ${new Date().toLocaleTimeString("pl-PL")}. Zdjecia i nagrania sa w pamieci tej przegladarki. Nie czysc danych witryny bez kopii.`);
    } catch { dirty = true; storageStatus("Nie zapisano bety! Mozliwy brak miejsca lub blokada pamieci. Nie zamykaj karty: wyeksportuj sesje JSON i nagrania; zachowaj oryginalny folder zdjec.", true); }
    finally { saving = false; if (dirty && !recording) { clearTimeout(timer); timer = setTimeout(() => void save(), 5000); } }
  }
  el("betaSave").onclick = () => { if (writable()) void save(); };
  el("betaRestore").onclick = async () => {
    if (recording || pending || !existing || !confirm("Przywrocic ostatni lokalny zapis bety? Obecny formularz bety zostanie zastapiony. Stabilny Wystawiacz nie jest zmieniany.")) return;
    try {
      const photos = await getAll("photos"), audio = await getAll("audio");
      for (const photo of photos) { state.localPhotosByName.set(photo.name, { ...photo, url: URL.createObjectURL(photo.file) }); persistedPhotos.set(photo.name, photo.file); }
      for (const record of audio) { recordings.set(record.id, record.blob); persistedAudio.set(record.id, record.blob); }
      ready = true; await window.BetaSession.restore(existing.payload);
      if (existing.payload.activeProductId && state.products.some(product => product.id === existing.payload.activeProductId)) editProduct(existing.payload.activeProductId);
      el("betaRestore").hidden = true; lastId = ""; sync(); storageStatus("Przywrocono bete wraz ze zdjeciami i nagraniami. Autozapis aktywny.");
    } catch { ready = false; storageStatus("Nie przywrocono zapisu. Nie nadpisujemy go. Odswiez karte i sprobuj ponownie.", true); }
  };
  document.addEventListener("input", schedule); document.addEventListener("change", schedule); document.addEventListener("wystawiacz-session-change", schedule);
  window.addEventListener("beforeunload", event => { if (recording || pending || saving || dirty) { event.preventDefault(); event.returnValue = ""; } });
  // Duplicate filenames would make photo-to-auction links ambiguous, so reject before the base importer runs.
  relinkFolderInput.addEventListener("change", event => {
    const names = new Set();
    for (const file of relinkFolderInput.files) {
      if (names.has(file.name)) { event.stopImmediatePropagation(); event.preventDefault(); relinkFolderInput.value = ""; status("Folder zawiera powtorzone nazwy plikow. Nadaj zdjeciom unikalne nazwy przed importem.", true); return; }
      const previous = state.localPhotosByName.get(file.name)?.file;
      if (previous && (previous.size !== file.size || previous.lastModified !== file.lastModified)) { event.stopImmediatePropagation(); event.preventDefault(); relinkFolderInput.value = ""; status("Plik o tej nazwie ma juz inne dane w becie. Zmien nazwe nowego zdjecia, aby nie podmienic zdjec poprzedniej czesci.", true); return; }
      names.add(file.name);
    }
  }, true);
  window.BetaWorkflow = { save };
  void window.getWystawiaczToken().then(token => fetch("/api/beta/status", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })).then(async response => {
    if (!response.ok) throw new Error("status");
    const data = await response.json(); aiAvailable = data.aiEnabled === true;
    aiStatus.textContent = aiAvailable ? "AI dostepne. Wysylanie komentarza wymaga Twojej zgody i klikniecia przycisku." : "AI jest wylaczone na serwerze. Mozesz dzielic zdjecia i nagrywac komentarze. Wlaczenie: BETA_AI_ENABLED=true oraz serwerowy OPENAI_API_KEY.";
    sync();
  }).catch(() => { aiStatus.textContent = "Nie odczytano konfiguracji AI. Odswiez karte lub sprawdz dostep do bety. Niczego nie wyslano do AI."; sync(); });
  void openDb().then(async database => {
    db = database;
    existing = await new Promise((resolve, reject) => { const request = db.transaction("session").objectStore("session").get("current"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (existing) { el("betaRestore").hidden = false; storageStatus(`Istnieje lokalny zapis bety z ${new Date(existing.savedAt).toLocaleString("pl-PL")}. Kliknij Przywroc zapis bety. Do tego czasu autozapis jest wstrzymany, aby go nie nadpisac.`); }
    else { ready = true; storageStatus("Beta gotowa. Autozapis lokalny aktywny. Zacznij od wskazania folderu zdjec."); }
    sync();
  }).catch(() => storageStatus("Pamiec bety niedostepna. Nie rozpoczynaj pracy bez zapisu. Sprawdz uprawnienia przegladarki.", true));
  sync();
})();
