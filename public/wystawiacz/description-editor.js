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
      let templates = [], snippets = [], selectedId = "", appliedId = "", loaded = false, saving = false, replacing = false, editingSnippet = "", editingSnippets = false;
      const templateButtons = document.getElementById("descriptionTemplateButtons"), nameInput = document.getElementById("descriptionTemplateName"), status = document.getElementById("descriptionTemplateStatus");
      const saveNew = document.getElementById("saveDescriptionTemplate"), overwrite = document.getElementById("overwriteDescriptionTemplate"), reload = document.getElementById("reloadDescriptionTemplates");
      const templateForm = document.getElementById("descriptionTemplateForm"), confirmTemplate = document.getElementById("confirmDescriptionTemplate");
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
      const expressions = document.createElement("div"); expressions.className = "description-expressions";
      expressions.innerHTML = '<div class="expression-heading"><strong>Moje wyrazenia</strong><button type="button" id="addDescriptionExpression">+ Wyrazenie</button><button type="button" id="editDescriptionExpressions">Edytuj</button></div><div id="descriptionExpressionButtons" class="template-buttons"></div><div id="descriptionExpressionForm" hidden><input id="descriptionExpressionName" maxlength="40" placeholder="Nazwa przycisku" aria-label="Nazwa wyrazenia"><textarea id="descriptionExpressionText" rows="2" maxlength="2000" placeholder="Tekst do wstawienia w opis" aria-label="Tresc wyrazenia"></textarea><div class="expression-actions"><button type="button" id="saveDescriptionExpression">Zapisz wyrazenie</button><button type="button" id="deleteDescriptionExpression">Usun</button><button type="button" id="cancelDescriptionExpression">Anuluj</button></div></div><small id="descriptionExpressionStatus" role="status">Ustaw kursor w opisie i kliknij wyrazenie.</small>';
      bar.after(expressions);
      const expressionButtons = expressions.querySelector("#descriptionExpressionButtons"), expressionForm = expressions.querySelector("#descriptionExpressionForm");
      const expressionName = expressions.querySelector("#descriptionExpressionName"), expressionText = expressions.querySelector("#descriptionExpressionText"), expressionStatus = expressions.querySelector("#descriptionExpressionStatus");
      function showExpressionForm(entry) {
        editingSnippet = entry?.id || ""; expressionName.value = entry?.name || ""; expressionText.value = entry?.text || "";
        expressionForm.hidden = false; expressions.querySelector("#deleteDescriptionExpression").hidden = !entry; expressionName.focus();
      }
      expressions.querySelector("#addDescriptionExpression").onclick = () => showExpressionForm();
      expressions.querySelector("#editDescriptionExpressions").onclick = () => { editingSnippets = !editingSnippets; showSnippets(); };
      expressions.querySelector("#cancelDescriptionExpression").onclick = () => { expressionForm.hidden = true; };
      function showSnippets() {
        expressionButtons.replaceChildren();
        expressions.querySelector("#editDescriptionExpressions").setAttribute("aria-pressed", String(editingSnippets));
        expressionStatus.textContent = editingSnippets ? "Kliknij wyrazenie, aby zmienic tekst lub je usunac." : "Ustaw kursor w opisie i kliknij wyrazenie.";
        for (const entry of snippets) {
          const b = document.createElement("button"); b.type = "button"; b.textContent = entry.name; b.title = entry.text; b.dataset.expressionId = entry.id;
          b.addEventListener("mousedown", e => e.preventDefault());
          b.onclick = () => {
            if (editingSnippets) { showExpressionForm(entry); return; }
            const range = restore(); range.deleteContents();
            const fragment = document.createDocumentFragment();
            for (const [i, line] of entry.text.split("\n").entries()) { if (i) fragment.append(document.createElement("br")); fragment.append(document.createTextNode(line)); }
            const last = fragment.lastChild; range.insertNode(fragment); range.setStartAfter(last); range.collapse(true);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); commit();
          };
          b.disabled = !loaded || saving; expressionButtons.append(b);
        }
      }
      async function saveExpression(remove = false) {
        if (!loaded || saving) return;
        const name = expressionName.value.trim(), text = expressionText.value.trim();
        if (!remove && (!name || !text || /\{\{(?:AUTO|TYTUL|CZESC)\}\}/.test(text))) { expressionStatus.textContent = "Podaj nazwe i zwykly tekst (bez blokow automatycznych)."; return; }
        if (remove && !window.confirm("Usunac ten przycisk wyrazenia?")) return;
        const entry = { id: editingSnippet || crypto.randomUUID(), name, text };
        const next = remove ? snippets.filter(s => s.id !== editingSnippet) : editingSnippet ? snippets.map(s => s.id === editingSnippet ? entry : s) : [...snippets, entry];
        if (next.length > 30) { expressionStatus.textContent = "Mozesz zapisac do 30 wyrazen."; return; }
        const result = await persist(templates, next, selectedId, expressionStatus);
        if (result) { snippets = next; expressionForm.hidden = true; editingSnippets = false; showSnippets(); expressionStatus.textContent = remove ? "Usunieto wyrazenie." : "Zapisano wyrazenie na Twoim koncie."; }
      }
      expressions.querySelector("#saveDescriptionExpression").onclick = () => saveExpression();
      expressions.querySelector("#deleteDescriptionExpression").onclick = () => saveExpression(true);
      async function request(method, body) {
        const token = await window.getWystawiaczToken();
        const result = await fetch("/api/workspace/preferences", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const data = await result.json(); if (!result.ok) throw new Error(data.message); return data;
      }
      function controls() {
        saveNew.disabled = confirmTemplate.disabled = !loaded || saving;
        overwrite.disabled = !loaded || saving || !selectedId; reload.disabled = saving;
        templateButtons.querySelectorAll("button").forEach(b => { b.disabled = !loaded || saving; });
        expressions.querySelectorAll("button").forEach(b => { b.disabled = !loaded || saving; });
      }
      function showTemplates(id) {
        selectedId = templates.some(t => t.id === id) ? id : ""; templateButtons.replaceChildren();
        if (!templates.length) templateButtons.textContent = "Brak szablonow. Gotowy opis zapiszesz przyciskiem Zapisz.";
        for (const entry of templates) {
          const b = document.createElement("button"); b.type = "button"; b.textContent = entry.name; b.dataset.templateId = entry.id;
          b.setAttribute("aria-pressed", String(entry.id === selectedId)); b.title = "Wstaw ten szablon do opisu";
          b.onclick = () => {
            if (input.value !== entry.text && state.descriptionManuallyEdited && !window.confirm("Zastapic obecny opis szablonem?")) return;
            template = entry.text; appliedId = entry.id; state.descriptionText = input.value = template; state.descriptionFullLayout = true;
            state.descriptionManuallyEdited = true; state.vehicleDescriptionBlock = null; refresh(); showTemplates(entry.id);
            input.dispatchEvent(new Event("input", { bubbles: true })); status.textContent = `Wybrano: ${entry.name}.`;
          };
          templateButtons.append(b);
        }
        const current = templates.find(t => t.id === selectedId); if (current) template = current.text; controls();
      }
      async function loadTemplates() {
        loaded = false; controls(); status.textContent = "Wczytywanie szablonow...";
        try {
          const data = await request("GET"); const raw = data.descriptionTemplate;
          let saved; try { saved = JSON.parse(raw); } catch {}
          if (saved?.format === "wystawiacz-description-templates-v3" && Array.isArray(saved.templates)) {
            templates = saved.templates.filter(t => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.text === "string");
            snippets = Array.isArray(saved.snippets) ? saved.snippets.filter(s => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.text === "string") : [];
          } else if (typeof raw === "string") {
            templates = [{ id: "00000000-0000-4000-8000-000000000001", name: "Moj dotychczasowy szablon", text: saved?.format === "wystawiacz-description-v2" && typeof saved.text === "string" ? saved.text : `${titleMarker}\n\n${raw}` }];
          } else templates = [];
          loaded = true; showTemplates(saved?.selectedId || templates[0]?.id); showSnippets();
          status.textContent = templates.length ? `Wczytano ${templates.length} szablonow z Twojego konta.` : "Nazwij gotowy opis i zapisz pierwszy szablon.";
        } catch (error) { status.textContent = `Nie wczytano szablonow: ${error.message} Nie nadpisujemy zapisanych danych.`; }
      }
      async function persist(nextTemplates, nextSnippets, nextId, message) {
        saving = true; controls(); message.textContent = "Zapisywanie...";
        try {
          await request("PUT", { descriptionTemplate: JSON.stringify({ format: "wystawiacz-description-templates-v3", templates: nextTemplates, snippets: nextSnippets, selectedId: nextId || null }) });
          return true;
        } catch (error) { message.textContent = `Nie zapisano: ${error.message}`; notify(message.textContent); return false; }
        finally { saving = false; controls(); }
      }
      function openTemplateForm(replace) {
        replacing = replace; const current = templates.find(t => t.id === selectedId);
        nameInput.value = replace ? current?.name || "" : ""; templateForm.hidden = false;
        document.getElementById("descriptionTemplateFormHint").textContent = replace ? "Popraw opis w edytorze ponizej, potem zapisz tutaj. Zastapisz wybrany szablon." : "Zapiszesz obecny opis jako nowy szablon.";
        nameInput.focus();
      }
      async function saveTemplate(replace) {
        if (!loaded || saving) return;
        const name = nameInput.value.trim(); if (!name) { nameInput.focus(); status.textContent = "Wpisz nazwe szablonu."; return; }
        const existing = templates.find(t => t.id === selectedId);
        if (replace && (!existing || !window.confirm(`Nadpisac szablon: ${existing.name}?`))) return;
        const entry = { id: replace ? existing.id : crypto.randomUUID(), name, text: input.value };
        const next = replace ? templates.map(t => t.id === entry.id ? entry : t) : [...templates, entry];
        if (next.length > 20) { status.textContent = "Mozesz zapisac do 20 szablonow."; return; }
        if (await persist(next, snippets, entry.id, status)) {
          templates = next; template = entry.text; appliedId = entry.id; showTemplates(entry.id); templateForm.hidden = true;
          status.textContent = `Zapisano szablon: ${name}.`; notify(status.textContent);
        }
      }
      saveNew.onclick = () => openTemplateForm(false);
      overwrite.onclick = () => {
        const current = templates.find(t => t.id === selectedId); if (!current) return;
        if (appliedId !== selectedId && input.value !== current.text) {
          if (!window.confirm("Otworzyc zapisany szablon do edycji? Obecny opis zostanie zastapiony.")) return;
          state.descriptionText = input.value = current.text; state.descriptionFullLayout = true; state.descriptionManuallyEdited = true; state.vehicleDescriptionBlock = null;
          refresh(); input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        appliedId = current.id; openTemplateForm(true);
      };
      reload.onclick = loadTemplates;
      confirmTemplate.onclick = () => saveTemplate(replacing);
      nameInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); void saveTemplate(replacing); } });
      document.getElementById("cancelDescriptionTemplate").onclick = () => { templateForm.hidden = true; };
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
