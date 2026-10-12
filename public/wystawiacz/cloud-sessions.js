(function () {
  window.CloudSessions = {
    mount({ snapshot, restore, status }) {
      let id = crypto.randomUUID(), revision = 0, enabled = false, busy = false, conflict = false, previous = "";
      const controls = document.createElement("details");
      controls.className = "cloud-session-controls";
      controls.innerHTML = '<summary>Serwer</summary><div><label><input type="checkbox" /> Autozapis na serwerze</label><button type="button">Zapisz na serwerze</button><button type="button">Sesje na serwerze</button></div>';
      document.querySelector(".session-actions").append(controls);
      const checkbox = controls.querySelector("input");
      const buttons = controls.querySelectorAll("button");
      const dialog = document.createElement("dialog");
      dialog.innerHTML = '<h2>Sesje na serwerze</h2><div class="cloud-session-list"></div><button type="button">Zamknij</button>';
      document.body.append(dialog);
      dialog.querySelector("button").onclick = () => dialog.close();
      async function request(path, method = "GET", payload) {
        const token = await window.getWystawiaczToken();
        const response = await fetch(`/api/workspace${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
        const data = await response.json();
        if (response.status === 409) { conflict = true; enabled = false; checkbox.checked = false; throw new Error("Sesja zmienila sie w innej karcie. Otworz najnowsza wersje albo wyeksportuj swoja do JSON; nie nadpisujemy zmian."); }
        if (!response.ok) throw new Error(data.message || "Nie udalo sie zapisac sesji.");
        return data;
      }
      async function save() {
        if (busy || conflict) return;
        busy = true;
        try {
          const payload = snapshot();
          const comparable = JSON.stringify({ ...payload, savedAt: undefined });
          if (revision && comparable === previous) return;
          const result = await request("/session", "PUT", { id, revision, payload });
          revision = result.revision; previous = comparable;
          status.textContent = `Zapisano na serwerze: ${new Date().toLocaleTimeString("pl-PL")} (wersja ${revision}). Zdjecia pozostaja lokalne.`;
        } catch (error) { enabled = false; checkbox.checked = false; status.textContent = error.message; }
        finally { busy = false; }
      }
      checkbox.onchange = () => { enabled = checkbox.checked; if (enabled) void save(); };
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
              try {
                const result = await request(`/session?id=${entry.id}`);
                await restore(result.payload);
                id = entry.id; revision = result.revision; conflict = false; previous = ""; dialog.close();
              } catch (error) { status.textContent = error.message; }
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
                    try {
                      const old = await request(`/session?id=${entry.id}&revision=${version.revision}`);
                      await restore(old.payload); id = crypto.randomUUID(); revision = 0; conflict = false; previous = ""; dialog.close();
                    } catch (error) { status.textContent = error.message; }
                  };
                  row.append(button);
                }
              } catch (error) { status.textContent = error.message; }
            };
            row.append(open, versions); list.append(row);
          }
        } catch (error) { list.textContent = error.message; }
      };
      setInterval(() => { if (enabled && !document.hidden) void save(); }, 15000);
      document.addEventListener("visibilitychange", () => { if (enabled && document.hidden) void save(); });
      window.addEventListener("beforeunload", event => {
        if (enabled && (busy || JSON.stringify({ ...snapshot(), savedAt: undefined }) !== previous)) { event.preventDefault(); event.returnValue = ""; }
      });
      return { newSession() { id = crypto.randomUUID(); revision = 0; conflict = false; previous = ""; }, save };
    }
  };
})();
