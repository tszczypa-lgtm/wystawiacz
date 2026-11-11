(function () {
  const payload = "WYSTAWIACZ:BETA:SEPARATOR:1";
  const collator = new Intl.Collator("pl", { numeric: true, sensitivity: "base" });
  const compare = (a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  function paint(canvas) {
    if (typeof qrcode !== "function") throw new Error("Nie zaladowano generatora QR. Odswiez bete.");
    const code = qrcode(0, "H"); code.addData(payload); code.make();
    const modules = code.getModuleCount(), cell = 10, margin = 4;
    canvas.width = canvas.height = (modules + 2 * margin) * cell;
    const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "black";
    for (let y = 0; y < modules; y++) for (let x = 0; x < modules; x++) if (code.isDark(y, x)) context.fillRect((x + margin) * cell, (y + margin) * cell, cell, cell);
    return canvas;
  }
  function partition(items, boundaries) {
    const groups = []; let group = [];
    const flush = () => { if (group.length) groups.push(group); group = []; };
    for (const item of items) {
      if (boundaries.has(item.name)) flush();
      if (item.kind === "separator") { flush(); continue; }
      group.push(item.name);
    }
    flush(); return groups;
  }
  window.BetaQR = { payload, paint, partition, compare, mount(options) {
    const manual = new Set(), cache = new WeakMap(), recognized = new Set();
    let scanning = false, cancelled = false, preview = null, revision = 0;
    const toolbar = document.createElement("div"); toolbar.className = "beta-qr-tools";
    toolbar.innerHTML = '<button id="betaMakeQR" type="button">Utworz QR</button><button id="betaSplitAI" type="button" title="Lokalny podzial calego folderu po QR i recznych separatorach. Bez wysylania zdjec do AI.">Utworz aukcje AI</button><button id="betaManualQR" type="button" aria-pressed="false" title="Wstaw lub usun separator przed biezacym zdjeciem">Dodaj separator recznie</button><button id="betaCancelSplit" type="button" hidden>Anuluj skanowanie</button><small id="betaQrStatus" role="status"></small>';
    document.querySelector(".photos-card .card-heading").after(toolbar);
    const el = id => document.getElementById(id);
    const report = (message, error = false) => { el("betaQrStatus").textContent = message; el("betaQrStatus").classList.toggle("error", error); };
    const qrDialog = document.createElement("dialog"); qrDialog.id = "betaQrDialog";
    qrDialog.innerHTML = '<h2>Nastepna czesc</h2><canvas id="betaQrCanvas" aria-label="Kod QR separatora aukcji"></canvas><p>Fotografuj te sama kartke przed kazda kolejna czescia. QR zaczyna nowa aukcje; samo zdjecie QR nie trafi do opisu ani galerii aukcji.</p><div class="beta-actions"><button id="betaPrintQR" type="button">Drukuj</button><button id="betaDownloadQR" type="button">Zapisz PNG</button><button id="betaCloseQR" type="button">Zamknij</button></div>';
    const splitDialog = document.createElement("dialog"); splitDialog.id = "betaSplitDialog";
    splitDialog.innerHTML = '<h2>Sprawdz podzial zdjec</h2><p id="betaSplitSummary"></p><ol id="betaSplitPreview"></ol><small>Sprawdz zakresy zdjec: niewyrazny QR moze nie zostac rozpoznany. Zdjecia przed pierwszym separatorem tez tworza aukcje. Istniejacych aukcji i komentarzy nie nadpisujemy.</small><div class="beta-actions"><button id="betaConfirmSplit" type="button">Utworz aukcje na liscie</button><button id="betaCloseSplit" type="button">Wroc do zdjec</button></div>';
    document.body.append(qrDialog, splitDialog);
    function ordered() {
      const photos = [...options.state.localPhotosByName.values()];
      const separators = new Map(photos.filter(photo => photo.betaSeparatorBefore).map(photo => [photo.betaSeparatorBefore, photo]));
      return photos.filter(photo => !photo.betaSeparatorBefore).sort(compare).flatMap(photo => separators.has(photo.name) ? [separators.get(photo.name), photo] : [photo]);
    }
    function manualTarget() { return options.state.localPhotosByName.get(options.previewName())?.betaSeparatorBefore || options.previewName(); }
    function addImage(before) {
      const canvas = paint(document.createElement("canvas"));
      const raw = atob(canvas.toDataURL("image/png").split(",")[1]);
      const file = new File([Uint8Array.from(raw, char => char.charCodeAt(0))], `separator-${crypto.randomUUID()}.png`, { type: "image/png" });
      const photo = { name: file.name, file, url: URL.createObjectURL(file), betaSeparatorBefore: before };
      options.state.localPhotosByName.set(photo.name, photo); recognized.add(photo.name); cache.set(file, "separator");
      return photo;
    }
    function signature() { return JSON.stringify(options.state.products.map(product => [product.id, product.photoNames || []])); }
    function sameFiles(photos) { const now = ordered(); return now.length === photos.length && now.every((photo, index) => photo.name === photos[index].name && photo.file === photos[index].file); }
    function decorate() {
      document.querySelectorAll("#photoGrid [data-photo-name]").forEach(button => {
        button.querySelector(".beta-separator-badge")?.remove();
        const name = button.dataset.photoName, text = recognized.has(name) || options.state.localPhotosByName.get(name)?.betaSeparatorBefore ? "SEPARATOR" : "";
        button.classList.toggle("beta-boundary-photo", Boolean(text));
        if (text) { const badge = document.createElement("span"); badge.className = "beta-separator-badge"; badge.textContent = text; button.append(badge); }
      });
    }
    function refresh() {
      const locked = options.blocked();
      el("betaSplitAI").disabled = scanning || locked || !options.state.localPhotosByName.size;
      el("betaMakeQR").disabled = scanning || locked;
      el("betaManualQR").disabled = scanning || locked || !options.state.localPhotosByName.has(options.previewName());
      el("betaManualQR").setAttribute("aria-pressed", String(manual.has(manualTarget())));
      el("betaManualQR").textContent = manual.has(manualTarget()) ? "Usun separator" : "Wstaw zdjecie separatora";
      el("betaManualQR").title = "Wstaw zdjecie QR przed biezacym zdjeciem";
      el("betaCancelSplit").hidden = !scanning;
      decorate();
    }
    function allowed() {
      if (options.allowed()) return true;
      report(options.blockReason?.() || "Operacja chwilowo zablokowana. Zakoncz nagranie lub przywroc lokalny zapis bety.", true);
      return false;
    }
    const render = renderPhotos;
    renderPhotos = function () {
      options.state.localPhotosByName = new Map(ordered().map(photo => [photo.name, photo]));
      render(); refresh();
    };
    const toggle = togglePhoto;
    togglePhoto = function (name) { if (recognized.has(name) || options.state.localPhotosByName.get(name)?.betaSeparatorBefore) { options.selectPreview?.(name); renderPhotos(); return; } toggle(name); };
    el("betaMakeQR").onclick = () => { try { paint(el("betaQrCanvas")); qrDialog.showModal(); } catch (error) { report(error.message, true); } };
    el("betaCloseQR").onclick = () => qrDialog.close();
    el("betaPrintQR").onclick = () => window.print();
    el("betaDownloadQR").onclick = () => { const link = document.createElement("a"); link.download = "separator-aukcji.png"; link.href = el("betaQrCanvas").toDataURL("image/png"); link.click(); };
    el("betaManualQR").onclick = () => {
      if (!allowed() || scanning) return;
      const name = manualTarget(); if (!options.state.localPhotosByName.has(name)) return;
      try {
        if (manual.has(name)) {
          for (const photo of options.state.localPhotosByName.values()) if (photo.betaSeparatorBefore === name) { URL.revokeObjectURL(photo.url); options.state.localPhotosByName.delete(photo.name); recognized.delete(photo.name); }
          manual.delete(name); options.selectPreview?.(name);
        } else { const photo = addImage(name); manual.add(name); options.selectPreview?.(photo.name); }
        revision++; renderPhotos(); options.changed(); report("");
      } catch (error) { report(error.message, true); }
    };
    async function decode(photo) {
      if (cache.has(photo.file)) return cache.get(photo.file);
      if (typeof jsQR !== "function") throw new Error("Nie zaladowano czytnika QR. Odswiez bete.");
      const file = window.PhotoUpload?.needsConversion(photo.file) ? await window.PhotoUpload.prepare(photo.file) : photo.file;
      const url = URL.createObjectURL(file), image = new Image(); let timer;
      try {
        image.src = url;
        await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Przekroczono czas odczytu zdjecia")), 15000); })]);
        if (cancelled) throw new DOMException("Anulowano", "AbortError");
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("Nieprawidlowe zdjecie");
        const ratio = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
        const kind = result?.data === payload ? "separator" : result ? "foreign" : "photo";
        cache.set(photo.file, kind); return kind;
      } finally { clearTimeout(timer); URL.revokeObjectURL(url); image.src = ""; }
    }
    async function scan() {
      if (scanning || !allowed()) return;
      options.beforeScan();
      const photos = ordered(), startSignature = signature(), startRevision = revision;
      if (!photos.length) { report("Najpierw wskaz folder zdjec.", true); return; }
      if (photos.length > 5000) { report("Podziel folder na maksymalnie 5000 zdjec na jeden skan.", true); return; }
      scanning = true; cancelled = false; preview = null; refresh(); options.busyChanged();
      const items = []; let qrCount = 0, foreignCount = 0;
      try {
        for (let index = 0; index < photos.length; index++) {
          if (cancelled) throw new DOMException("Anulowano", "AbortError");
          const photo = photos[index]; report(`Szukam QR lokalnie: ${index + 1}/${photos.length} - ${photo.name}`);
          await new Promise(resolve => setTimeout(resolve, 0));
          let kind;
          try { kind = await decode(photo); } catch (error) { if (error.name === "AbortError") throw error; throw new Error(`Nie odczytano ${photo.name}. Niczego nie dodano. Sprawdz format JPEG/PNG/WebP i plik.`); }
          items.push({ name: photo.name, kind });
          if (kind === "separator") { qrCount++; recognized.add(photo.name); }
          if (kind === "foreign") foreignCount++;
        }
        if (cancelled) throw new DOMException("Anulowano", "AbortError");
        if (!sameFiles(photos) || signature() !== startSignature || revision !== startRevision) throw new Error("Zdjecia lub aukcje zmienily sie podczas skanowania. Uruchom podzial ponownie; niczego nie dodano.");
        const assigned = new Set(options.state.products.flatMap(product => product.photoNames || []));
        if (items.some(item => item.kind === "separator" && assigned.has(item.name))) throw new Error("Zdjecie QR jest juz w istniejacej aukcji. Najpierw usun je z jej zestawu zdjec. Niczego nie nadpisano.");
        const allGroups = partition(items, manual), groups = []; let skipped = 0;
        for (const group of allGroups) {
          const count = group.filter(name => assigned.has(name)).length;
          if (count && count !== group.length) throw new Error("Jeden zakres zawiera zdjecia juz przypisane i nowe. Popraw reczny separator lub istniejacy zestaw; nie zmieniamy go automatycznie.");
          if (count) skipped++; else groups.push(group);
        }
        if (!groups.length) { report(`Brak nowych aukcji. Pominieto ${skipped} juz przypisanych zestawow. Lista bez zmian.`); return; }
        if (options.state.products.length + groups.length > 2000) throw new Error("Przekroczono limit 2000 aukcji w sesji. Zapisz obecna sesje i podziel folder.");
        preview = { groups, photos, signature: startSignature, revision: startRevision };
        el("betaSplitSummary").textContent = `${groups.length} nowych aukcji, ${groups.reduce((sum, group) => sum + group.length, 0)} zdjec czesci. Kolejnosc wedlug nazw plikow (1, 2, 10). QR: ${qrCount}, reczne separatory: ${photos.filter(photo => manual.has(photo.name)).length}. Pominiete istniejace zestawy: ${skipped}.${foreignCount ? ` Obce QR: ${foreignCount} - zachowano jako zwykle zdjecia.` : ""}${!qrCount && !manual.size ? " Brak separatorow: wszystkie zdjecia utworza jedna aukcje. Mozesz wrocic i dodac reczne separatory." : ""}`;
        const list = el("betaSplitPreview"); list.replaceChildren();
        for (const group of groups) { const row = document.createElement("li"); row.textContent = `${group[0]}${group.length > 1 ? ` - ${group.at(-1)}` : ""} (${group.length} zdj.)`; list.append(row); }
        report(`Rozpoznano ${qrCount} QR. Sprawdz podzial przed utworzeniem listy. Zdjecia nie byly wysylane do AI.`);
      } catch (error) { report(error.name === "AbortError" ? "Anulowano skanowanie. Lista aukcji pozostala bez zmian." : error.message, true); }
      finally { scanning = false; refresh(); options.busyChanged(); if (preview) splitDialog.showModal(); }
    }
    el("betaSplitAI").onclick = () => void scan();
    el("betaCancelSplit").onclick = () => { cancelled = true; report("Anuluje skanowanie..."); };
    el("betaCloseSplit").onclick = () => { preview = null; splitDialog.close(); };
    splitDialog.addEventListener("cancel", () => { preview = null; });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && scanning) { cancelled = true; event.preventDefault(); } });
    el("betaConfirmSplit").onclick = () => {
      if (!preview || !allowed()) return;
      if (!sameFiles(preview.photos) || signature() !== preview.signature || revision !== preview.revision) { report("Dane zmienily sie od podgladu. Uruchom podzial ponownie; nie dodano aukcji.", true); preview = null; splitDialog.close(); return; }
      const groups = preview.groups; preview = null; splitDialog.close();
      options.create(groups);
      report(`Utworzono ${groups.length} aukcji na zwyklej liscie. Wybierz Edytuj przy aukcji, aby nagrac komentarz pod zdjeciami.`);
    };
    renderPhotos();
    return { get busy() { return scanning; }, refresh,
      snapshot() { return [...manual]; },
      restore(names) {
        manual.clear(); recognized.clear();
        if (Array.isArray(names)) for (const name of names.slice(0, 10000)) if (typeof name === "string" && name.length <= 1000) manual.add(name);
        const images = new Set();
        for (const photo of options.state.localPhotosByName.values()) if (photo.betaSeparatorBefore) {
          if (!manual.has(photo.betaSeparatorBefore)) { URL.revokeObjectURL(photo.url); options.state.localPhotosByName.delete(photo.name); }
          else { images.add(photo.betaSeparatorBefore); recognized.add(photo.name); cache.set(photo.file, "separator"); }
        }
        for (const name of manual) if (!images.has(name) && options.state.localPhotosByName.has(name)) addImage(name);
        revision++; renderPhotos();
      }
    };
  } };
})();
