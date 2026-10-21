(function () {
  window.PriceSearch = {
    mount({ number, title, notify }) {
      const actions = document.querySelector(".search-actions");
      const grid = document.createElement("div"); grid.className = "price-search-table";
      const quotes = new Map();
      const browserQuotes = new Map();
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
          const read = document.createElement("button"); read.type = "button"; read.textContent = "Z przeglądarki"; read.onclick = openAllegroReader; filters.append(read);
        }
        if (name === "Ovoko") { const hint = document.createElement("small"); hint.textContent = "Cenę i stan filtruj w Ovoko"; hint.title = "W wynikach Ovoko wybierz Najpierw najtańsze oraz stan Używany. Nie mamy potwierdzonego linku sortowania."; filters.append(hint); }
        for (const [index, getter] of [number, title].entries()) {
          const button = ids[index] ? document.getElementById(ids[index]) : document.createElement("button");
          button.type = "button"; button.className = "secondary-button"; button.textContent = index ? "Po tytule" : "Po numerze";
          button.setAttribute("aria-label", `${name}: ${index ? "po tytule" : "po numerze"}`);
          if (!ids.length) button.onclick = () => {
            const query = getter().trim(); if (!query) { notify("Brakuje tekstu do wyszukania."); return; }
            const url = name === "Ovoko" ? new URL("https://ovoko.pl/szukaj") : name === "Otomoto" ? new URL(`https://www.otomoto.pl/czesci/q-${encodeURIComponent(query)}`) : new URL(`https://www.olx.pl/motoryzacja/czesci-samochodowe/q-${encodeURIComponent(query)}/`);
            if (name === "Ovoko") { url.searchParams.set("q", query); if (!index) url.searchParams.set("exact", "1"); }
            if (sort?.querySelector("input").checked) url.searchParams.set("search[order]", "filter_float_price:asc");
            window.open(url.href, "_blank", "noopener,noreferrer");
          };
          row.append(button);
        }
        row.append(filters);
        if (name !== "Google") { const quote = document.createElement("div"); quote.className = "price-quote"; quote.dataset.priceSource = name; quote.setAttribute("role", "status"); row.append(quote); quotes.set(name, quote); }
        grid.append(row);
      }
      actions.querySelector("span").after(grid);
      const check = document.createElement("button"); check.type = "button"; check.id = "checkMarketPrices"; check.className = "secondary-button"; check.textContent = "Sprawdź najniższe ceny";
      const heading = document.createElement("div"); heading.className = "price-search-heading";
      const label = actions.querySelector("span"); label.before(heading); heading.append(label, check);
      actions.querySelectorAll(".price-search-group").forEach(node => node.remove());
      const hint = document.createElement("small"); hint.className = "price-comparison-hint";
      hint.textContent = "Porównuj ten sam numer i stronę: część używana, sprawna, kompletna. Dolicz dostawę; najtańsza oferta nie zawsze dotyczy sprawnej części.";
      actions.append(hint);
      let current = null, revision = 0, timer, controller;
      const normalized = () => number().replace(/[ .\/-]/g, "").toUpperCase();
      function clear(message) {
        for (const quote of quotes.values()) { quote.title = message; quote.textContent = message.startsWith("Pobieram") ? "Odczyt..." : "—"; }
      }
      function browserQuote(query) { const result = browserQuotes.get(query); return result && Date.now() - Date.parse(result.checkedAt) < 30 * 60000 ? result : null; }
      function renderQuote(result) {
        const quote = quotes.get(result.source); if (!quote) return;
        quote.title = result.message || "Brak ceny.";
        quote.textContent = result.status === "blocked" ? "Odczyt zablokowany" : "Brak ceny";
        if (result.status !== "ok" || result.lowest?.currency !== "PLN" || !Number.isFinite(result.lowest?.amount) || result.lowest.amount <= 0) return;
        const allowed = { Allegro: "allegro.pl", Ovoko: "ovoko.pl", Otomoto: "otomoto.pl", OLX: "olx.pl" }[result.source];
        let url; try { url = new URL(result.lowest.url); } catch { return; }
        if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === allowed || url.hostname.endsWith(`.${allowed}`))) return;
        const link = document.createElement("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(result.lowest.amount);
        link.title = `${result.lowest.title}\n${result.message}\nSprawdzono: ${result.checkedAt}`;
        const count = document.createElement("small"); count.textContent = `min. z ${result.count} ofert`;
        quote.replaceChildren(link, count);
      }
      const dialog = document.createElement("dialog"); dialog.id = "allegroPriceReaderDialog";
      dialog.innerHTML = '<h2>Cena z otwartej strony Allegro</h2><p>Ten odczyt wymaga Twojego kliknięcia w przeglądarce. Nie zmienia ofert ani ceny sprzedaży.</p><ol><li>Jednorazowo przeciągnij <a id="allegroPriceBookmark" draggable="true">Odczytaj ceny Allegro</a> na pasek zakładek przeglądarki.</li><li>Otwórz listę przyciskiem <b>Po numerze</b>, poczekaj na oferty i kliknij zapisaną zakładkę. Skopiuje odczyt do schowka.</li><li>Wróć tutaj i wklej odczyt poniżej (Ctrl+V).</li></ol><p>To minimum z odczytanych ofert na tej stronie, nie gwarancja najniższej ceny całego Allegro. Zakładka nie omija weryfikacji serwisu.</p><textarea id="allegroPriceImport" rows="4" maxlength="100000" aria-label="Odczyt cen Allegro" placeholder="Wklej odczyt z zakładki"></textarea><small id="allegroPriceImportStatus" role="status"></small><div><button type="button" id="importAllegroPrices">Wczytaj ceny</button><button type="button" id="closeAllegroPriceReader">Zamknij</button></div>';
      document.body.append(dialog);
      const bookmark = dialog.querySelector("#allegroPriceBookmark"); bookmark.href = window.AllegroPriceReader.bookmarklet();
      bookmark.onclick = event => { event.preventDefault(); notify("Przeciągnij ten link na pasek zakładek, a potem uruchom go na otwartej liście Allegro."); };
      dialog.querySelector("#closeAllegroPriceReader").onclick = () => dialog.close();
      function openAllegroReader() { dialog.showModal(); }
      dialog.querySelector("#importAllegroPrices").onclick = () => {
        try {
          const result = window.AllegroPriceReader.validate(dialog.querySelector("#allegroPriceImport").value, number());
          if (browserQuotes.size >= 20) browserQuotes.delete(browserQuotes.keys().next().value);
          browserQuotes.set(normalized(), result); renderQuote(result); dialog.close(); notify(`Odczytano ${result.count} ofert Allegro. Cena porównawcza jest w okienku przy Allegro.`);
        } catch (error) { dialog.querySelector("#allegroPriceImportStatus").textContent = error.message; }
      };
      async function loadPrices() {
        const query = normalized();
        if (!/^[A-Z0-9]{5,32}$/.test(query) || !/\d/.test(query)) { clear("Wpisz pełny numer części, aby pobrać ceny."); return; }
        clearTimeout(timer); controller?.abort(); const activeController = new AbortController(); controller = activeController; const requestId = ++revision;
        clear("Pobieram cenę..."); check.disabled = true;
        if (browserQuote(query)) renderQuote(browserQuote(query));
        try {
          const token = await window.getWystawiaczToken();
          if (requestId !== revision) return;
          const response = await fetch(`/api/workspace/price-comparison?number=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${token}` }, signal: activeController.signal });
          const data = await response.json(); if (!response.ok) throw Error(data.message || "Nie udało się odczytać cen.");
          if (requestId !== revision || query !== normalized()) return;
          clear("Serwis nie zwrócił ceny.");
          for (const result of Array.isArray(data.results) ? data.results : []) {
            renderQuote((result.source === "Allegro" && browserQuote(query)) || result);
          }
          if (browserQuote(query)) renderQuote(browserQuote(query));
        } catch (error) { if (requestId === revision && error.name !== "AbortError") { clear(error.message); if (browserQuote(query)) renderQuote(browserQuote(query)); } }
        finally { if (requestId === revision) check.disabled = false; }
      }
      function refresh() {
        const query = normalized(); if (query === current) return;
        current = query; revision++; controller?.abort(); clearTimeout(timer); check.disabled = false;
        clear(query ? "Czekam na pełny numer..." : "Wpisz numer części, aby pobrać ceny.");
        if (/^[A-Z0-9]{5,32}$/.test(query) && /\d/.test(query)) timer = setTimeout(loadPrices, 1600);
      }
      document.getElementById("partNumber").addEventListener("input", refresh);
      check.onclick = loadPrices; window.PriceSearch.refresh = refresh; refresh();
    }
  };
})();
