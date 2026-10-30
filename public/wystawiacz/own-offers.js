(function () {
  window.OwnOffers = {
    mount({ numberInput, connected, request, apply, notify }) {
      let generation = 0, timer, lastQuery = "";
      const panel = document.createElement("details"); panel.className = "own-offers-panel hidden";
      numberInput.closest("label").after(panel);
      const prices = document.createElement("section"); prices.className = "own-prices-panel";
      prices.setAttribute("aria-label", "Ceny moich ofert Allegro");
      document.querySelector(".pricing-final-row").append(prices);
      let matchedNumber = "";
      const message = document.createElement("p"); message.setAttribute("role", "status");
      const priceHeading = document.createElement("strong"); priceHeading.textContent = "Juz wystawione na Allegro";
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Otworz Asortyment Allegro"; edit.disabled = true;
      const reload = document.createElement("button"); reload.type = "button"; reload.textContent = "Odswiez";
      prices.append(priceHeading, message, edit, reload);
      edit.onclick = () => {
        const number = numberInput.value.trim();
        if (!number || number !== matchedNumber) return;
        const url = new URL("https://salescenter.allegro.com/my-assortment");
        url.searchParams.set("limit", "20");
        url.searchParams.set("phrase", number);
        url.searchParams.set("publication.status", "ACTIVE");
        url.searchParams.set("sellingMode.format", "BUY_NOW");
        url.searchParams.set("context.marketplace", "allegro-pl");
        window.open(url.href, "_blank", "noopener,noreferrer");
      };
      function showPrices(matches, total, number) {
        const offers = matches.filter(offer => /^\d+$/.test(String(offer.id)));
        const count = offers.length;
        matchedNumber = number;
        edit.disabled = false;
        message.textContent = `Pasujace aktywne aukcje: ${count}`;
        const amounts = offers.map(offer => offer.sellingMode?.price)
          .filter(price => price?.currency === "PLN" && typeof price.amount === "string" && price.amount.trim() !== "" && Number.isFinite(Number(price.amount)) && Number(price.amount) > 0)
          .map(price => Number(price.amount));
        if (amounts.length) {
          const format = value => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(value);
          const low = Math.min(...amounts), high = Math.max(...amounts);
          message.textContent += low === high ? ` · Cena: ${format(low)}` : ` · Ceny: ${format(low)} – ${format(high)}`;
          if (amounts.length < count) message.textContent += " (nie wszystkie ceny sa dostepne w PLN)";
        } else if (count) message.textContent += " · Brak danych o cenie w PLN";
        if (total >= 100) message.textContent += " (sprawdzono pierwsze 100 wynikow)";
        message.title = "Licznik dotyczy pelnego numeru. Wyszukiwarka Allegro moze znalezc takze podobne numery.";
      }
      const key = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
      function refresh(force = false) {
        const query = `${connected()}:${numberInput.value.trim()}`;
        if (!force && query === lastQuery) return;
        lastQuery = query;
        const version = ++generation; clearTimeout(timer); panel.replaceChildren(); panel.open = false; panel.classList.add("hidden");
        const number = numberInput.value.trim();
        matchedNumber = ""; edit.disabled = true;
        message.textContent = !connected() ? "Polacz Allegro, aby odczytac swoje ceny." : "Wpisz pelny numer czesci.";
        if (!connected() || key(number).length < 3 || !/\d/.test(number)) return;
        message.textContent = "Sprawdzam Twoje aktywne oferty...";
        timer = setTimeout(async () => {
          try {
            const result = await request(`/api/own-offers?number=${encodeURIComponent(number)}`);
            if (version !== generation || number !== numberInput.value.trim()) return;
            // Require the complete number (including suffix) rather than prefix matches.
            const wanted = key(number);
            const matches = (result.offers || []).filter(offer => String(offer.name).toUpperCase().split(/\s+/).some((_, i, tokens) => {
              for (let count = 1; count <= 5; count++) if (key(tokens.slice(i, i + count).join("")) === wanted) return true;
              return false;
            }));
            showPrices(matches, (result.offers || []).length, number);
            if (!matches.length) return;
            panel.classList.remove("hidden");
            const heading = document.createElement("summary"); heading.textContent = "Uzupelnij dane z mojej oferty"; panel.append(heading);
            for (const offer of matches.slice(0, 10)) {
              const button = document.createElement("button"); button.type = "button"; button.textContent = `Uzupelnij z mojej oferty: ${offer.name}`;
              button.onclick = async () => {
                button.disabled = true;
                try {
                  const detail = await request(`/api/own-offers/${encodeURIComponent(offer.id)}`);
                  if (version !== generation || number !== numberInput.value.trim()) return;
                  await apply(detail, number);
                } catch (error) { notify(error.message); }
                finally { button.disabled = false; }
              };
              panel.append(button);
            }
          } catch (error) {
            if (version === generation) { message.textContent = `Nie udalo sie odczytac cen: ${error.message}`; }
          }
        }, 800);
      }
      numberInput.addEventListener("input", () => refresh());
      reload.onclick = () => refresh(true);
      refresh();
      return { refresh, clear() { generation++; lastQuery = ""; matchedNumber = ""; edit.disabled = true; message.textContent = "Wpisz numer czesci."; clearTimeout(timer); panel.replaceChildren(); panel.open = false; panel.classList.add("hidden"); } };
    }
  };
})();
