(function () {
  const owner = new URLSearchParams(location.hash.slice(1)).get("owner") || "locked";
  const valid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(owner);
  const prefix = `wystawiacz-beta-v1:${valid ? owner : "locked"}:`;
  window.BetaStorage = {
    getItem(key) { return localStorage.getItem(prefix + key); },
    setItem(key, value) { if (!valid) throw new Error("Otworz bete przez panel."); localStorage.setItem(prefix + key, value); },
    removeItem(key) { localStorage.removeItem(prefix + key); }
  };
  window.BetaOwner = valid ? owner : "";
  const network = window.fetch.bind(window);
  window.fetch = async function (input, options = {}) {
    const request = new Request(input instanceof Request ? input.clone() : new URL(input, location.href), options);
    const url = new URL(request.url);
    if (url.origin === location.origin) {
      if (url.pathname === "/api/workspace/preferences") {
        if (!valid) return Response.json({ message: "Otworz bete przez panel." }, { status: 403 });
        if (request.method === "GET") return Response.json({ descriptionTemplate: window.BetaStorage.getItem("templates") });
        if (request.method === "PUT") {
          const data = await request.json();
          if (typeof data.descriptionTemplate !== "string" || data.descriptionTemplate.length > 20000) return Response.json({ message: "Szablon przekracza limit." }, { status: 400 });
          window.BetaStorage.setItem("templates", data.descriptionTemplate);
          return Response.json({ ok: true });
        }
      }
      if (url.pathname.startsWith("/api/workspace/") || (url.pathname.startsWith("/api/allegro/") && request.method !== "GET")) {
        return Response.json({ message: "Beta: publikacja, zmiany Allegro i zapis w stabilnych sesjach sa zablokowane." }, { status: 403 });
      }
    }
    return network(input, options);
  };
})();
