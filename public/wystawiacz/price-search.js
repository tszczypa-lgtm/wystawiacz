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
        const searchButtons = document.createElement("div"); searchButtons.className = "price-button-group";
        searchButtons.setAttribute("role", "group"); searchButtons.setAttribute("aria-label", `${site}: Szukaj`);
        for (const [mode, label] of [["number", "Po numerze"], ["title", "Po tytule"]]) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.onclick = () => {
            const query = (mode === "number" ? number() : title()).trim();
            if (!query) { notify("Brakuje numeru czesci lub tytulu do wyszukania."); return; }
            window.open(searchUrl(site, query, { ...settings, mode }), "_blank", "noopener,noreferrer");
          };
          searchButtons.append(button);
        }
        row.append(searchButtons);
        const filters = document.createElement("div"); filters.className = "price-checkbox-group";
        filters.setAttribute("role", "group"); filters.setAttribute("aria-label", `${site}: Filtry`);
        const sorting = [];
        function checkbox(text, checked, change) {
          const label = document.createElement("label"), input = document.createElement("input");
          input.type = "checkbox"; input.checked = checked; input.onchange = () => change(input.checked);
          label.append(input, text); filters.append(label); return input;
        }
        if (!["Google", "Ovoko"].includes(site)) {
          for (const [order, text] of [["asc", "Od najnizszej"], ["desc", "Od najwyzszej"]]) {
            const input = checkbox(text, settings.order === order, checked => {
              settings.order = checked ? order : "default";
              for (const [value, control] of sorting) control.checked = settings.order === value;
              persist();
            });
            sorting.push([order, input]);
          }
        }
        if (site === "Allegro") checkbox("Wysylka z Polski", Boolean(settings.poland), checked => { settings.poland = checked; persist(); });
        if (filters.children.length) row.append(filters);
        if (site === "Ovoko") { const note = document.createElement("small"); note.textContent = "Sortowanie wybierz na Ovoko"; row.append(note); }
        grid.append(row);
      }
      const hint = document.createElement("small"); hint.textContent = "Wybierz filtry i kliknij Po numerze lub Po tytule. Ostatni wybor filtrow zostaje zapamietany."; actions.append(hint);
    },
    refresh() {}
  };
})();
