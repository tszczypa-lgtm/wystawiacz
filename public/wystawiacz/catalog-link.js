(function () {
  "use strict";
  const numberKey = value => String(value || "").toUpperCase().replace(/[ .\/-]/g, "");
  window.CatalogLink = { numberKey, mount({ getContext, request }) {
    const status = document.getElementById("catalogStatus");
    const results = document.getElementById("catalogResults");
    const search = document.getElementById("catalogSearchButton");
    const enabled = document.getElementById("catalogLinkInput");
    const options = document.getElementById("catalogLinkOptions");
    let selected = null;
    let revision = 0;
    const key = () => JSON.stringify(getContext());
    const current = () => enabled.checked && selected && selected.number === numberKey(getContext().number) && selected.categoryId === getContext().categoryId ? selected : null;
    const render = () => { status.textContent = current() ? `Polaczono: ${selected.name}` : "Nie wybrano produktu. Wybor zachowuje Twoj tytul, zdjecia, opis i cene."; };
    const clear = () => { revision++; selected = null; results.replaceChildren(); render(); search.disabled = false; };
    document.getElementById("catalogClearButton").addEventListener("click", clear);
    document.getElementById("partNumber").addEventListener("input", clear);
    document.getElementById("categoryInput").addEventListener("change", clear);
    enabled.addEventListener("change", () => {
      clear();
      options.classList.toggle("hidden", !enabled.checked);
      if (enabled.checked) search.click();
    });
    search.addEventListener("click", async () => {
      if (!enabled.checked) return;
      const snapshot = key();
      const run = ++revision;
      search.disabled = true;
      results.replaceChildren();
      status.textContent = "Szukanie produktu w katalogu...";
      try {
        const context = getContext();
        if (!context.categoryId) throw new Error("Najpierw wybierz kategorie aukcji.");
        const data = await request(`/api/catalog-products?number=${encodeURIComponent(context.number)}`);
        if (run !== revision || snapshot !== key()) return;
        for (const product of data.products || []) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary-button";
          button.textContent = product.name || product.id;
          button.addEventListener("click", async () => {
            if (run !== revision || snapshot !== key()) return;
            button.disabled = true;
            try {
              const detail = await request(`/api/catalog-products/${encodeURIComponent(product.id)}`);
              if (run !== revision || snapshot !== key()) return;
              if (detail.category?.id !== context.categoryId) throw new Error("Ten produkt ma inna kategorie. Wybierz zgodna kategorie aukcji i wyszukaj ponownie.");
              selected = { id: detail.id, name: detail.name, number: numberKey(context.number), categoryId: detail.category.id, parameters: detail.parameters || [] };
              render();
              results.replaceChildren();
            } catch (error) { if (run === revision) status.textContent = error.message; }
            finally { button.disabled = false; }
          });
          results.append(button);
        }
        status.textContent = results.children.length ? "Wybierz produkt zgodny z Twoja czescia, sprawdzajac pelny numer i wariant." : "Brak produktu z tym numerem w katalogu.";
      } catch (error) { if (run === revision) status.textContent = error.message; }
      finally { if (run === revision) search.disabled = false; }
    });
    return { get: current, requested: () => enabled.checked, restore(value, requested = Boolean(value)) {
      clear(); selected = value || null; enabled.checked = requested;
      options.classList.toggle("hidden", !enabled.checked); render();
    } };
  } };
})();
