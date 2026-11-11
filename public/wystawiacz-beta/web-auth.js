window.getWystawiaczToken = function () {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error("Otwórz Wystawiacza przez panel po zalogowaniu."));
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Sesja wygasła. Zaloguj się ponownie."));
    }, 10000);
    function receive(event) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "wystawiacz-token" || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.token) resolve(event.data.token);
      else reject(new Error("Sesja wygasła. Zaloguj się ponownie."));
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "wystawiacz-token-request", id }, location.origin);
  });
};
