(function () {
  "use strict";
  function partName(title) {
    // Only recognizable component names are offered; never reuse a vehicle model as a part name.
    const names = /\b(hak holowniczy|prze[łl][ąa]cznik (?:zespolony|szyb|[śs]wiate[łl])|panel (?:sterowania|klimatyzacji)|sterownik (?:silnika|skrzyni bieg[oó]w|abs)|modu[łl] (?:komfortu|bluetooth|airbag)|pompa (?:paliwa|wody|oleju|abs|wspomagania)|czujnik (?:parkowania|abs|temperatury|ci[śs]nienia|po[łl]o[żz]enia)|zacisk hamulcowy|tarcza hamulcowa|klocki hamulcowe|silnik wycieraczek|mechanizm wycieraczek|zaw[oó]r egr|ch[łl]odnica (?:wody|oleju|klimatyzacji)|poduszka (?:powietrzna|silnika)|kolektor (?:ss[ąa]cy|wydechowy)|wi[ąa]zka elektryczna|zamek (?:drzwi|klapy|maski)|skrzynia bieg[oó]w|dr[ąa][żz]ek kierowniczy|ko[ńn]c[oó]wka dr[ąa][żz]ka|lusterko|reflektor|alternator|rozrusznik|turbospr[ęe][żz]arka|wtryskiwacz|wahacz|amortyzator|spr[ęe][żz]yna|zwrotnica|piasta|p[oó][łl]o[śs]|zderzak|b[łl]otnik|maska|klapa|drzwi|lamp[ay]|licznik|radio|nawigacja|kierownica|przek[łl]adnia kierownicza|maglownica|spr[ęe][żz]arka klimatyzacji|kompresor klimatyzacji|nagrzewnica|dmuchawa|wentylator|przepustnica|przep[łl]ywomierz|sonda lambda|katalizator|filtr dpf|fotel|pas bezpiecze[ńn]stwa|peda[łl] gazu|stacyjka|klamka|uchwyt|wspornik|os[łl]ona)\b/i;
    const bounded = new RegExp(names.source.replace(/^\\b/, "(?<![\\p{L}\\p{N}])").replace(/\\b$/, "(?![\\p{L}\\p{N}])"), "iu");
    const match = title.match(bounded);
    return match ? match[0].replace(/^./, letter => letter.toUpperCase()) : "";
  }
  function mount({ getContext, search, choose }) {
    const input = document.getElementById("partNumber");
    const status = document.getElementById("titleSuggestionStatus");
    const list = document.getElementById("titleSuggestionResults");
    const fullMode = document.getElementById("titleModeFull");
    const partMode = document.getElementById("titleModePart");
    let mode = "off";
    try { const saved = localStorage.getItem("wystawiacz-title-mode"); if (["full", "part"].includes(saved)) mode = saved; } catch {}
    fullMode.checked = mode === "full";
    partMode.checked = mode === "part";
    let timer;
    let controller;
    let current = "";
    let revision = 0;
    const cache = new Map();
    const key = context => JSON.stringify([context.number.toUpperCase().replace(/[ .\/-]/g, ""), context.productId, context.mode]);
    const context = () => ({ ...getContext(), mode });
    const valid = number => /^[A-Z0-9 .\/-]{6,40}$/i.test(number) && /\d/.test(number);
    const render = (payload, snapshot) => {
      list.replaceChildren();
      let count = 0;
      for (const group of payload.groups || []) {
        const seen = new Set();
        const section = document.createElement("div");
        section.className = "title-source";
        const heading = document.createElement("strong");
        heading.textContent = group.source === "allegro" ? "Allegro - katalog produktow" : "Google";
        section.appendChild(heading);
        let offered = 0;
        for (const item of (group.titles || []).slice(0, 2)) {
          const candidate = snapshot.mode === "part" ? partName(item.title) : item.title;
          if (!candidate || seen.has(candidate.toLowerCase())) continue;
          seen.add(candidate.toLowerCase());
          const row = document.createElement("div");
          row.className = "title-candidate";
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = candidate;
          button.addEventListener("click", () => {
            if (key(context()) !== key(snapshot)) { refresh(); return; }
            choose(candidate, snapshot.mode);
            status.textContent = snapshot.mode === "part" ? "Nazwa wpisana. Teraz kliknij auto z Twojej listy. Sprawdz nazwe czesci." : "Tytul wpisany. Sprawdz, czy opisuje Twoja czesc.";
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
          offered++;
        }
        if (snapshot.mode === "part" && group.titles?.length && !offered) {
          const note = document.createElement("p");
          note.textContent = "Znaleziono wyniki, ale nie rozpoznano samej nazwy czesci. Zaznacz Pelny tytul, aby je obejrzec.";
          section.appendChild(note);
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
        if (version !== revision || key(context()) !== key(snapshot)) return;
        if (cache.size >= 30) cache.delete(cache.keys().next().value);
        if (!(payload.groups || []).some(group => group.errorCode)) cache.set(number, { payload, until: Date.now() + 300000 });
        render(payload, snapshot);
      } catch (error) {
        if (version === revision && error.name !== "AbortError") status.textContent = error.message || "Nie udalo sie pobrac tytulow.";
      }
    }
    function refresh(immediate = false) {
      const snapshot = context();
      const next = key(snapshot);
      if (next === current) return;
      current = next;
      revision++;
      clearTimeout(timer);
      controller?.abort();
      list.replaceChildren();
      if (mode === "off") { status.textContent = "Podpowiedzi wylaczone. Wpisz tytul recznie lub zaznacz jeden tryb."; return; }
      if (!valid(snapshot.number)) { status.textContent = "Wpisz pelny numer czesci (takze koncowa litere)."; return; }
      const version = revision;
      status.textContent = "Czekam na zakonczenie wpisywania numeru...";
      timer = setTimeout(() => run(snapshot, version), immediate ? 0 : 1500);
    }
    input.addEventListener("input", () => refresh());
    input.addEventListener("blur", () => refresh(true));
    for (const [checkbox, value] of [[fullMode, "full"], [partMode, "part"]]) {
      checkbox.addEventListener("change", () => {
        mode = checkbox.checked ? value : "off";
        fullMode.checked = mode === "full";
        partMode.checked = mode === "part";
        try { localStorage.setItem("wystawiacz-title-mode", mode); } catch {}
        refresh(true);
      });
    }
    refresh();
    return { refresh };
  }
  window.TitleSuggestions = { mount, partName };
})();
