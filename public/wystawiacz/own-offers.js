(function () {
  window.OwnOffers = {
    mount({ numberInput, connected, request, apply, notify }) {
      let generation = 0, timer;
      const panel = document.createElement("div"); panel.className = "own-offers-panel hidden";
      numberInput.closest("label").after(panel);
      const key = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
      numberInput.addEventListener("input", () => {
        const version = ++generation; clearTimeout(timer); panel.replaceChildren(); panel.classList.add("hidden");
        const number = numberInput.value.trim();
        if (!connected() || key(number).length < 3 || !/\d/.test(number)) return;
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
            if (version === generation) { panel.classList.remove("hidden"); panel.textContent = `Sprawdzenie asortymentu: ${error.message}`; }
          }
        }, 800);
      });
      return { clear() { generation++; clearTimeout(timer); panel.replaceChildren(); panel.classList.add("hidden"); } };
    }
  };
})();
