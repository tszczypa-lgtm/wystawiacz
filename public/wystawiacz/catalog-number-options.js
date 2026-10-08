(() => {
  const full = document.getElementById("catalogNumberFullTitle");
  const number = document.getElementById("catalogNumberWithSuffix");
  const suffix = document.getElementById("catalogNumberSuffix");
  let mode = "title";
  try {
    const saved = localStorage.getItem("wystawiacz-catalog-number-mode");
    if (["title", "number", "off"].includes(saved)) mode = saved;
    suffix.value = Array.from(localStorage.getItem("wystawiacz-catalog-number-suffix") || "").slice(0, 4).join("");
  } catch {}
  function refresh() {
    full.checked = mode === "title";
    number.checked = mode === "number";
    suffix.disabled = mode !== "number";
  }
  function changed() {
    refresh();
    try {
      localStorage.setItem("wystawiacz-catalog-number-mode", mode);
      localStorage.setItem("wystawiacz-catalog-number-suffix", suffix.value);
    } catch {}
    document.dispatchEvent(new Event("catalog-number-options-change"));
  }
  full.addEventListener("change", () => { mode = full.checked ? "title" : "off"; changed(); });
  number.addEventListener("change", () => { mode = number.checked ? "number" : "off"; changed(); });
  suffix.addEventListener("input", () => {
    suffix.value = Array.from(suffix.value).slice(0, 4).join("");
    changed();
  });
  window.CatalogNumberOptions = {
    value(partNumber, title) {
      if (mode === "off") return null;
      if (mode === "title") return title.trim();
      const part = partNumber.trim();
      return part ? [part, suffix.value.trim()].filter(Boolean).join(" ") : "";
    }
  };
  refresh();
})();
