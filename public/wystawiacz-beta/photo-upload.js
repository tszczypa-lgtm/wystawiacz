(function () {
  const cache = new WeakMap();
  let queue = Promise.resolve();
  function needsConversion(file) { return file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(heic|heif)$/i.test(file.name || ""); }
  async function jpeg(file) {
    const image = new Image(), url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Przegladarka nie potrafi przekonwertowac tego zdjecia. Wyeksportuj je z iPhone jako JPEG.")); image.src = url; });
      const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Nie udalo sie przygotowac JPEG.");
      return blob;
    } finally { URL.revokeObjectURL(url); }
  }
  async function prepare(file, force = false) {
    if (cache.has(file)) return cache.get(file);
    if (!force && !needsConversion(file)) return file;
    const work = queue.then(() => jpeg(file));
    queue = work.catch(() => {});
    cache.set(file, work.catch(error => { cache.delete(file); throw error; }));
    return cache.get(file);
  }
  window.PhotoUpload = { prepare, needsConversion };
})();
