(function () {
  window.PriceSearch = {
    mount({ number, title, notify }) {
      const actions = document.querySelector(".search-actions");
      const grid = document.createElement("div"); grid.className = "price-search-table";
      function option(text, key) {
        const label = document.createElement("label"); label.className = "price-search-sort";
        const input = document.createElement("input"); input.type = "checkbox"; label.append(input, text);
        try { input.checked = localStorage.getItem(key) === "true"; } catch {}
        input.addEventListener("change", () => { try { localStorage.setItem(key, String(input.checked)); } catch {} });
        return label;
      }
      for (const [name, ids] of [["Allegro", ["searchAllegroPartButton", "searchAllegroTitleButton"]], ["Ovoko", []], ["Otomoto", []], ["OLX", []], ["Google", ["searchGooglePartButton", "searchGoogleTitleButton"]]]) {
        const row = document.createElement("div"); row.className = "price-search-row";
        const brand = document.createElement("strong"); brand.className = `price-brand price-brand-${name.toLowerCase()}`; brand.textContent = name; row.append(brand);
        const filters = document.createElement("div"); filters.className = "price-site-filters";
        const sort = name === "Allegro" ? document.getElementById("priceSortLowestInput").closest("label") : ["Otomoto", "OLX"].includes(name) ? option("Od najnizszej", `wystawiacz-price-sort-${name.toLowerCase()}`) : null;
        if (sort) { sort.lastChild.textContent = " Od najniższej"; filters.append(sort); }
        if (name === "Allegro") {
          const poland = document.getElementById("priceShippingPolandInput").closest("label"); poland.lastChild.textContent = " Z Polski"; filters.append(poland);
          filters.append(document.getElementById("priceUsedInput").closest("label"));
        }
        if (name === "Ovoko") { const hint = document.createElement("small"); hint.textContent = "Cenę i stan filtruj w Ovoko"; hint.title = "W wynikach Ovoko wybierz Najpierw najtańsze oraz stan Używany. Nie mamy potwierdzonego linku sortowania."; filters.append(hint); }
        for (const [index, getter] of [number, title].entries()) {
          const button = ids[index] ? document.getElementById(ids[index]) : document.createElement("button");
          button.type = "button"; button.className = "secondary-button"; button.textContent = index ? "Po tytule" : "Po numerze";
          button.setAttribute("aria-label", `${name}: ${index ? "po tytule" : "po numerze"}`);
          if (!ids.length) button.onclick = () => {
            const query = getter().trim(); if (!query) { notify("Brakuje tekstu do wyszukania."); return; }
            const url = name === "Ovoko" ? new URL("https://ovoko.pl/szukaj") : name === "Otomoto" ? new URL("https://www.otomoto.pl/czesci") : new URL(`https://www.olx.pl/motoryzacja/czesci-samochodowe/q-${encodeURIComponent(query)}/`);
            if (name === "Ovoko") { url.searchParams.set("q", query); if (!index) url.searchParams.set("exact", "1"); }
            if (name === "Otomoto") url.searchParams.set("search[filter_string_query]", query);
            if (sort?.querySelector("input").checked) url.searchParams.set("search[order]", "filter_float_price:asc");
            window.open(url.href, "_blank", "noopener,noreferrer");
          };
          row.append(button);
        }
        row.append(filters); grid.append(row);
      }
      actions.querySelector("span").after(grid);
      actions.querySelectorAll(".price-search-group").forEach(node => node.remove());
      const hint = document.createElement("small"); hint.className = "price-comparison-hint";
      hint.textContent = "Porównuj ten sam numer i stronę: część używana, sprawna, kompletna. Dolicz dostawę; najtańsza oferta nie zawsze dotyczy sprawnej części.";
      actions.append(hint);
    }
  };
})();
