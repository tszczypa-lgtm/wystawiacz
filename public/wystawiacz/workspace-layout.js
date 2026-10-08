(() => {
  const dialog = document.getElementById("vehiclesDialog");
  const open = document.getElementById("openVehiclesButton");
  open.addEventListener("click", () => dialog.showModal());
  document.getElementById("closeVehiclesButton").addEventListener("click", () => dialog.close());
  document.getElementById("cancelVehicleEditButton").addEventListener("click", () => resetVehicleEditor());
  dialog.addEventListener("close", () => open.focus());
})();
