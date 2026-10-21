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
    const sides = document.getElementById("titleSideButtons");
    let hasCaret = false;
    input.addEventListener("focus", () => { hasCaret = true; });
    for (const side of ["przód", "tył", "lewy", "prawy", "lewy przód", "prawy przód", "lewy tył", "prawy tył"]) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = side;
      button.style.gridArea = ({ "przód": "front", "tył": "rear", "lewy": "left", "prawy": "right", "lewy przód": "frontLeft", "prawy przód": "frontRight", "lewy tył": "rearLeft", "prawy tył": "rearRight" })[side];
      button.addEventListener("mousedown", event => event.preventDefault());
      button.onclick = () => {
        let start = input.selectionStart, end = input.selectionEnd;
        if (!hasCaret || start === end && end === input.value.length) {
          const part = document.getElementById("partNumber")?.value.trim();
          start = end = part && input.value.endsWith(part) ? input.value.length - part.length : input.value.length;
          const existing = [...input.value.matchAll(/(?<![\p{L}\p{N}])(?:(?:lewy|prawy)\s+(?:prz[oó]d|ty[lł])|(?:prz[oó]d|ty[lł])\s+(?:lewy|prawy)|prz[oó]d|ty[lł]|lewy|prawy)(?![\p{L}\p{N}])/giu)];
          if (existing.length === 1) { start = existing[0].index; end = start + existing[0][0].length; }
        }
        const before = input.value.slice(0, start), after = input.value.slice(end);
        const prefix = before && !/\s$/.test(before) ? " " : "";
        const suffix = after && !/^\s/.test(after) ? " " : "";
        input.setRangeText(prefix + side + suffix, start, end, "select");
        const selectedStart = start + prefix.length;
        input.setSelectionRange(selectedStart, selectedStart + side.length);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus(); hasCaret = true;
      };
      sides?.append(button);
    }
    const car = document.createElement("span"); car.className = "side-diagram-car"; car.setAttribute("aria-hidden", "true"); car.textContent = "AUTO"; sides?.append(car);
    refresh();
    return { refresh };
  }
  window.TitleEditor = { mount, error, length };
})();
