(() => {
  const dialog = document.getElementById("vehiclesDialog");
  const open = document.getElementById("openVehiclesButton");
  open.addEventListener("click", () => dialog.showModal());
  document.getElementById("closeVehiclesButton").addEventListener("click", () => dialog.close());
  document.getElementById("cancelVehicleEditButton").addEventListener("click", () => resetVehicleEditor());
  dialog.addEventListener("close", () => open.focus());
  const list = document.querySelector(".list-section");
  const products = document.getElementById("productList");
  const controls = [...document.querySelectorAll("[data-list-layout]")];
  let layout = "bottom", frame;
  try { layout = localStorage.getItem("wystawiacz-list-layout") === "left" ? "left" : "bottom"; } catch {}
  function measure() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const cards = [...products.children];
      document.getElementById("productCount").textContent = String(cards.length);
      if (cards.length) {
        const first = cards[0].getBoundingClientRect();
        const last = cards[Math.min(9, cards.length - 1)].getBoundingClientRect();
        products.style.setProperty("--ten-auctions-height", `${Math.ceil(last.bottom - first.top + 4)}px`);
      }
    });
  }
  function position(value) {
    layout = value;
    document.body.classList.toggle("auction-list-left", value === "left");
    for (const button of controls) button.setAttribute("aria-pressed", String(button.dataset.listLayout === value));
    try { localStorage.setItem("wystawiacz-list-layout", value); } catch {}
    measure();
  }
  for (const button of controls) button.addEventListener("click", () => position(button.dataset.listLayout));
  document.addEventListener("wystawiacz-products-rendered", measure);
  new ResizeObserver(measure).observe(list);
  window.addEventListener("resize", measure);
  position(layout);
})();
