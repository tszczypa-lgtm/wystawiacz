(function () {
  "use strict";
  function mount({ getContext, search, choose }) {
    const input = document.getElementById("partNumber");
    const status = document.getElementById("titleSuggestionStatus");
    const list = document.getElementById("titleSuggestionResults");
    let timer;
    let controller;
    let current = "";
    let revision = 0;
    const cache = new Map();
    const key = context => JSON.stringify([context.number.toUpperCase().replace(/[ .\/-]/g, ""), context.productId]);
    const valid = number => /^[A-Z0-9 .\/-]{6,40}$/i.test(number) && /\d/.test(number);
    const render = (payload, snapshot) => {
      list.replaceChildren();
      let count = 0;
      for (const group of payload.groups || []) {
        const section = document.createElement("div");
        section.className = "title-source";
        const heading = document.createElement("strong");
        heading.textContent = group.source === "allegro" ? "Allegro - katalog produktow" : "Google";
        section.appendChild(heading);
        for (const item of (group.titles || []).slice(0, 2)) {
          const row = document.createElement("div");
          row.className = "title-candidate";
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = item.title;
          button.addEventListener("click", () => {
            if (key(getContext()) !== key(snapshot)) { refresh(); return; }
            choose(item.title);
            status.textContent = "Tytul wpisany. Sprawdz, czy opisuje Twoja czesc.";
          });
          row.appendChild(button);
          try {
            const url = new URL(item.url);
            if (url.protocol === "https:") {
              const link = document.createElement("a");
              link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
              link.textContent = "Zrodlo";
              row.appendChild(link);
            }
          } catch {}
          section.appendChild(row);
          count++;
        }
        if (group.message) {
          const note = document.createElement("p");
          note.textContent = group.message;
          section.appendChild(note);
        }
        list.appendChild(section);
      }
      status.textContent = count ? "Kliknij pasujacy tytul. Wyniki nie zmieniaja zdjec ani numeru czesci." : "Nie znaleziono propozycji. Sprawdz numer lub wpisz tytul recznie.";
    };
    async function run(snapshot, version) {
      const number = snapshot.number.toUpperCase().replace(/[ .\/-]/g, "");
      const saved = cache.get(number);
      if (saved && saved.until > Date.now()) { render(saved.payload, snapshot); return; }
      controller = new AbortController();
      status.textContent = "Szukam tytulow po pelnym numerze czesci...";
      try {
        const payload = await search(number, controller.signal);
        if (version !== revision || key(getContext()) !== key(snapshot)) return;
        if (cache.size >= 30) cache.delete(cache.keys().next().value);
        cache.set(number, { payload, until: Date.now() + 300000 });
        render(payload, snapshot);
      } catch (error) {
        if (version === revision && error.name !== "AbortError") status.textContent = error.message || "Nie udalo sie pobrac tytulow.";
      }
    }
    function refresh(immediate = false) {
      const snapshot = getContext();
      const next = key(snapshot);
      if (next === current) return;
      current = next;
      revision++;
      clearTimeout(timer);
      controller?.abort();
      list.replaceChildren();
      if (!valid(snapshot.number)) { status.textContent = "Wpisz pelny numer czesci (takze koncowa litere)."; return; }
      const version = revision;
      status.textContent = "Czekam na zakonczenie wpisywania numeru...";
      timer = setTimeout(() => run(snapshot, version), immediate ? 0 : 1500);
    }
    input.addEventListener("input", () => refresh());
    input.addEventListener("blur", () => refresh(true));
    refresh();
    return { refresh };
  }
  window.TitleSuggestions = { mount };
})();
