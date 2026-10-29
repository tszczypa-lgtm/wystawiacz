(function () {
  const storageKey = "wystawiacz-price-search-options";
  function searchUrl(site, query, options) {
    let url;
    if (site === "Allegro") {
      url = new URL("https://allegro.pl/listing"); url.searchParams.set("string", query);
      if (options.order !== "default") url.searchParams.set("order", options.order === "asc" ? "p" : "pd");
      if (options.poland) url.searchParams.set("miejsce-wysylki", "polska");
    } else if (site === "Google") {
      url = new URL("https://www.google.com/search"); url.searchParams.set("q", query);
    } else if (site === "Ovoko") {
      url = new URL("https://ovoko.pl/szukaj"); url.searchParams.set("q", query);
      if (options.mode === "number") url.searchParams.set("exact", "1");
    } else {
      url = new URL(site === "OLX" ? `https://www.olx.pl/motoryzacja/czesci-samochodowe/q-${encodeURIComponent(query)}/` : `https://www.otomoto.pl/czesci/q-${encodeURIComponent(query)}`);
      if (options.order !== "default") url.searchParams.set("search[order]", `filter_float_price:${options.order}`);
    }
    return url.href;
  }
  window.PriceSearch = {
    searchUrl,
    mount({ number, title, notify }) {
      const actions = document.querySelector(".search-actions");
      actions.replaceChildren();
      const heading = document.createElement("strong"); heading.textContent = "Porownaj oferty"; actions.append(heading);
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(storageKey) || "{}") || {}; } catch {}
      if (typeof saved !== "object" || Array.isArray(saved)) saved = {};
      const grid = document.createElement("div"); grid.className = "price-search-table"; actions.append(grid);
      for (const site of ["Allegro", "Ovoko", "Otomoto", "OLX", "Google"]) {
        const settings = { mode: "number", order: "default", poland: false, ...saved[site] };
        if (!["number", "title"].includes(settings.mode)) settings.mode = "number";
        if (!["default", "asc", "desc"].includes(settings.order)) settings.order = "default";
        const row = document.createElement("div"); row.className = "price-search-row";
        const brand = document.createElement("strong"); brand.className = `price-brand price-brand-${site.toLowerCase()}`; brand.textContent = site; row.append(brand);
        function persist() { saved[site] = settings; try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {} }
        function launch() {
          const query = (settings.mode === "number" ? number() : title()).trim();
          if (!query) { notify("Brakuje numeru czesci lub tytulu do wyszukania."); return; }
          window.open(searchUrl(site, query, settings), "_blank", "noopener,noreferrer");
        }
        function buttons(label, items, property, open) {
          const group = document.createElement("div"); group.className = "price-button-group"; group.setAttribute("role", "group"); group.setAttribute("aria-label", `${site}: ${label}`);
          for (const [value, text] of items) {
            const button = document.createElement("button"); button.type = "button"; button.textContent = text;
            button.setAttribute("aria-pressed", String(settings[property] === value));
            button.onclick = () => {
              settings[property] = value; persist();
              for (const child of group.children) child.setAttribute("aria-pressed", String(child === button));
              if (open) launch();
            };
            group.append(button);
          }
          row.append(group);
        }
        buttons("Szukaj", [["number", "Po numerze"], ["title", "Po tytule"]], "mode", true);
        if (!["Google", "Ovoko"].includes(site)) buttons("Kolejnosc cen", [["default", "Domyslnie"], ["asc", "Od najnizszej"], ["desc", "Od najwyzszej"]], "order", false);
        if (site === "Allegro") {
          const poland = document.createElement("button"); poland.type = "button"; poland.textContent = "Z Polski";
          poland.setAttribute("aria-pressed", String(Boolean(settings.poland)));
          poland.onclick = () => { settings.poland = !settings.poland; poland.setAttribute("aria-pressed", String(settings.poland)); persist(); }; row.append(poland);
        }
        if (site === "Ovoko") { const note = document.createElement("small"); note.textContent = "Sortowanie wybierz na Ovoko"; row.append(note); }
        grid.append(row);
      }
      const hint = document.createElement("small"); hint.textContent = "Wybierz kolejnosc, potem Po numerze lub Po tytule. Cene sprzedazy wpisujesz samodzielnie."; actions.append(hint);
    },
    refresh() {}
  };
})();
