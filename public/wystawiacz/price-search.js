(function () {
  window.PriceSearch = {
    mount({ number, title, notify }) {
      const actions = document.querySelector(".search-actions");
      const grid = document.createElement("div"); grid.className = "price-search-table";
      const header = document.createElement("div"); header.className = "price-search-row";
      for (const text of ["Serwis", "Po numerze", "Po tytule"]) { const cell = document.createElement("strong"); cell.textContent = text; header.append(cell); }
      grid.append(header);
      for (const [name, ids] of [["Allegro", ["searchAllegroPartButton", "searchAllegroTitleButton"]], ["Google", ["searchGooglePartButton", "searchGoogleTitleButton"]]]) {
        const row = document.createElement("div"); row.className = "price-search-row";
        const label = document.createElement("span"); label.textContent = name; row.append(label);
        for (const id of ids) { const button = document.getElementById(id); button.textContent = "Szukaj"; row.append(button); }
        grid.append(row);
      }
      for (const name of ["Ovoko", "Otomoto", "OLX"]) {
        const row = document.createElement("div"); row.className = "price-search-row";
        const label = document.createElement("span"); label.textContent = name; row.append(label);
        for (const getter of [number, title]) {
          const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "Szukaj";
          button.onclick = () => {
            const query = getter().trim(); if (!query) { notify("Brakuje tekstu do wyszukania."); return; }
            const url = name === "Ovoko" ? new URL("https://ovoko.pl/szukaj") : name === "Otomoto" ? new URL("https://www.otomoto.pl/czesci") : new URL(`https://www.olx.pl/motoryzacja/czesci-samochodowe/q-${encodeURIComponent(query)}/`);
            if (name === "Ovoko") url.searchParams.set("q", query);
            if (name === "Otomoto") url.searchParams.set("search[filter_string_query]", query);
            window.open(url.href, "_blank", "noopener,noreferrer");
          };
          row.append(button);
        }
        grid.append(row);
      }
      actions.querySelector("span").after(grid);
      actions.querySelectorAll(".price-search-buttons").forEach(node => node.remove());
      actions.querySelectorAll(".price-search-group").forEach(node => { if (!node.children.length) node.remove(); });
    }
  };
})();
