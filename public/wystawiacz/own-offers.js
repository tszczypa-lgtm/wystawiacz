(function () {
  window.OwnOffers = {
    mount({ numberInput, connected, request, apply, notify }) {
      let generation = 0, timer, lastQuery = "";
      const panel = document.createElement("div"); panel.className = "own-offers-panel hidden";
      numberInput.closest("label").after(panel);
      const prices = document.createElement("section"); prices.className = "own-prices-panel";
      prices.setAttribute("aria-label", "Ceny moich ofert Allegro");
      document.querySelector(".pricing-final-row").append(prices);
      const selection = new Set();
      let offers = [];
      const message = document.createElement("p"); message.setAttribute("role", "status");
      const priceHeading = document.createElement("strong"); priceHeading.textContent = "Juz wystawione na Allegro";
      const offerList = document.createElement("div"); offerList.className = "own-price-list";
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edytuj ceny wystawionych"; edit.disabled = true;
      const reload = document.createElement("button"); reload.type = "button"; reload.textContent = "Odswiez";
      prices.append(priceHeading, message, offerList, edit, reload);
      const links = document.createElement("dialog"); links.className = "own-price-dialog";
      const linkHeading = document.createElement("h2"); linkHeading.textContent = "Edytuj ceny w Allegro";
      const linkNote = document.createElement("p"); linkNote.textContent = "Kazdy przycisk otwiera edycje wskazanej oferty na Allegro. Cene zmieniasz i zapisujesz tam. Wystawiacz niczego nie zmienia.";
      const linkList = document.createElement("div"); linkList.className = "own-price-links";
      const close = document.createElement("button"); close.type = "button"; close.textContent = "Zamknij"; close.onclick = () => links.close();
      links.append(linkHeading, linkNote, linkList, close); document.body.append(links);
      edit.onclick = () => {
        const chosen = offers.filter(offer => selection.has(String(offer.id)));
        if (!chosen.length) return;
        if (chosen.length === 1) { window.open(editUrl(chosen[0].id), "_blank", "noopener,noreferrer"); return; }
        linkList.replaceChildren();
        for (const offer of chosen) {
          const link = document.createElement("a"); link.href = editUrl(offer.id); link.target = "_blank"; link.rel = "noopener noreferrer";
          link.textContent = offer.name + " - " + price(offer);
          linkList.append(link);
        }
        links.showModal();
      };
      function editUrl(id) { return `https://allegro.pl/offer/${encodeURIComponent(id)}/edit`; }
      function price(offer) {
        const value = offer.sellingMode?.price;
        const amount = Number(value?.amount);
        return value && Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat("pl-PL", { style: "currency", currency: /^[A-Z]{3}$/.test(value.currency) ? value.currency : "PLN" }).format(amount) : "Brak ceny";
      }
      function showPrices(matches, total) {
        offers = matches.filter(offer => /^\d+$/.test(String(offer.id)));
        selection.clear(); edit.disabled = !offers.length; offerList.replaceChildren();
        message.textContent = offers.length ? `Pasujace aktywne oferty: ${offers.length}. Wybierz oferty do edycji.` : "Brak pasujacych aktywnych ofert.";
        if (total >= 100) message.textContent += " Wynik ograniczony do pierwszych 100 ofert; zawez numer.";
        for (const offer of offers) {
          const label = document.createElement("label"); label.className = "own-price-choice";
          const input = document.createElement("input"); input.type = "checkbox"; input.checked = true; selection.add(String(offer.id));
          const text = document.createElement("span"); text.textContent = offer.name; text.title = `Oferta ${offer.id}`;
          const amount = document.createElement("strong"); amount.textContent = price(offer);
          input.onchange = () => { if (input.checked) selection.add(String(offer.id)); else selection.delete(String(offer.id)); edit.disabled = !selection.size; };
          label.append(input, text, amount); offerList.append(label);
        }
      }
      const key = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
      function refresh(force = false) {
        const query = `${connected()}:${numberInput.value.trim()}`;
        if (!force && query === lastQuery) return;
        lastQuery = query; links.close();
        const version = ++generation; clearTimeout(timer); panel.replaceChildren(); panel.classList.add("hidden");
        const number = numberInput.value.trim();
        selection.clear(); offers = []; offerList.replaceChildren(); edit.disabled = true;
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
            showPrices(matches, (result.offers || []).length);
            if (!matches.length) return;
            panel.classList.remove("hidden");
            const heading = document.createElement("strong"); heading.textContent = "Masz ten numer w swoim asortymencie"; panel.append(heading);
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
      return { refresh, clear() { generation++; lastQuery = ""; selection.clear(); offers = []; offerList.replaceChildren(); edit.disabled = true; links.close(); message.textContent = "Wpisz numer czesci."; clearTimeout(timer); panel.replaceChildren(); panel.classList.add("hidden"); } };
    }
  };
})();
