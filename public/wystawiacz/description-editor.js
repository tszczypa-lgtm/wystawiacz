(function () {
  const marker = "{{AUTO}}", titleMarker = "{{TYTUL}}";
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
  function descriptionHtml(text, title, vehicle, fullLayout) {
    // Expand before making paragraphs: Allegro accepts paragraphs, not <br>.
    const expandedBoldVehicle = String(text || "").replace(/\*\*\{\{AUTO\}\}\*\*/g, () => String(vehicle?.full || "").split("\n").map(line => line ? `**${line}**` : "").join("\n"));
    const resolved = expandedBoldVehicle.replace(/\{\{(AUTO|TYTUL)\}\}/g, (_match, kind) => kind === "TYTUL" ? String(title || "").toUpperCase() : vehicle?.full || "");
    const body = paragraphs(resolved, escape);
    return (fullLayout ? "" : `<p>${escape(String(title || "").toUpperCase())}</p>`) + body;
  }
  window.DescriptionEditor = {
    paragraphs, descriptionHtml,
    mount({ state, input, vehicleInput, selectedVehicle, titleInput, notify }) {
      let template = `${titleMarker}\n\nCzęść używana 100% sprawna\n\n${marker}`;
      let savedRange = null, lastRendered = "";
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
        editor.focus();
        const range = savedRange && editor.contains(savedRange.startContainer) && editor.contains(savedRange.endContainer) ? savedRange : document.createRange();
        if (range !== savedRange) { range.selectNodeContents(editor); range.collapse(false); }
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return range;
      }
      function serialize(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\u00a0/g, " ").replace(/\u200b/g, "");
        if (node.nodeType !== Node.ELEMENT_NODE) return "";
        if (node.dataset.descriptionToken) return node.dataset.descriptionToken === "title" ? titleMarker : marker;
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)) return "";
        if (node.tagName === "BR") return "\n";
        const text = Array.from(node.childNodes).map(serialize).join("");
        if (["B", "STRONG"].includes(node.tagName)) return `**${text}**`;
        if (node.tagName === "LI") return `- ${text.trim()}\n`;
        return ["P", "DIV", "H1", "H2", "H3", "UL", "OL"].includes(node.tagName) ? text.replace(/\n?$/, "\n") : text;
      }
      function renderKey() { return JSON.stringify([input.value, titleInput.value, selectedVehicle()?.full || ""]); }
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
        while (walker.nextNode()) if (/\{\{(?:AUTO|TYTUL)\}\}/.test(walker.currentNode.textContent)) texts.push(walker.currentNode);
        for (const node of texts) {
          const fragment = document.createDocumentFragment();
          for (const part of node.textContent.split(/(\{\{(?:AUTO|TYTUL)\}\})/)) {
            if (part !== marker && part !== titleMarker) { fragment.append(document.createTextNode(part)); continue; }
            const chip = document.createElement("span"); chip.className = "description-token"; chip.contentEditable = "false";
            chip.dataset.descriptionToken = part === titleMarker ? "title" : "vehicle";
            chip.title = part === titleMarker ? "Automatyczny tytul aukcji" : "Pelne dane wybranego auta";
            chip.textContent = part === titleMarker ? titleInput.value.trim().toUpperCase() || "[Tytul aukcji]" : selectedVehicle()?.full || "[Wybierz auto z listy pojazdow]";
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
      button("Pogrubienie", () => { restore(); document.execCommand("bold"); commit(); });
      button("Lista", () => { restore(); document.execCommand("insertUnorderedList"); commit(); });
      function insertToken(kind) {
        const existing = editor.querySelector(`[data-description-token="${kind}"]`);
        if (existing) existing.remove();
        const range = restore(); range.deleteContents(); range.insertNode(document.createTextNode(kind === "title" ? titleMarker : marker));
        commit(); lastRendered = ""; refresh(); editor.focus();
        const chip = editor.querySelector(`[data-description-token="${kind}"]`);
        if (chip) {
          const caret = document.createRange(); caret.setStartAfter(chip); caret.collapse(true);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(caret); remember();
        }
      }
      button("Wstaw tytul tutaj", () => insertToken("title"));
      button("Wstaw dane auta tutaj", () => insertToken("vehicle"));
      async function request(method, body) {
        const token = await window.getWystawiaczToken();
        const result = await fetch("/api/workspace/preferences", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const data = await result.json(); if (!result.ok) throw new Error(data.message); return data;
      }
      button("Zapisz moj szablon", async () => {
        try {
          const text = input.value;
          await request("PUT", { descriptionTemplate: JSON.stringify({ format: "wystawiacz-description-v2", text }) });
          template = text; notify("Zapisano caly uklad opisu na Twoim koncie.");
        } catch (error) { notify(error.message); }
      });
      button("Uzyj mojego szablonu", () => {
        if (input.value && !window.confirm("Zastapic caly opis Twoim szablonem?")) return;
        state.descriptionText = input.value = template; state.descriptionFullLayout = true;
        state.descriptionManuallyEdited = true; state.vehicleDescriptionBlock = null; refresh();
      });
      void request("GET").then(data => {
        if (typeof data.descriptionTemplate !== "string") return;
        try {
          const saved = JSON.parse(data.descriptionTemplate);
          if (saved.format === "wystawiacz-description-v2" && typeof saved.text === "string") { template = saved.text; return; }
        } catch {}
        template = `${titleMarker}\n\n${data.descriptionTemplate}`;
      }).catch(() => {});
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
