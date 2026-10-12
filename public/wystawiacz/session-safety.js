(function () {
  function validate(payload) {
    if (!payload || payload.format !== "wystawiacz-allegro-session" || !Array.isArray(payload.products) || payload.products.length > 2000) throw new Error("Nieprawidlowy plik sesji.");
    const ids = new Set();
    payload.products = payload.products.map(raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Nieprawidlowa pozycja sesji.");
      const product = { ...raw };
      delete product.image;
      if (typeof product.id !== "string" || !product.id) product.id = crypto.randomUUID();
      if (ids.has(product.id)) throw new Error("Powtorzony identyfikator aukcji w sesji.");
      ids.add(product.id);
      if (typeof product.title !== "string" || product.title.length > 1000 || !Number.isInteger(Number(product.stock)) || Number(product.stock) < 1) throw new Error("Nieprawidlowy tytul lub liczba sztuk w sesji.");
      product.stock = Number(product.stock);
      if (product.allegroOfferId && !/^\d+$/.test(String(product.allegroOfferId))) throw new Error("Nieprawidlowy identyfikator oferty.");
      if (!Array.isArray(product.photoNames) || product.photoNames.some(name => typeof name !== "string" || name.length > 1000)) throw new Error("Nieprawidlowa lista zdjec.");
      return product;
    });
    if (payload.vehicles && (!Array.isArray(payload.vehicles) || payload.vehicles.length > 1000 || payload.vehicles.some(v => !v || [v.id, v.short, v.full, v.manufacturer].some(x => x != null && typeof x !== "string")))) throw new Error("Nieprawidlowa lista aut.");
    if (payload.draft) {
      if (typeof payload.draft !== "object" || Array.isArray(payload.draft)) throw new Error("Nieprawidlowy formularz sesji.");
      const draft = { ...payload.draft, stock: Number.isInteger(Number(payload.draft.stock)) && Number(payload.draft.stock) > 0 ? Number(payload.draft.stock) : 1, photoNames: payload.draft.photoNames || [] };
      payload.draft = validate({ format: payload.format, products: [draft] }).products[0];
    }
    return payload;
  }
  window.SessionSafety = { validate };
})();
