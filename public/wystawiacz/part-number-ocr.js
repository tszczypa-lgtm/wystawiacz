(function () {
  "use strict";
  let enginePromise;

  function extractCandidates(text, photoName) {
    const found = new Map();
    const add = (raw, line, preferred = false) => {
      const number = raw.replace(/[\s.-]/g, "").toUpperCase();
      if (!/^[A-Z0-9]{6,14}$/.test(number) || !/\d/.test(number)) return;
      if (/^(\d)\1+$/.test(number) || /^\d{13,14}$/.test(number)) return;
      const serial = /\b(SERIAL|S\/N|SN|VIN|DATE|LOT|BATCH)\b/i.test(line);
      const labelled = /\b(OE|OEM|PART|P\/N|PN|TEIL|SACH|NR)\b/i.test(line);
      const vag = /^[0-9][A-Z0-9]{2}\d{6}[A-Z]{0,3}$/.test(number);
      const mercedes = /^A\d{10}$/.test(number);
      const score = (preferred ? 3 : 0) + (vag || mercedes ? 5 : 0) + (labelled ? 4 : 0) + (/[A-Z]/.test(number) ? 2 : 0) - (serial ? 8 : 0);
      const item = { number, score, photoName, raw: raw.trim(), serial };
      if (!found.has(number) || found.get(number).score < score) found.set(number, item);
    };
    for (const line of String(text).toUpperCase().split(/\r?\n/)) {
      // Join only recognizable part-number groupings, not arbitrary label text.
      const patterns = [
        /\b[A-Z0-9]{3}[ .-]+\d{3}[ .-]+\d{3}(?:[ .-]*[A-Z]{1,3})?\b/g,
        /\bA[ .-]*\d{3}[ .-]+\d{3}[ .-]+\d{2}[ .-]+\d{2}\b/g,
        /\b\d[ .-]+\d{3}[ .-]+\d{3}[ .-]+\d{3}\b/g
      ];
      for (const pattern of patterns) for (const match of line.matchAll(pattern)) add(match[0], line, true);
      for (const match of line.matchAll(/\b[A-Z0-9][A-Z0-9.-]{5,17}\b/g)) {
        if (/^\d{1,4}[-.]\d{1,2}[-.]\d{1,4}$/.test(match[0]) || /^\d+(V|W|HZ|MA|AH|AMP)$/.test(match[0])) continue;
        add(match[0], line);
      }
    }
    // Keep the literal reading and label any inferred OCR correction separately.
    const replacements = { S: "5", O: "0", I: "1", Z: "2", B: "8" };
    for (const item of [...found.values()]) {
      if (/^[SOIZB][A-Z0-9]{2}\d{6}[A-Z]{0,3}$/.test(item.number)) {
        const number = replacements[item.number[0]] + item.number.slice(1);
        if (!found.has(number)) found.set(number, { ...item, number, score: item.score + 1, correction: item.number });
      }
    }
    return [...found.values()];
  }

  function rankCandidates(results) {
    const merged = new Map();
    for (const result of results) for (const item of extractCandidates(result.text, result.name)) {
      const existing = merged.get(item.number);
      if (!existing) merged.set(item.number, { ...item, photos: [item.photoName] });
      else {
        existing.score = Math.max(existing.score, item.score);
        existing.serial = existing.serial && item.serial;
        if (!existing.photos.includes(item.photoName)) existing.photos.push(item.photoName);
      }
    }
    return [...merged.values()].sort((a, b) => (b.score + b.photos.length) - (a.score + a.photos.length) || a.number.localeCompare(b.number)).slice(0, 10);
  }

  function loadEngine() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!enginePromise) enginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("Brak silnika OCR."));
      script.onerror = () => { script.remove(); reject(new Error("Nie udalo sie pobrac OCR. Sprawdz internet lub blokade CDN.")); };
      document.head.appendChild(script);
    }).catch(error => { enginePromise = undefined; throw error; });
    return enginePromise;
  }

  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(2, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Nie mozna przygotowac zdjecia do OCR.");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally { URL.revokeObjectURL(url); }
  }

  function sameSelection(a, b) {
    return a.productId === b.productId && a.photos.length === b.photos.length && a.photos.every((photo, i) =>
      photo.name === b.photos[i].name && photo.file === b.photos[i].file && !b.photos[i].rotating);
  }

  function mount({ getSelection, choose }) {
    const scan = document.getElementById("scanPartNumbers");
    const cancel = document.getElementById("cancelPartNumberScan");
    const status = document.getElementById("partNumberScanStatus");
    const list = document.getElementById("partNumberCandidates");
    let running = false;
    let cancelled = false;
    let worker;
    let rejectPending;
    const interruptible = promise => new Promise((resolve, reject) => {
      rejectPending = () => reject(new Error("Odczyt przerwany."));
      promise.then(resolve, reject);
    }).finally(() => { rejectPending = undefined; });
    cancel.addEventListener("click", () => {
      cancelled = true;
      rejectPending?.();
      status.textContent = "Przerywanie odczytu...";
      if (worker) { void worker.terminate().catch(() => {}); worker = undefined; }
    });
    scan.addEventListener("click", async () => {
      if (running) return;
      const snapshot = getSelection();
      list.replaceChildren();
      if (!snapshot.photos.length) { status.textContent = "Najpierw zaznacz zdjecia z oznaczeniami czesci."; return; }
      if (snapshot.photos.some(photo => !photo.file || photo.rotating)) { status.textContent = "Wczytaj zdjecia i poczekaj na zakonczenie obracania."; return; }
      running = true;
      cancelled = false;
      scan.disabled = true;
      cancel.classList.remove("hidden");
      status.textContent = "Przygotowanie OCR (pierwsze uruchomienie pobiera silnik i dane jezykowe)...";
      try {
        const engine = await loadEngine();
        if (cancelled) return;
        worker = await engine.createWorker("eng", 1, {
          workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
          corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
          langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int"
        });
        if (cancelled) return;
        await worker.setParameters({ tessedit_pageseg_mode: "11", preserve_interword_spaces: "1" });
        const results = [];
        const failures = [];
        for (const [i, photo] of snapshot.photos.entries()) {
          if (cancelled) return;
          if (!sameSelection(snapshot, getSelection())) throw new Error("Zmieniono zdjecia lub oferte. Uruchom odczyt ponownie.");
          status.textContent = `Odczyt ${i + 1}/${snapshot.photos.length}: ${photo.name}`;
          try {
            const image = await interruptible(prepareImage(photo.file));
            if (cancelled) return;
            const result = await interruptible(worker.recognize(image));
            results.push({ name: photo.name, text: result.data.text });
          } catch (error) {
            if (cancelled) return;
            failures.push(photo.name);
          }
        }
        if (!sameSelection(snapshot, getSelection())) throw new Error("Zmieniono zdjecia lub oferte. Uruchom odczyt ponownie.");
        const candidates = rankCandidates(results);
        for (const item of candidates) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "part-number-candidate";
          const number = document.createElement("strong");
          number.textContent = item.number;
          const detail = document.createElement("span");
          detail.textContent = `${item.correction ? `Mozliwa pomylka OCR: odczytano ${item.correction}` : item.serial ? "Mozliwy numer seryjny" : "Kandydat na numer czesci"} | Zdjecia: ${item.photos.join(", ")}`;
          button.append(number, detail);
          button.addEventListener("click", () => {
            if (!sameSelection(snapshot, getSelection())) {
              list.replaceChildren();
              status.textContent = "To wyniki dla poprzednich zdjec lub oferty. Uruchom odczyt ponownie.";
              return;
            }
            choose(item.number);
            status.textContent = `Wybrano ${item.number}. Sprawdz zapis z oznaczeniem na czesci (OCR moze mylic 0/O i 1/I).`;
          });
          list.appendChild(button);
        }
        status.textContent = (candidates.length ? "Kliknij poprawny numer. To odczyt napisu, nie weryfikacja w katalogu producenta." : "Nie znaleziono numeru. Sprobuj wyrazniejszego zblizenia oznaczenia lub obroc zdjecie.")
          + (failures.length ? ` Nie odczytano: ${failures.join(", ")}.` : "");
      } catch (error) {
        if (!cancelled) status.textContent = error.message || "Odczyt nie powiodl sie. Sprobuj ponownie.";
      } finally {
        if (worker) { await worker.terminate().catch(() => {}); worker = undefined; }
        if (cancelled) status.textContent = "Odczyt przerwany.";
        running = false;
        scan.disabled = false;
        cancel.classList.add("hidden");
      }
    });
  }

  window.PartNumberOcr = { mount, extractCandidates, rankCandidates, sameSelection };
})();
