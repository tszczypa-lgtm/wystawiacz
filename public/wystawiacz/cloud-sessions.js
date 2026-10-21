(function () {
  window.CloudSessions = {
    mount({ snapshot, restore, status }) {
      let id = crypto.randomUUID(), revision = 0, enabled = false, busy = false, conflict = false, paused = false, previous = "", timer;
      const preferenceKey = "wystawiacz-cloud-autosave";
      try { enabled = localStorage.getItem(preferenceKey) === "true"; } catch {}
      const controls = document.createElement("div");
      controls.className = "cloud-session-controls session-storage-group";
      controls.setAttribute("aria-label", "Na serwer");
      controls.innerHTML = '<strong>Na serwer</strong><small>Sesje na Twoim koncie, bez zdjęć</small><button type="button">Zapisz na koncie</button><button type="button">Otwórz z konta</button><label><input type="checkbox" /> Autozapis (zapamiętany)</label>';
      document.querySelector(".session-file-controls").after(controls);
      const checkbox = controls.querySelector("input");
      checkbox.checked = enabled;
      const buttons = controls.querySelectorAll("button");
      const dialog = document.createElement("dialog");
      dialog.innerHTML = '<h2>Sesje na serwerze</h2><div class="cloud-session-list"></div><button type="button">Zamknij</button>';
      document.body.append(dialog);
      dialog.querySelector("button").onclick = () => dialog.close();
      async function request(path, method = "GET", payload) {
        const token = await window.getWystawiaczToken();
        const response = await fetch(`/api/workspace${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
        const data = await response.json();
        if (response.status === 409) { const error = new Error("Sesja zmienila sie w innej karcie. Otworz najnowsza wersje albo pobierz swoja do pliku; nie nadpisujemy zmian."); error.conflict = true; throw error; }
        if (!response.ok) throw new Error(data.message || "Nie udalo sie zapisac sesji.");
        return data;
      }
      async function save() {
        if (busy || conflict) return;
        const savingId = id;
        busy = true;
        try {
          const payload = snapshot();
          const comparable = JSON.stringify({ ...payload, savedAt: undefined });
          if (revision && comparable === previous) return;
          const result = await request("/session", "PUT", { id, revision, payload });
          if (id !== savingId) return;
          revision = result.revision; previous = comparable;
          status.textContent = `Zapisano na serwerze: ${new Date().toLocaleTimeString("pl-PL")} (wersja ${revision}). Zdjecia pozostaja lokalne.`;
          paused = false;
        } catch (error) {
          if (id !== savingId) return;
          conflict = Boolean(error.conflict); paused = true;
          status.textContent = `Zapis wstrzymany. ${error.message} Ustawienie autozapisu pozostaje zapamietane.${conflict ? "" : " Ponow: Zapisz na koncie."}`;
        }
        finally { busy = false; }
      }
      checkbox.onchange = () => { enabled = checkbox.checked; try { localStorage.setItem(preferenceKey, String(enabled)); } catch {} if (enabled) { paused = false; autosave(); } };
      buttons[0].onclick = () => void save();
      buttons[1].onclick = async () => {
        const list = dialog.querySelector("div");
        list.replaceChildren(); dialog.showModal();
        try {
          const data = await request("/sessions");
          if (!data.sessions.length) list.textContent = "Nie masz jeszcze sesji na serwerze.";
          for (const entry of data.sessions) {
            const row = document.createElement("div");
            const open = document.createElement("button");
            open.textContent = `${entry.name} (${new Date(entry.updated_at).toLocaleString("pl-PL")})`;
            open.onclick = async () => {
              if (busy || !window.confirm("Otworzyc sesje? Niezapisana praca zostanie zastapiona. Mozesz najpierw wyeksportowac JSON.")) return;
              busy = true;
              try {
                const result = await request(`/session?id=${entry.id}`);
                await restore(result.payload);
                id = entry.id; revision = result.revision; conflict = paused = false; previous = comparable(); dialog.close();
              } catch (error) { status.textContent = error.message; }
              finally { busy = false; }
            };
            const versions = document.createElement("button"); versions.textContent = "Poprzednie wersje";
            versions.onclick = async () => {
              try {
                const history = await request(`/versions?id=${entry.id}`);
                row.querySelectorAll(".session-version").forEach(node => node.remove());
                for (const version of history.versions) {
                  const button = document.createElement("button"); button.className = "session-version";
                  button.textContent = `Wersja ${version.revision} - ${new Date(version.created_at).toLocaleString("pl-PL")}`;
                  button.onclick = async () => {
                    if (busy || !window.confirm("Przywrocic starsza wersje jako nowa sesje? Najpierw zapisz obecna prace.")) return;
                    busy = true;
                    try {
                      const old = await request(`/session?id=${entry.id}&revision=${version.revision}`);
                      await restore(old.payload); id = crypto.randomUUID(); revision = 0; conflict = paused = false; previous = ""; dialog.close();
                    } catch (error) { status.textContent = error.message; }
                    finally { busy = false; }
                  };
                  row.append(button);
                }
              } catch (error) { status.textContent = error.message; }
            };
            row.append(open, versions); list.append(row);
          }
        } catch (error) { list.textContent = error.message; }
      };
      function comparable() { return JSON.stringify({ ...snapshot(), savedAt: undefined }); }
      // Establish the initial blank form after the app finishes mounting; do not create empty sessions on every visit.
      setTimeout(() => { if (!revision && !busy) previous = comparable(); }, 0);
      function autosave() { if (enabled && !paused && comparable() !== previous) void save(); }
      document.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(autosave, 2000); });
      setInterval(() => { if (!document.hidden) autosave(); }, 15000);
      document.addEventListener("visibilitychange", () => { if (document.hidden) autosave(); });
      window.addEventListener("beforeunload", event => {
        if (enabled && (busy || JSON.stringify({ ...snapshot(), savedAt: undefined }) !== previous)) { event.preventDefault(); event.returnValue = ""; }
      });
      return { newSession() { id = crypto.randomUUID(); revision = 0; conflict = paused = false; previous = ""; }, save };
    }
  };
})();
