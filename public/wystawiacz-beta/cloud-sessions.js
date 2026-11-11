window.CloudSessions = {
  mount({ snapshot, restore, status }) {
    window.BetaSession = { snapshot, restore, status };
    const note = document.createElement("p"); note.className = "beta-storage-note";
    note.textContent = "BETA: osobny autozapis na tym komputerze (wraz ze zdjeciami i nagraniami). Stabilne sesje na serwerze nie sa uzywane. Eksport JSON nie zawiera plikow audio ani zdjec.";
    document.querySelector(".session-file-controls").after(note);
    return { newSession() {}, save() { return window.BetaWorkflow?.save(); } };
  }
};
