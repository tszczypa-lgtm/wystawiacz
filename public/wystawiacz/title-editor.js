(function () {
  "use strict";
  const length = text => Array.from(text).length;
  function error(text) {
    const title = text.trim();
    if (length(title) > 75) return "Tytul przekracza 75 znakow. Skroc opis, zachowujac pelny numer czesci.";
    if (length(title) < 12 || title.split(/\s+/).filter(Boolean).length < 3) return "Tytul Allegro wymaga minimum 12 znakow i 3 slow.";
    return "";
  }
  function mount() {
    const input = document.getElementById("titleInput");
    const checkbox = document.getElementById("titleUppercase");
    const counter = document.getElementById("titleCharacterCount");
    let composing = false;
    try { checkbox.checked = localStorage.getItem("wystawiacz-title-uppercase") === "true"; } catch {}
    function refresh() {
      if (composing) return;
      if (checkbox.checked) {
        const original = input.value;
        const converted = original.toLocaleUpperCase("pl-PL");
        if (converted !== original) {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          const direction = input.selectionDirection;
          input.value = converted;
          input.setSelectionRange(original.slice(0, start).toLocaleUpperCase("pl-PL").length, original.slice(0, end).toLocaleUpperCase("pl-PL").length, direction);
        }
      }
      const count = length(input.value);
      counter.textContent = `${count} / 75 znakow`;
      const problem = count > 75 ? "Tytul przekracza 75 znakow." : error(input.value);
      counter.classList.toggle("title-invalid", Boolean(problem));
      counter.classList.toggle("title-valid", !problem);
      counter.title = problem || "Poprawna dlugosc tytulu.";
      input.setAttribute("aria-invalid", problem ? "true" : "false");
    }
    input.addEventListener("input", event => { if (!event.isComposing) refresh(); });
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; input.dispatchEvent(new Event("input", { bubbles: true })); });
    checkbox.addEventListener("change", () => {
      try { localStorage.setItem("wystawiacz-title-uppercase", String(checkbox.checked)); } catch {}
      refresh();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    refresh();
    return { refresh };
  }
  window.TitleEditor = { mount, error, length };
})();
