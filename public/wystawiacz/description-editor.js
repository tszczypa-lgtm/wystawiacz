(function () {
  const marker = "{{AUTO}}";
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
  window.DescriptionEditor = {
    paragraphs,
    mount({ state, input, vehicleInput, selectedVehicle, notify }) {
      let template = "Część używana 100% sprawna\n\n{{AUTO}}";
      function toolbar(editor) {
        const bar = document.createElement("div"); bar.className = "description-toolbar";
        for (const label of ["Pogrubienie", "Lista"]) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = label;
          button.onclick = () => {
            const start = editor.selectionStart, end = editor.selectionEnd;
            const selection = editor.value.slice(start, end) || "tekst";
            editor.setRangeText(label === "Lista" ? selection.split("\n").map(line => `- ${line}`).join("\n") : `**${selection}**`, start, end, "select");
            editor.dispatchEvent(new Event("input", { bubbles: true })); editor.focus();
          };
          bar.append(button);
        }
        editor.before(bar); return bar;
      }
      toolbar(vehicleInput);
      const bar = toolbar(input);
      const preview = document.createElement("div"); preview.className = "formatted-description"; input.after(preview);
      function refresh() { preview.innerHTML = paragraphs(input.value, value => { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }); }
      input.addEventListener("input", () => {
        const block = state.vehicleDescriptionBlock;
        if (block) {
          const start = input.value.indexOf(block.text);
          state.vehicleDescriptionBlock = start < 0 || input.value.indexOf(block.text, start + block.text.length) >= 0 ? null : { start, end: start + block.text.length, text: block.text };
        }
        refresh();
      });
      const insert = document.createElement("button"); insert.type = "button"; insert.textContent = "Wstaw dane auta tutaj";
      function vehicleText(vehicle) { return vehicle?.full || "[Wybierz auto z listy pomocniczej]"; }
      function replaceVehicle(vehicle) {
        const block = state.vehicleDescriptionBlock;
        if (!block || state.descriptionText.slice(block.start, block.end) !== block.text) return false;
        const text = vehicleText(vehicle);
        state.descriptionText = state.descriptionText.slice(0, block.start) + text + state.descriptionText.slice(block.end);
        state.vehicleDescriptionBlock = { start: block.start, end: block.start + text.length, text };
        input.value = state.descriptionText; state.descriptionManuallyEdited = true; refresh(); return true;
      }
      insert.onclick = () => {
        if (state.vehicleDescriptionBlock) { notify("Blok auta jest juz w opisie. Usun go przed wstawieniem w inne miejsce."); return; }
        const start = input.selectionStart, end = input.selectionEnd, text = vehicleText(selectedVehicle());
        input.setRangeText(text, start, end, "end");
        state.descriptionText = input.value; state.descriptionManuallyEdited = true;
        state.vehicleDescriptionBlock = { start, end: start + text.length, text }; refresh(); input.focus();
      };
      const save = document.createElement("button"); save.type = "button"; save.textContent = "Zapisz moj szablon";
      const use = document.createElement("button"); use.type = "button"; use.textContent = "Uzyj mojego szablonu";
      async function request(method, body) {
        const token = await window.getWystawiaczToken();
        const result = await fetch("/api/workspace/preferences", { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const data = await result.json(); if (!result.ok) throw new Error(data.message); return data;
      }
      save.onclick = async () => {
        try {
          const block = state.vehicleDescriptionBlock;
          template = block ? input.value.slice(0, block.start) + marker + input.value.slice(block.end) : input.value;
          await request("PUT", { descriptionTemplate: template }); notify("Zapisano szablon na Twoim koncie.");
        } catch (error) { notify(error.message); }
      };
      use.onclick = () => {
        if (input.value && !window.confirm("Zastapic opis Twoim szablonem?")) return;
        const start = template.indexOf(marker), text = vehicleText(selectedVehicle());
        input.value = template.replace(marker, text);
        state.descriptionText = input.value; state.descriptionManuallyEdited = true;
        state.vehicleDescriptionBlock = start < 0 ? null : { start, end: start + text.length, text }; refresh();
      };
      bar.append(insert, save, use);
      void request("GET").then(data => { if (typeof data.descriptionTemplate === "string") template = data.descriptionTemplate; }).catch(() => {});
      function automatic(vehicle) {
        const start = template.indexOf(marker), text = vehicle?.full || "";
        state.descriptionText = template.replace(marker, text);
        state.vehicleDescriptionBlock = start < 0 ? null : { start, end: start + text.length, text };
      }
      return { replaceVehicle, refresh, automatic };
    }
  };
})();
