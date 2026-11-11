(function () {
  function collect(doc = document, href = location.href) {
    const page = new URL(href);
    if (!(page.hostname === "allegro.pl" || page.hostname.endsWith(".allegro.pl"))) throw Error("Uruchom tę zakładkę na liście wyników Allegro.");
    const number = (page.searchParams.get("string") || "").replace(/[ .\/-]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{5,32}$/.test(number) || !/\d/.test(number)) throw Error("Otwórz Allegro przyciskiem Po numerze w Wystawiaczu.");
    const exact = new RegExp(`(?<![A-Z0-9])${number.split("").join("[ .\\/-]*")}(?![A-Z0-9])`, "i");
    const offers = new Map();
    function add(title, href, raw) {
      if (!title || !exact.test(title) || /uszkodz|niesprawn|do naprawy|na cz[eę][sś]ci/i.test(title.replace(/nieuszkodz\p{L}*|bez uszkodz\p{L}*/giu, ""))) return;
      let url; try { url = new URL(href, page); } catch { return; }
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "allegro.pl" || url.hostname.endsWith(".allegro.pl")) || !/^\/oferta\/.+-\d+\/?$/.test(url.pathname)) return;
      const clean = String(raw).replace(/[\s\u00a0\u202f]/g, "").replace(/(?:zł|PLN)$/i, "");
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(clean)) return;
      const amount = Number(clean.replace(",", ".")); if (!(amount > 0 && amount <= 10000000)) return;
      url.search = ""; url.hash = "";
      offers.set(url.href, { title: title.trim().slice(0, 500), url: url.href, amount, currency: "PLN" });
    }
    const cards = new Set(doc.querySelectorAll('[data-role="offer"],article,[data-item="true"]'));
    for (const card of cards) {
      if (!card.getClientRects().length || card.closest('[hidden],[aria-hidden="true"]')) continue;
      const link = card.querySelector('h2 a[href*="/oferta/"],h3 a[href*="/oferta/"],a[href*="/oferta/"]');
      if (!link) continue;
      const title = card.querySelector("h2,h3")?.textContent || link.getAttribute("title") || link.textContent;
      const canonical = new URL(link.href, page); canonical.search = ""; canonical.hash = "";
      const prices = [...card.querySelectorAll('[itemprop="price"],[data-role="price"],[data-test-tag="price-container"],[aria-label*="aktualna cena" i],strong')];
      for (const node of prices) {
        if (node.closest('del,s,[hidden],[aria-hidden="true"],[data-role*="installment"],[data-test-tag*="installment"]') || !node.getClientRects().length) continue;
        const raw = node.getAttribute("content") || node.getAttribute("aria-label")?.replace(/^aktualna cena[:\s]*/i, "") || node.textContent;
        if (node.matches('[itemprop="price"]') || /(?:zł|PLN)\s*$/i.test(raw || "")) { add(title, link.href, raw); if (offers.has(canonical.href)) break; }
      }
    }
    if (!offers.size) throw Error("Nie odczytano cen pasujących ofert. Poczekaj na załadowanie zwykłej listy Allegro. Zakładka nie omija ekranów weryfikacji.");
    return { format: "wystawiacz-price-quotes-v1", source: "Allegro", number, checkedAt: new Date().toISOString(), offers: [...offers.values()].sort((a, b) => a.amount - b.amount).slice(0, 100) };
  }
  function validate(raw, number) {
    if (typeof raw !== "string" || raw.length > 100000) throw Error("Odczyt jest zbyt duży.");
    let data; try { data = JSON.parse(raw); } catch { throw Error("Wklej odczyt z zakładki Odczytaj ceny Allegro, nie samą cenę."); }
    const query = number.replace(/[ .\/-]/g, "").toUpperCase();
    if (data?.format !== "wystawiacz-price-quotes-v1" || data.source !== "Allegro" || !/^[A-Z0-9]{5,32}$/.test(query) || data.number !== query) throw Error("Odczyt dotyczy innego numeru części.");
    if (!Array.isArray(data.offers) || !data.offers.length || data.offers.length > 100) throw Error("Brak poprawnych ofert w odczycie.");
    const time = Date.parse(data.checkedAt), age = Date.now() - time;
    if (!Number.isFinite(time) || age > 30 * 60000 || age < -60000) throw Error("Odczyt jest nieaktualny. Odczytaj ponownie otwartą listę Allegro.");
    const exact = new RegExp(`(?<![A-Z0-9])${query.split("").join("[ .\\/-]*")}(?![A-Z0-9])`, "i");
    const unique = new Map();
    for (const offer of data.offers) {
      if (typeof offer?.title !== "string" || offer.title.length > 500 || !exact.test(offer.title) || offer.currency !== "PLN" || !Number.isFinite(offer.amount) || offer.amount <= 0 || offer.amount > 10000000) throw Error("Odczyt zawiera nieprawidłową cenę lub inną część.");
      let url; try { url = new URL(offer.url); } catch { throw Error("Nieprawidłowy link oferty."); }
      if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "allegro.pl" || url.hostname.endsWith(".allegro.pl")) || !/^\/oferta\/.+-\d+\/?$/.test(url.pathname)) throw Error("Link nie prowadzi do oferty Allegro.");
      unique.set(url.href, { title: offer.title, amount: offer.amount, currency: "PLN", url: url.href });
    }
    const offers = [...unique.values()].sort((a, b) => a.amount - b.amount);
    return { source: "Allegro", status: "ok", checkedAt: data.checkedAt, count: offers.length, lowest: offers[0], message: "Minimum z ofert odczytanych przez Ciebie na otwartej stronie Allegro; bez dostawy. Nie jest to gwarancja minimum całego serwisu." };
  }
  function bookmarklet() {
    return `javascript:void(async()=>{try{const data=(${collect.toString()})();const text=JSON.stringify(data);try{await navigator.clipboard.writeText(text);alert('Skopiowano ceny '+data.offers.length+' ofert. Wroc do Wystawiacza i wklej odczyt.')}catch{prompt('Skopiuj odczyt i wklej go w Wystawiaczu:',text)}}catch(e){alert(e.message)}})()`;
  }
  window.AllegroPriceReader = { collect, validate, bookmarklet };
})();
