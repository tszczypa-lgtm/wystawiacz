(function () {
  const marker = "{{AUTO}}", titleMarker = "{{TYTUL}}", partMarker = "{{CZESC}}";
  function partTitle(title, vehicle, number) {
    let text = String(title || "").trim(), removed = false;
    if (vehicle?.short) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${vehicle.short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
      removed = pattern.test(text); text = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
    }
    if (!removed) text = window.TitleSuggestions?.partName(text) || "";
    const part = String(number || "").trim();
    if (text && part) {
      const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
      text = text.replace(pattern, " ").replace(/\s+/g, " ").trim();
      if (text) text += ` ${part}`;
    }
    return text.toUpperCase();
  }
  const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  function paragraphs(text, escape) {
    const bold = line => escape(line).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    let list = false, html = "";
    for (const raw of String(text || "").split(/\n/)) {
      const line = raw.trim();
      if (!line) { if (list) html += "</ul>"; list = false; continue; }
      if (line.startsWith("- ")) { if (!list) html += "<ul>"; list = true; html += `<li>${bold(line.slice(2))}</li>`; }
      else { if (list) html += "</ul>"; list = false; html += `<p>${bold(line)}</p>`; }
    }
    return html + (list ? "</ul>" : "");
  }
  function descriptionHtml(text, title, vehicle, fullLayout, number) {
    // Expand before making paragraphs: Allegro accepts paragraphs, not <br>.
    const expandedBoldVehicle = String(text || "").replace(/\*\*\{\{AUTO\}\}\*\*/g, () => String(vehicle?.full || "").split("\n").map(line => line ? `**${line}**` : "").join("\n"));
    const resolved = expandedBoldVehicle.replace(/\{\{(AUTO|TYTUL|CZESC)\}\}/g, (_match, kind) => kind === "TYTUL" ? String(title || "").toUpperCase() : kind === "CZESC" ? partTitle(title, vehicle, number) : vehicle?.full || "");
    const body = paragraphs(resolved, escape);
    return (fullLayout ? "" : `<p>${escape(String(title || "").toUpperCase())}</p>`) + body;
  }
  window.DescriptionEditor = {
    paragraphs, descriptionHtml, partTitle,
    mount({ state, input, vehicleInput, selectedVehicle, titleInput, partNumberInput, notify }) {
      let template = `${titleMarker}\n\nCzęść używana 100% sprawna\n\n${marker}`;
      let savedRange = null, lastRendered = "";
      let templates = [], loaded = false, saving = false;
      const select = document.getElementById("descriptionTemplateSelect"), nameInput = document.getElementById("descriptionTemplateName"), status = document.getElementById("descriptionTemplateStatus");
      const saveNew = document.getElementById("saveDescriptionTemplate"), overwrite = document.getElementById("overwriteDescriptionTemplate"), apply = document.getElementById("applyDescriptionTemplate"), reload = document.getElementById("reloadDescriptionTemplates");
      const bar = document.createElement("div"); bar.className = "description-toolbar";
      const editor = document.createElement("div");
      editor.id = "descriptionVisualEditor"; editor.className = "formatted-description description-visual-editor";
      editor.contentEditable = "true"; editor.setAttribute("role", "textbox"); editor.setAttribute("aria-multiline", "true"); editor.setAttribute("aria-label", "Edytuj caly opis aukcji");
      input.hidden = true; input.before(bar, editor);
      const hint = document.createElement("small"); hint.className = "description-editor-hint";
      hint.textContent = "Edytuj opis tutaj. Ustaw kursor i wstaw tytul lub pelne dane auta. Oznaczone bloki aktualizuja sie automatycznie; mozna je usunac i wstawic w inne miejsce.";
      editor.before(hint);
      function remember() {
        const selection = window.getSelection();
        if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) savedRange = selection.getRangeAt(0).cloneRange();
      }
      document.addEventListener("selectionchange", remember);
      function restore() {
        const previous = savedRange?.cloneRange();
        editor.focus();
        const range = previous && editor.contains(previous.startContainer) && editor.contains(previous.endContainer) ? previous : document.createRange();
        if (range !== previous) { range.selectNodeContents(editor); range.collapse(false); }
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return range;
      }
      function serialize(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, " ").replace(/\u200b/g, "");
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        if (node.dataset.descriptionToken) return node.dataset.descriptionToken === "title" ? titleMarker : node.dataset.descriptionToken === "part" ? partMarker : marker;
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)) return "";
        if (node.tagName === "BR") return "\n";
        const text = Array.from(node.childNodes).map(serialize).join("");
        if (["B", "STRONG"].includes(node.tagName)) return `**${text}**`;
        if (node.tagName === "LI") return `- ${text.trim()}\n`;
        return ["P", "DIV", "H1", "H2", "H3", "UL", "OL"].includes(node.tagName) ? text.replace(/\n?$/, "\n") : text;
      }
      function renderKey() { return JSON.stringify([input.value, titleInput.value, selectedVehicle()?.full || "", selectedVehicle()?.short || "", partNumberInput?.value || ""]); }
      function commit() {
        input.value = Array.from(editor.childNodes).map(serialize).join("").trim();
        state.descriptionFullLayout = true; state.vehicleDescriptionBlock = null;
        // Preserve DOM and caret while the surrounding form synchronizes its state.
        lastRendered = renderKey();
        input.dispatchEvent(new Event("input", { bubbles: true })); remember();
      }
      function migrate() {
        if (state.descriptionFullLayout) return;
        const block = state.vehicleDescriptionBlock;
        let text = state.descriptionText || "";
        if (block && text.slice(block.start, block.end) === block.text) text = text.slice(0, block.start) + marker + text.slice(block.end);
        state.descriptionText = `${titleMarker}\n\n${text}`;
        state.descriptionFullLayout = true; state.vehicleDescriptionBlock = null; input.value = state.descriptionText;
      }
      function refresh() {
        migrate();
        const key = renderKey(); if (key === lastRendered) return;
        editor.innerHTML = paragraphs(input.value, escape);
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT), texts = [];
        while (walker.nextNode()) if (/\{\{(?:AUTO|TYTUL|CZESC)\}\}/.test(walker.currentNode.textContent)) texts.push(walker.currentNode);
        for (const node of texts) {
          const fragment = document.createDocumentFragment();
          for (const part of node.textContent.split(/(\{\{(?:AUTO|TYTUL|CZESC)\}\})/)) {
            if (![marker, titleMarker, partMarker].includes(part)) { fragment.append(document.createTextNode(part)); continue; }
            const chip = document.createElement("span"); chip.className = "description-token"; chip.contentEditable = "false";
            chip.dataset.descriptionToken = part === titleMarker ? "title" : part === partMarker ? "part" : "vehicle";
            chip.title = part === titleMarker ? "Automatyczny tytul aukcji" : part === partMarker ? "Czesc i numer bez modelu auta" : "Pelne dane wybranego auta";
            chip.textContent = part === titleMarker ? titleInput.value.trim().toUpperCase() || "[Tytul aukcji]" : part === partMarker ? partTitle(titleInput.value, selectedVehicle(), partNumberInput?.value) || "[Wybierz auto, aby oddzielic model od nazwy czesci]" : selectedVehicle()?.full || "[Wybierz auto z listy pojazdow]";
            // Editable caret stops on both sides of an atomic, non-editable block.
            fragment.append(document.createTextNode("\u200b"), chip, document.createTextNode("\u200b"));
          }
          node.replaceWith(fragment);
        }
        lastRendered = key; savedRange = null;
      }
      editor.addEventListener("input", commit);
      editor.addEventListener("click", event => {
        const chip = event.target.closest?.("[data-description-token]");
        if (!chip) return;
        const range = document.createRange(); range.setStartAfter(chip); range.collapse(true);
        editor.focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); remember();
      });
      editor.addEventListener("paste", event => {
        event.preventDefault(); restore(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); commit();
      });
      editor.addEventListener("drop", event => event.preventDefault());
      function button(label, action) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = label;
        button.addEventListener("mousedown", event => event.preventDefault()); button.onclick = action; bar.append(button); return button;
      }
      const boldButton = button("B", () => { restore(); document.execCommand("bold"); commit(); });
      boldButton.className = "description-format-button"; boldButton.setAttribute("aria-label", "Pogrubienie"); boldButton.title = "Pogrubienie zaznaczonego tekstu (Ctrl+B)";
      function insertToken(kind) {
        const existing = editor.querySelector(`[data-description-token="${kind}"]`);
        if (existing) existing.remove();
        const range = restore(); range.deleteContents(); range.insertNode(document.createTextNode(kind === "title" ? titleMarker : kind === "part" ? partMarker : marker));
        commit(); lastRendered = ""; refresh(); editor.focus();
        const chip = editor.querySelector(`[data-description-token="${kind}"]`);
        if (chip) {
          const caret = document.createRange(); caret.setStartAfter(chip); caret.collapse(true);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(caret); remember();
        }
      }
      button("Wstaw tytul tutaj", () => insertToken("title"));
      button("Wstaw czesc + numer bez auta", () => insertToken("part"));
      button("Wstaw dane auta tutaj", () => insertToken("vehicle"));
      async function request(method, body) {
        const token = await window.getWystawiaczToken();
        const result = await fetch("/api/workspace/preferences", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const data = await result.json(); if (!result.ok) throw new Error(data.message); return data;
      }
      function controls() {
        saveNew.disabled = overwrite.disabled = apply.disabled = !loaded || saving;
        overwrite.disabled ||= !select.value; apply.disabled ||= !select.value; reload.disabled = saving;
      }
      function showTemplates(selectedId) {
        select.replaceChildren();
        const empty = document.createElement("option"); empty.value = ""; empty.textContent = templates.length ? "Wybierz szablon" : "Brak zapisanych szablonow"; select.append(empty);
        for (const entry of templates) { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.name; select.append(option); }
        select.value = selectedId || ""; const current = templates.find(t => t.id === select.value);
        nameInput.value = current?.name || ""; if (current) template = current.text; controls();
      }
      select.onchange = () => { const selected = templates.find(t => t.id === select.value); nameInput.value = selected?.name || ""; controls(); };
      async function loadTemplates() {
        loaded = false; controls(); status.textContent = "Wczytywanie szablonow...";
        try {
          const data = await request("GET"); const raw = data.descriptionTemplate;
          let saved; try { saved = JSON.parse(raw); } catch {}
          if (saved?.format === "wystawiacz-description-templates-v3" && Array.isArray(saved.templates)) {
            templates = saved.templates.filter(t => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.text === "string");
          } else if (typeof raw === "string") {
            templates = [{ id: "00000000-0000-4000-8000-000000000001", name: "Moj dotychczasowy szablon", text: saved?.format === "wystawiacz-description-v2" && typeof saved.text === "string" ? saved.text : `${titleMarker}\n\n${raw}` }];
          } else templates = [];
          loaded = true; showTemplates(saved?.selectedId || templates[0]?.id);
          status.textContent = templates.length ? `Wczytano ${templates.length} szablonow z Twojego konta.` : "Nazwij gotowy opis i zapisz pierwszy szablon.";
        } catch (error) { status.textContent = `Nie wczytano szablonow: ${error.message} Nie nadpisujemy zapisanych danych.`; }
      }
      async function saveTemplate(replace) {
        if (!loaded || saving) return;
        const name = nameInput.value.trim(); if (!name) { nameInput.focus(); status.textContent = "Wpisz nazwe szablonu."; return; }
        const existing = templates.find(t => t.id === select.value);
        if (replace && (!existing || !window.confirm(`Nadpisac szablon: ${existing.name}?`))) return;
        const entry = { id: replace ? existing.id : crypto.randomUUID(), name, text: input.value };
        const next = replace ? templates.map(t => t.id === entry.id ? entry : t) : [...templates, entry];
        saving = true; controls(); status.textContent = "Zapisywanie...";
        try {
          await request("PUT", { descriptionTemplate: JSON.stringify({ format: "wystawiacz-description-templates-v3", templates: next, selectedId: entry.id }) });
          templates = next; template = entry.text; showTemplates(entry.id); status.textContent = `Zapisano szablon: ${name}.`; notify(status.textContent);
        } catch (error) { status.textContent = `Nie zapisano: ${error.message}`; notify(status.textContent); }
        finally { saving = false; controls(); }
      }
      saveNew.onclick = () => saveTemplate(false); overwrite.onclick = () => saveTemplate(true); reload.onclick = loadTemplates;
      apply.onclick = () => {
        const selected = templates.find(t => t.id === select.value); if (!selected) return;
        if (input.value && !window.confirm("Zastapic caly opis Twoim szablonem?")) return;
        template = selected.text;
        state.descriptionText = input.value = template; state.descriptionFullLayout = true;
        state.descriptionManuallyEdited = true; state.vehicleDescriptionBlock = null; refresh();
        status.textContent = `Zastosowano: ${selected.name}.`;
      };
      void loadTemplates();
      vehicleInput.setAttribute("aria-description", "Pelna nazwa auta do automatycznego bloku w opisie");
      function replaceVehicle(vehicle) {
        if (state.descriptionFullLayout && state.descriptionText.includes(marker)) { lastRendered = ""; refresh(); return true; }
        const block = state.vehicleDescriptionBlock;
        if (!block || state.descriptionText.slice(block.start, block.end) !== block.text) return false;
        const text = vehicle?.full || "";
        state.descriptionText = state.descriptionText.slice(0, block.start) + text + state.descriptionText.slice(block.end);
        state.vehicleDescriptionBlock = { start: block.start, end: block.start + text.length, text };
        input.value = state.descriptionText; refresh(); return true;
      }
      function automatic() { state.descriptionText = template; state.descriptionFullLayout = true; state.vehicleDescriptionBlock = null; }
      return { replaceVehicle, refresh, automatic };
    }
  };
})();
