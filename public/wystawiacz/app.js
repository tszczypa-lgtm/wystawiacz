const state = {
  selectedPhotos: [],
  photoRotations: new Map(),
  localPhotosByName: new Map(),
  selectedPhotoNames: [],
  products: [],
  allegroConnected: false,
  categoryId: "",
  appendedPartNumber: "",
  shippingRates: [],
  afterSalesServices: {
    returnPolicies: [],
    impliedWarranties: [],
    warranties: []
  },
  compliance: {
    responsibleProducers: [],
    responsiblePersons: []
  },
  requiredParameters: [],
  parameterValues: {},
  vehicles: [],
  selectedVehicleId: "",
  descriptionText: "",
  descriptionManuallyEdited: false
};

const photoGrid = document.querySelector("#photoGrid");
const photoCounter = document.querySelector("#photoCounter");
const folderSummary = document.querySelector("#folderSummary");
const folderDetails = document.querySelector("#folderDetails");
const clearSelectionButton = document.querySelector("#clearSelectionButton");
const photoBrowser = document.querySelector("#photoBrowser");
const photoBrowserEmpty = document.querySelector("#photoBrowserEmpty");
const photoPreviewWrap = document.querySelector(".photo-preview");
const photoPreview = document.querySelector("#photoPreview");
const photoPreviewName = document.querySelector("#photoPreviewName");
const mainPhotoStatus = document.querySelector("#mainPhotoStatus");
const previousPhotoButton = document.querySelector("#previousPhotoButton");
const togglePhotoButton = document.querySelector("#togglePhotoButton");
const mainPhotoButton = document.querySelector("#mainPhotoButton");
const nextPhotoButton = document.querySelector("#nextPhotoButton");
const rotatePhotoLeftButton = document.querySelector("#rotatePhotoLeftButton");
const rotatePhotoRightButton = document.querySelector("#rotatePhotoRightButton");
const relinkFolderInput = document.querySelector("#relinkFolderInput");
const sessionNameInput = document.querySelector("#sessionNameInput");
const sessionStatus = document.querySelector("#sessionStatus");
const saveSessionButton = document.querySelector("#saveSessionButton");
const loadSessionInput = document.querySelector("#loadSessionInput");
const vehicleManufacturerInput = document.querySelector("#vehicleManufacturerInput");
const vehicleManufacturerOptions = document.querySelector("#vehicleManufacturerOptions");
const vehicleShortInput = document.querySelector("#vehicleShortInput");
const vehicleFullInput = document.querySelector("#vehicleFullInput");
const addVehicleButton = document.querySelector("#addVehicleButton");
const vehicleList = document.querySelector("#vehicleList");
const vehicleButtons = document.querySelector("#vehicleButtons");
const partNumber = document.querySelector("#partNumber");
const partNumberHint = document.querySelector("#partNumberHint");
const suggestionPanel = document.querySelector("#suggestionPanel");
const titleInput = document.querySelector("#titleInput");
const summaryCard = document.querySelector("#summaryCard");
const summaryTitle = document.querySelector("#summaryTitle");
const categoryInput = document.querySelector("#categoryInput");
const categorySearchInput = document.querySelector("#categorySearchInput");
const categorySearchButton = document.querySelector("#categorySearchButton");
const browseCategoriesButton = document.querySelector("#browseCategoriesButton");
const categoryBrowser = document.querySelector("#categoryBrowser");
const categoryBackButton = document.querySelector("#categoryBackButton");
const categoryBrowserList = document.querySelector("#categoryBrowserList");
const categoryStatus = document.querySelector("#categoryStatus");
const priceInput = document.querySelector("#priceInput");
const stockInput = document.querySelector("#stockInput");
const shippingRateInput = document.querySelector("#shippingRateInput");
const returnPolicyInput = document.querySelector("#returnPolicyInput");
const impliedWarrantyInput = document.querySelector("#impliedWarrantyInput");
const warrantyInput = document.querySelector("#warrantyInput");
const addButton = document.querySelector("#addButton");
const previousProductButton = document.querySelector("#previousProductButton");
const nextProductButton = document.querySelector("#nextProductButton");
const activeProductLabel = document.querySelector("#activeProductLabel");
const parametersPanel = document.querySelector("#parametersPanel");
const parametersGrid = document.querySelector("#parametersGrid");
const parametersStatus = document.querySelector("#parametersStatus");
const descriptionPreviewImage = document.querySelector("#descriptionPreviewImage");
const descriptionMissingImage = document.querySelector("#descriptionMissingImage");
const descriptionPreviewTitle = document.querySelector("#descriptionPreviewTitle");
const descriptionPreviewText = document.querySelector("#descriptionPreviewText");
const descriptionTextInput = document.querySelector("#descriptionTextInput");
const searchAllegroPartButton = document.querySelector("#searchAllegroPartButton");
const searchAllegroTitleButton = document.querySelector("#searchAllegroTitleButton");
const productList = document.querySelector("#productList");
const emptyState = document.querySelector("#emptyState");
const toast = document.querySelector("#toast");
const locationSettingsButton = document.querySelector("#locationSettingsButton");
const locationModal = document.querySelector("#locationModal");
const closeLocationModalButton = document.querySelector("#closeLocationModalButton");
const saveLocationButton = document.querySelector("#saveLocationButton");
const locationCityInput = document.querySelector("#locationCityInput");
const locationPostCodeInput = document.querySelector("#locationPostCodeInput");
const locationProvinceInput = document.querySelector("#locationProvinceInput");
const connectButton = document.querySelector("#connectButton");
const disconnectButton = document.querySelector("#disconnectButton");
const connectionTitle = document.querySelector("#connectionTitle");
const connectionDescription = document.querySelector("#connectionDescription");
const compatibleServerBuilds = ["2026-06-02.35"];
let allegroLoginWindow;
let allegroLoginTimer;
let categoryLookupTimer;
let categoryParents = [];
let activeProductId = "";
let previewPhotoName = "";
let categoryLocked = false;
let allegroManufacturerOptions = [];

const titleEditor = window.TitleEditor.mount();
const titleSuggestions = window.TitleSuggestions.mount({
  getContext: () => ({ number: partNumber.value.trim(), productId: activeProductId }),
  search: (number, signal) => apiRequest(`/api/title-suggestions?number=${encodeURIComponent(number)}`, { signal }),
  choose: (title, mode) => {
    if (mode === "part") {
      state.selectedVehicleId = "";
      state.descriptionManuallyEdited = false;
      renderVehicleButtons();
    }
    titleInput.value = title;
    state.appendedPartNumber = "";
    appendPartNumberToTitle();
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    detectProductDetails();
  },
  append: name => {
    const vehicle = getSelectedVehicle();
    let base = getTitleWithoutPartNumber();
    if (vehicle?.short) base = base.replace(new RegExp(`\\s*${escapeRegExp(vehicle.short)}\\s*$`, "i"), "").trim();
    const alreadyPresent = new RegExp(`(?:^|\\s|\\+)${escapeRegExp(name)}(?=$|\\s|\\+)`, "i").test(base);
    if (!alreadyPresent) base = [base, name].filter(Boolean).join(" + ");
    titleInput.value = [base, vehicle?.short].filter(Boolean).join(" ");
    state.appendedPartNumber = "";
    appendPartNumberToTitle();
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    detectProductDetails();
  }
});

const OE_MANUFACTURERS = [
  "Abarth", "AC", "Acura", "Aiways", "Aixam", "Alfa Romeo", "Alpine", "Aro", "Asia", "Aston Martin", "Audi", "Austin",
  "Austin-Healey", "Autobianchi", "Avia", "Baic", "Bentley", "Bertone", "BMW", "Borgward", "Brilliance", "Bugatti",
  "Buick", "BYD", "Cadillac", "Casalini", "Caterham", "Chatenet", "Chery", "Chevrolet", "Chrysler", "Citroen",
  "Cupra", "Dacia", "Daewoo", "Daihatsu", "Datsun", "De Tomaso", "DFSK", "Dodge", "DR", "DS", "Eagle", "Ferrari",
  "Fiat", "Fisker", "Ford", "FSO", "Galloper", "GAZ", "Geely", "Genesis", "GMC", "Great Wall", "Honda", "Hongqi",
  "Hummer", "Hyundai", "Infiniti", "Innocenti", "Isuzu", "Iveco", "JAC", "Jaguar", "Jeep", "Jetour", "Kia", "Lada",
  "Lamborghini", "Lancia", "Land Rover", "LDV", "Leapmotor", "Lexus", "Ligier", "Lincoln", "Lotus", "Lucid",
  "Mahindra", "MAN", "Maserati", "Maybach", "Mazda", "McLaren", "Mercedes-Benz", "Mercury", "MG", "Microcar",
  "Mini", "Mitsubishi", "Morgan", "Moskwicz", "NIO", "Nissan", "Oldsmobile", "Omoda", "Opel", "Peugeot",
  "Piaggio", "Plymouth", "Polestar", "Pontiac", "Porsche", "Proton", "RAM", "Renault", "Rolls-Royce", "Rover",
  "Saab", "Samsung", "Santana", "Saturn", "Scion", "Seat", "Seres", "Shuanghuan", "Skoda", "Skywell", "Smart",
  "SsangYong", "Subaru", "Suzuki", "Syrena", "Tarpan", "Tata", "Tavria", "Tesla", "Toyota", "Trabant", "Triumph",
  "UAZ", "Vauxhall", "Volkswagen", "Volvo", "Warszawa", "Wartburg", "Wiesmann", "Xpeng", "Yugo", "Zastava", "ZAZ",
  "Zeekr",
  "Alpina", "Artega", "BAW", "Belgee", "Bizzarrini", "Bristol", "Cenntro", "ChangAn", "Changhe", "Denza", "Donkervoort",
  "Exeed", "Forthing", "GAC", "Gonow", "Haval", "Hozon", "IM Motors", "Jaecoo", "Karma", "Koenigsegg", "Lifan",
  "Lynk & Co", "Maxus", "Mitsuoka", "Ora", "Pagani", "Perodua", "Qoros", "Ravon", "Rimac", "Roewe", "Saipa",
  "Saleen", "Soueast", "Spyker", "Togg", "VinFast", "Voyah", "Wuling", "Zhidou", "Zotye",
  "DAF", "FUSO", "International", "Kamaz", "Kenworth", "Multicar", "Neoplan", "Scania", "Setra", "Solaris", "Tatra",
  "Temsa", "Van Hool", "Volvo Trucks", "Western Star"
];

renderManufacturerOptions();
checkConnectionStatus();
renderVehicles();

connectButton.addEventListener("click", async () => {
  if (allegroLoginWindow && !allegroLoginWindow.closed) { allegroLoginWindow.focus(); return; }
  // Keep the original workspace and selected File objects alive during OAuth.
  allegroLoginWindow = window.open("about:blank", "wystawiacz-allegro", "width=720,height=800");
  if (!allegroLoginWindow) { showToast("Zezwól na otwarcie okna Allegro i kliknij ponownie Połącz z Allegro."); return; }
  connectButton.disabled = true;
  try {
    const result = await apiRequest("/api/auth/start", { method: "POST" });
    const target = new URL(result.url);
    if (target.origin !== "https://allegro.pl" || target.pathname !== "/auth/oauth/authorize") throw new Error("Nieprawidłowy adres logowania Allegro.");
    allegroLoginWindow.location.replace(target.href);
    allegroLoginTimer = setInterval(() => {
      if (allegroLoginWindow?.closed) {
        clearInterval(allegroLoginTimer);
        connectButton.disabled = state.allegroConnected;
        void checkConnectionStatus();
      }
    }, 1000);
  } catch (error) {
    allegroLoginWindow.close();
    connectButton.disabled = false;
    showToast(error.message);
  }
});

window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.source !== allegroLoginWindow || event.data?.type !== "wystawiacz-allegro-complete") return;
  clearInterval(allegroLoginTimer);
  connectButton.disabled = state.allegroConnected;
  if (event.data.ok) {
    void checkConnectionStatus();
    showToast("Konto Allegro połączone.");
  } else showToast("Połączenie anulowane lub nieudane. Możesz spróbować ponownie.");
});

disconnectButton.addEventListener("click", async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch (error) { showToast(error.message); return; }
  state.allegroConnected = false;
  connectButton.textContent = "Połącz z Allegro";
  connectButton.disabled = false;
  disconnectButton.classList.add("hidden");
  connectionTitle.textContent = "Konto nie jest jeszcze połączone";
  connectionDescription.textContent = "Połącz właściwe konto Allegro. Po zmianie konta pobierzemy jego kategorie, wysyłkę oraz szablony.";
  showToast("Konto odłączone. Możesz połączyć inne Allegro.");
});

async function apiRequest(path, options = {}) {
  const token = await window.getWystawiaczToken();
  let response;
  try { response = await fetch(path.replace(/^\/api\//, "/api/allegro/"), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` }
  }); } catch { throw new Error("Przerwane polaczenie z Wystawiaczem (brak odpowiedzi HTTP). Sprawdz internet."); }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok || !payload || typeof payload !== "object") {
    const cloudflareCode = raw.match(/(?:error\s*(?:code)?\s*[:=]?\s*|\b)(1101|1102|1027)\b/i)?.[1];
    const reason = cloudflareCode === "1102" ? "Cloudflare przerwal prace serwera: limit zasobow (1102)."
      : cloudflareCode === "1027" ? "Wyczerpany dzienny limit serwera Cloudflare (1027)."
      : cloudflareCode === "1101" ? "Blad wykonania serwera Cloudflare (1101)."
      : "Serwer Wystawiacza zwrocil nieprawidlowa odpowiedz.";
    const ray = response.headers.get("CF-Ray");
    const reference = ray && /^[a-z0-9-]{1,80}$/i.test(ray) ? ` ID: ${ray}.` : "";
    throw new Error(`${typeof payload?.message === "string" ? payload.message : reason} [HTTP ${response.status}]${reference}`);
  }
  return payload;
}

clearSelectionButton.addEventListener("click", () => {
  state.selectedPhotos = [];
  state.selectedPhotoNames = [];
  renderPhotos();
});

relinkFolderInput.addEventListener("change", async () => {
  [...relinkFolderInput.files]
    .filter((file) => file.type.startsWith("image/"))
    .forEach((file) => {
      const previous = state.localPhotosByName.get(file.name);
      if (previous?.url) URL.revokeObjectURL(previous.url);
      state.localPhotosByName.set(file.name, { file, name: file.name, url: URL.createObjectURL(file) });
    });
  const folder = [...relinkFolderInput.files][0]?.webkitRelativePath?.split("/")[0] || "wybrany folder";
  localStorage.setItem("allegroAssistantPhotoFolder", folder);
  sessionStatus.textContent = `Lokalny folder zdjęć: ${folder}. Dopasowano pliki po nazwach.`;
  previewPhotoName = state.localPhotosByName.keys().next().value || "";
  await restorePhotoRotations();
  renderPhotos();
  renderProducts();
});

saveSessionButton.addEventListener("click", saveSession);
loadSessionInput.addEventListener("change", loadSession);
addVehicleButton.addEventListener("click", addVehicle);
descriptionTextInput.addEventListener("input", () => {
  state.descriptionText = descriptionTextInput.value;
  state.descriptionManuallyEdited = true;
  renderDescriptionPreview();
});
searchAllegroPartButton.addEventListener("click", () => openSearch("https://allegro.pl/listing?string=", partNumber.value.trim()));
searchAllegroTitleButton.addEventListener("click", () => openSearch("https://allegro.pl/listing?string=", getTitleWithoutPartNumber()));

locationSettingsButton.addEventListener("click", () => {
  fillLocationModal();
  locationModal.classList.remove("hidden");
});

closeLocationModalButton.addEventListener("click", () => locationModal.classList.add("hidden"));

saveLocationButton.addEventListener("click", () => {
  const city = locationCityInput.value.trim();
  const postCode = locationPostCodeInput.value.trim();
  const province = normalizeProvince(locationProvinceInput.value);
  if (!city || !postCode || !province) {
    showToast("Uzupełnij miasto, kod pocztowy i województwo.");
    return;
  }
  savePublishLocation({ countryCode: "PL", city, postCode, province });
  locationModal.classList.add("hidden");
  showToast("Lokalizacja zapisana. Wystawianie nie będzie już o nią pytać.");
});
previousPhotoButton.addEventListener("click", () => navigatePhoto(-1));
nextPhotoButton.addEventListener("click", () => navigatePhoto(1));
togglePhotoButton.addEventListener("click", () => togglePhoto(previewPhotoName));
mainPhotoButton.addEventListener("click", setPreviewAsMainPhoto);
rotatePhotoLeftButton.addEventListener("click", () => rotatePreviewPhoto(-1));
rotatePhotoRightButton.addEventListener("click", () => rotatePreviewPhoto(1));
photoPreviewWrap.addEventListener("mousemove", (event) => {
  if (!photoPreview.src) return;
  const rect = photoPreviewWrap.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
  const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
  photoPreviewWrap.style.setProperty("--zoom-x", `${x}%`);
  photoPreviewWrap.style.setProperty("--zoom-y", `${y}%`);
  photoPreviewWrap.classList.add("zooming");
});
photoPreviewWrap.addEventListener("mouseleave", () => {
  photoPreviewWrap.classList.remove("zooming");
});
previousProductButton.addEventListener("click", () => navigateProduct(-1));
nextProductButton.addEventListener("click", () => navigateProduct(1));

titleInput.addEventListener("input", () => {
  updatePartNumberHint();
  updateSummary();
  summaryCard.classList.toggle("hidden", !titleInput.value.trim());
  suggestionPanel.classList.toggle("hidden", !titleInput.value.trim());
  scheduleAllegroCategoryLookup();
});
titleInput.addEventListener("blur", appendPartNumberToTitle);
partNumber.addEventListener("input", () => {
  appendPartNumberToTitle();
  detectProductDetails();
  updatePartNumberHint();
});

function updatePartNumberHint() {
  partNumberHint.textContent = partNumber.value.trim() && !titleInput.value.trim()
    ? "Numer wpisany. Teraz wpisz nazwę części w tytule (np. Przełącznik szyb). Numer dopiszemy automatycznie; sam numer nie rozpoznaje produktu."
    : "Numer dopiszemy do tytułu. Sam numer nie rozpoznaje nazwy części ani zdjęć.";
}

categorySearchButton.addEventListener("click", () => {
  categoryLocked = false;
  loadAllegroCategory(categorySearchInput.value.trim() || titleInput.value.trim());
});

categorySearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    categoryLocked = false;
    loadAllegroCategory(categorySearchInput.value.trim());
  }
});

browseCategoriesButton.addEventListener("click", () => {
  categoryBrowser.classList.toggle("hidden");
  if (!categoryBrowser.classList.contains("hidden")) {
    categoryParents = [];
    loadCategoryLevel();
  }
});

categoryBackButton.addEventListener("click", () => {
  categoryParents.pop();
  loadCategoryLevel(categoryParents.at(-1));
});

categoryInput.addEventListener("change", () => {
  const selected = categoryInput.options[categoryInput.selectedIndex];
  state.categoryId = categoryInput.value;
  categoryStatus.textContent = state.categoryId
    ? `Wybrana kategoria Allegro · ID: ${state.categoryId}`
    : "Wybierz kategorię z listy";
  if (selected?.dataset.source === "local") state.categoryId = "";
  if (state.categoryId) {
    categoryLocked = true;
    loadCategoryDetails(state.categoryId);
  }
});

addButton.addEventListener("click", () => {
  titleEditor.refresh();
  const title = titleInput.value.trim();
  const price = priceInput.value.trim();
  const stock = Number(stockInput.value);

  if (!title || stock < 1) {
    showToast("Uzupełnij tytuł i liczbę sztuk. Cenę można dopisać później.");
    return;
  }
  if (window.TitleEditor.length(title) > 75) {
    showToast(window.TitleEditor.error(title));
    return;
  }

  const product = {
    id: crypto.randomUUID(),
    title,
    enteredPartNumber: partNumber.value.trim(),
    allegroPartNumber: title,
    brand: getPreferredManufacturer(),
    category: categoryInput.options[categoryInput.selectedIndex]?.textContent || "",
    categoryId: state.categoryId,
    categoryPath: categoryInput.options[categoryInput.selectedIndex]?.textContent || "",
    parameterValues: { ...state.parameterValues },
    price,
    stock,
    shippingRateId: shippingRateInput.value,
    shippingRateName: shippingRateInput.options[shippingRateInput.selectedIndex]?.textContent || "",
    returnPolicyId: returnPolicyInput.value,
    returnPolicyName: returnPolicyInput.options[returnPolicyInput.selectedIndex]?.textContent || "",
    impliedWarrantyId: impliedWarrantyInput.value,
    impliedWarrantyName: impliedWarrantyInput.options[impliedWarrantyInput.selectedIndex]?.textContent || "",
    warrantyId: warrantyInput.value,
    warrantyName: warrantyInput.options[warrantyInput.selectedIndex]?.textContent || "",
    photoNames: [...state.selectedPhotoNames],
    image: findPhotoUrl(state.selectedPhotoNames[0]),
    description: buildDescriptionModel(),
    descriptionText: state.descriptionText,
    selectedVehicleId: state.selectedVehicleId
  };

  if (activeProductId) {
    const existingIndex = state.products.findIndex((item) => item.id === activeProductId);
    product.id = activeProductId;
    state.products[existingIndex] = product;
    showToast("Zapisano zmiany aukcji.");
  } else {
    state.products.push(product);
    showToast("Produkt dodany do listy.");
  }

  resetForm();
  renderProducts();
});

function renderPhotos() {
  titleSuggestions.refresh();
  const selectedCount = state.selectedPhotoNames.length;
  photoCounter.textContent = `${selectedCount} ${selectedCount === 1 ? "zdjęcie" : "zdjęć"}`;
  const folderPhotos = [...state.localPhotosByName.values()];
  photoBrowser.classList.toggle("hidden", folderPhotos.length === 0);
  photoBrowserEmpty.classList.toggle("hidden", folderPhotos.length > 0);
  folderSummary.classList.toggle("hidden", selectedCount === 0);
  folderDetails.textContent = `${selectedCount} plików dodanych do produktu`;
  if (!previewPhotoName && folderPhotos.length) previewPhotoName = folderPhotos[0].name;
  const preview = state.localPhotosByName.get(previewPhotoName) || folderPhotos[0];
  photoPreview.src = preview?.url || "";
  photoPreviewName.textContent = preview?.name || "";
  rotatePhotoLeftButton.disabled = !preview || Boolean(preview.rotating);
  rotatePhotoRightButton.disabled = !preview || Boolean(preview.rotating);
  mainPhotoStatus.textContent = preview?.name && state.selectedPhotoNames[0] === preview.name ? "ZDJĘCIE GŁÓWNE" : "";
  togglePhotoButton.disabled = !preview;
  mainPhotoButton.disabled = !preview || !state.selectedPhotoNames.includes(preview?.name) || state.selectedPhotoNames[0] === preview?.name;
  togglePhotoButton.textContent = state.selectedPhotoNames.includes(preview?.name)
    ? "Odznacz zdjęcie"
    : "Zaznacz zdjęcie";
  previousPhotoButton.disabled = folderPhotos.length < 2;
  nextPhotoButton.disabled = folderPhotos.length < 2;
  photoGrid.innerHTML = folderPhotos
    .map(({ name, url }) => `
      <button class="photo-choice ${state.selectedPhotoNames.includes(name) ? "selected" : ""} ${state.selectedPhotoNames[0] === name ? "main-photo" : ""}" type="button" data-photo-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
        <img class="photo-thumb" src="${url}" alt="${escapeHtml(name)}" />
      </button>
    `)
    .join("");
  photoGrid.querySelectorAll(".photo-choice").forEach((button) => {
    button.addEventListener("click", () => togglePhoto(button.dataset.photoName));
  });
  renderDescriptionPreview();
}

function updateSummary() {
  titleEditor.refresh();
  summaryTitle.textContent = titleInput.value.trim() || "Brak tytułu";
  renderDescriptionPreview();
  detectProductDetails();
  if (state.requiredParameters.length) {
    applyAutomaticParameterValues();
    syncRenderedParameterValues();
  }
}

function renderProducts() {
  emptyState.classList.toggle("hidden", state.products.length > 0);
  productList.innerHTML = state.products
    .map((product) => `
      <article class="product-card ${product.id === activeProductId ? "active" : ""}" data-product-id="${escapeHtml(product.id)}">
        ${findPhotoUrl(product.photoNames?.[0]) || product.image
          ? `<img class="product-image" src="${findPhotoUrl(product.photoNames?.[0]) || product.image}" alt="" />`
          : `<div class="product-image"></div>`}
        <div>
          <h3>${escapeHtml(product.title)}</h3>
          <p>${escapeHtml(product.brand || "Marka do uzupełnienia")} · Numer wpisany: ${escapeHtml(product.enteredPartNumber)} · ${product.stock} szt. · ${product.photoNames?.length || 0} zdjęć</p>
          <p>Wysyłka: ${escapeHtml(product.shippingRateName || "profil do wybrania")}</p>
          <p>Zwrot: ${escapeHtml(product.returnPolicyName || "brak")} · Reklamacja: ${escapeHtml(product.impliedWarrantyName || "brak")}</p>
          ${product.publishError ? `<p class="publish-error">Błąd Allegro: ${escapeHtml(product.publishError)}</p>` : ""}
        </div>
        <div class="product-price">
          <label>
            <input class="product-price-input" type="number" min="0" step="0.01" value="${escapeHtml(product.price)}" data-product-id="${escapeHtml(product.id)}" aria-label="Cena produktu" />
          </label>
          <span>${escapeHtml(product.publishStatus || (product.allegroOfferId ? "WYSTAWIONO" : "GOTOWE"))}</span>
        </div>
        <button class="publish-button" type="button" data-publish-product-id="${escapeHtml(product.id)}" ${product.allegroOfferId ? "disabled" : ""}>
          ${product.allegroOfferId ? "Wystawiona" : "Wystaw"}
        </button>
        <button class="edit-button" type="button" data-product-id="${escapeHtml(product.id)}">Edytuj</button>
      </article>
    `)
    .join("");
  productList.querySelectorAll(".publish-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      publishProduct(button.dataset.publishProductId);
    });
  });
  productList.querySelectorAll(".edit-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editProduct(button.dataset.productId);
    });
  });
  productList.querySelectorAll(".product-price-input").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const product = state.products.find((item) => item.id === input.dataset.productId);
      if (!product) return;
      product.price = input.value;
      showToast("Cena zapisana w sesji.");
    });
  });
  productList.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", () => editProduct(card.dataset.productId));
  });
  updateProductNavigation();
}

function resetForm() {
  state.selectedPhotos = [];
  state.selectedPhotoNames = [];
  partNumber.value = "";
  titleInput.value = "";
  titleEditor.refresh();
  categoryInput.innerHTML = '<option value="">Wykryjemy z tytułu</option>';
  categorySearchInput.value = "";
  categoryStatus.textContent = state.allegroConnected ? "Wpisz tytuł, aby pobrać kategorię z Allegro" : "Lokalna podpowiedź";
  state.categoryId = "";
  state.requiredParameters = [];
  state.parameterValues = {};
  parametersPanel.classList.add("hidden");
  parametersStatus.textContent = "";
  parametersGrid.innerHTML = "";
  state.appendedPartNumber = "";
  state.selectedVehicleId = "";
  state.descriptionText = "";
  state.descriptionManuallyEdited = false;
  descriptionTextInput.value = "";
  categoryLocked = false;
  delete categoryInput.dataset.edited;
  priceInput.value = "";
  stockInput.value = "1";
  if (state.shippingRates.length) shippingRateInput.value = state.shippingRates[0].id;
  renderAfterSalesInputs();
  suggestionPanel.classList.add("hidden");
  summaryCard.classList.add("hidden");
  activeProductId = "";
  addButton.textContent = "Dodaj do listy";
  updateProductNavigation();
  renderPhotos();
  renderVehicleButtons();
}

function detectProductDetails() {
  const searchText = titleInput.value.toLowerCase();
  const detectedCategory = findMatchingCategory(searchText);

  applyAutomaticParameterValues(getPreferredManufacturer());
  if (!state.categoryId && !categoryLocked && (!categoryInput.dataset.edited || !categoryInput.value)) {
    setLocalCategorySuggestion(detectedCategory);
    state.categoryId = "";
    categoryStatus.textContent = state.allegroConnected
      ? "Lokalna podpowiedź. Czekamy na odpowiedź Allegro..."
      : "Lokalna podpowiedź. Połącz konto, aby pobrać prawdziwą kategorię Allegro.";
  }
}

function scheduleAllegroCategoryLookup() {
  clearTimeout(categoryLookupTimer);
  if (categoryLocked || !state.allegroConnected || titleInput.value.trim().length < 3) return;
  categoryLookupTimer = setTimeout(() => loadAllegroCategory(titleInput.value.trim()), 450);
}

async function loadAllegroCategory(phrase) {
  const title = phrase || titleInput.value.trim();
  if (!state.allegroConnected || title.length < 3) return;

  categoryStatus.textContent = "Pobieramy kategorię z Allegro...";
  try {
    const result = await apiRequest(`/api/matching-categories?name=${encodeURIComponent(title)}`);
    const matchingCategories = result.matchingCategories || [];
    if (!matchingCategories.length) {
      state.categoryId = "";
      categoryStatus.textContent = "Allegro nie zwróciło pasującej kategorii. Możesz wpisać ją ręcznie.";
      return;
    }
    categoryInput.innerHTML = matchingCategories
      .map((category, index) => `<option value="${escapeHtml(category.id)}">${index === 0 ? "Sugestia: " : ""}${escapeHtml(fixEncoding(category.name))}</option>`)
      .join("");
    state.categoryId = matchingCategories[0].id;
    categoryInput.value = state.categoryId;
    categoryLocked = true;
    categoryStatus.textContent = `${matchingCategories.length} kategorii z Allegro · wybierz właściwą z listy`;
    enrichCategoryOptionsWithPaths(matchingCategories);
    await loadCategoryDetails(state.categoryId);
  } catch (error) {
    state.categoryId = "";
    categoryStatus.textContent = `Nie udało się pobrać kategorii z Allegro: ${error.message}`;
  }
}

async function enrichCategoryOptionsWithPaths(categories) {
  await Promise.all(categories.map(async (category, index) => {
    try {
      const result = await apiRequest(`/api/category-path?id=${encodeURIComponent(category.id)}`);
      const path = (result.categories || []).map((item) => fixEncoding(item.name)).join(" > ");
      const option = [...categoryInput.options].find((item) => item.value === category.id);
      if (option && path) option.textContent = `${index === 0 ? "Sugestia: " : ""}${path}`;
    } catch {}
  }));
}

async function loadCategoryLevel(parentId = "") {
  if (!state.allegroConnected) {
    categoryStatus.textContent = "Najpierw połącz konto Allegro.";
    return;
  }

  categoryBrowserList.innerHTML = "Pobieramy kategorie...";
  try {
    const suffix = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
    const result = await apiRequest(`/api/categories${suffix}`);
    categoryBackButton.classList.toggle("hidden", categoryParents.length === 0);
    categoryBrowserList.innerHTML = result.categories
      .map((category) => `
        <button class="category-option" type="button"
          data-category-id="${escapeHtml(category.id)}"
          data-category-name="${escapeHtml(fixEncoding(category.name))}"
          data-category-leaf="${category.leaf}">
          ${escapeHtml(fixEncoding(category.name))}${category.leaf ? "" : " ›"}
        </button>
      `)
      .join("");
    categoryBrowserList.querySelectorAll(".category-option").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.categoryLeaf === "true") {
          selectCategory(button.dataset.categoryId, button.dataset.categoryName);
          categoryBrowser.classList.add("hidden");
          return;
        }
        categoryParents.push(button.dataset.categoryId);
        loadCategoryLevel(button.dataset.categoryId);
      });
    });
  } catch (error) {
    categoryBrowserList.textContent = error.message;
  }
}

function selectCategory(id, name) {
  categoryInput.innerHTML = `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
  categoryInput.value = id;
  state.categoryId = id;
  categoryLocked = true;
  categoryStatus.textContent = `Wybrana kategoria Allegro · ID: ${id}`;
  loadCategoryDetails(id);
}

async function loadCategoryDetails(id) {
  if (!id || !state.allegroConnected) return;
  let path = "";
  try {
    const pathResult = await apiRequest(`/api/category-path?id=${encodeURIComponent(id)}`);
    path = (pathResult.categories || []).map((category) => fixEncoding(category.name)).join(" > ");
    const option = categoryInput.options[categoryInput.selectedIndex];
    if (option && path) option.textContent = path;
    categoryStatus.textContent = `${path || "Wybrana kategoria"} · ID: ${id}`;
  } catch (error) {
    categoryStatus.textContent = `Wybrana kategoria · ID: ${id}. Nie udało się pobrać ścieżki: ${error.message}`;
  }

  parametersPanel.classList.remove("hidden");
  parametersStatus.textContent = "Pobieramy parametry obowiązkowe...";
  parametersGrid.innerHTML = "";
  try {
    const parameterResult = await apiRequest(`/api/category-parameters/${encodeURIComponent(id)}`);
    state.requiredParameters = (parameterResult.parameters || []).filter((parameter) => {
      const name = normalizeText(parameter.name);
      return parameter.required
        || parameter.requiredForProduct
        || isManufacturerParameter(name)
        || isCatalogNumberParameter(name)
        || isConditionParameter(name)
        || isPreGsprParameter(name)
        || isCarTypeParameter(name)
        || isInstallationSideParameter(name);
    });
    addManufacturerOptionsFromParameters();
    applyAutomaticParameterValues(getPreferredManufacturer());
    renderRequiredParameters();
    if (!state.requiredParameters.length) {
      parametersPanel.classList.remove("hidden");
      parametersStatus.textContent = "Allegro nie zwróciło obowiązkowych parametrów dla tej kategorii.";
    }
  } catch (error) {
    state.requiredParameters = [];
    parametersPanel.classList.remove("hidden");
    parametersStatus.textContent = `Nie udało się pobrać parametrów: ${error.message}`;
    parametersGrid.innerHTML = "";
  }
}

function renderRequiredParameters() {
  parametersPanel.classList.remove("hidden");
  parametersStatus.textContent = state.requiredParameters.length
    ? `${state.requiredParameters.length} pól obowiązkowych i automatycznie uzupełnianych`
    : "";
  parametersGrid.innerHTML = state.requiredParameters.map((parameter) => {
    const value = state.parameterValues[parameter.id] || "";
    const dependency = parameter.options?.dependsOnParameterId ? " · zależny" : "";
    const normalizedName = normalizeText(parameter.name);
    const detectedBrand = getPreferredManufacturer();
    const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
    const manufacturerHint = isManufacturerParameter(normalizedName) && detectedBrand && !selectedValues.length
      ? `<small>Nie znaleziono marki OE „${escapeHtml(detectedBrand)}” w słowniku Allegro. Wybierz ręcznie.</small>`
      : "";
    const installationSide = isInstallationSideParameter(normalizedName) ? detectInstallationSideFromTitle() : null;
    const installationHint = isInstallationSideParameter(normalizedName)
      ? `<small>${installationSide
          ? `Wykryto z tytułu: ${escapeHtml(installationSide.label)}${selectedValues.length ? "" : ". Brak zgodnej opcji w słowniku Allegro."}`
          : "Nie wykryto strony zabudowy w tytule."}</small>`
      : "";
    if (parameter.type === "dictionary" && parameter.dictionary?.length) {
      const isMultiple = parameter.restrictions?.multipleChoices === true;
      const useCompactSingleSelect = isMultiple && isCarTypeParameter(normalizedName);
      return `
        <label class="parameter-field">
          <span>${escapeHtml(fixEncoding(parameter.name))}${dependency}</span>
          <select data-parameter-id="${escapeHtml(parameter.id)}" ${isMultiple && !useCompactSingleSelect ? "multiple" : ""} ${useCompactSingleSelect ? 'data-compact-multiple="true"' : ""}>
            <option value="">Wybierz</option>
            ${parameter.dictionary.map((item) => `<option value="${escapeHtml(item.id)}" ${selectedValues.includes(item.id) ? "selected" : ""}>${escapeHtml(fixEncoding(item.value))}</option>`).join("")}
          </select>
          ${manufacturerHint}
          ${installationHint}
        </label>`;
    }
    return `
      <label class="parameter-field">
        <span>${escapeHtml(fixEncoding(parameter.name))}${dependency}</span>
        <input data-parameter-id="${escapeHtml(parameter.id)}" type="text" value="${escapeHtml(value)}" />
      </label>`;
  }).join("");
  parametersGrid.querySelectorAll("[data-parameter-id]").forEach((input) => {
    input.addEventListener("change", () => {
      state.parameterValues[input.dataset.parameterId] = input.multiple
        ? [...input.selectedOptions].map((option) => option.value).filter(Boolean)
        : input.dataset.compactMultiple === "true" ? (input.value ? [input.value] : []) : input.value;
    });
  });
}

function syncRenderedParameterValues() {
  parametersGrid.querySelectorAll("[data-parameter-id]").forEach((input) => {
    const value = state.parameterValues[input.dataset.parameterId] || "";
    if (input.multiple) {
      const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
      [...input.options].forEach((option) => { option.selected = selectedValues.includes(option.value); });
    } else if (input.dataset.compactMultiple === "true") {
      const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
      input.value = selectedValues[0] || "";
    } else if (input.value !== value) {
      input.value = value;
    }
  });
}

function applyAutomaticParameterValues(detectedBrand = getPreferredManufacturer()) {
  state.requiredParameters.forEach((parameter) => {
    const normalizedName = normalizeText(parameter.name);
    if (isManufacturerParameter(normalizedName) && detectedBrand) {
      const manufacturerValue = findDictionaryValueId(parameter, detectedBrand)
        || (parameter.type === "dictionary" ? "" : detectedBrand);
      state.parameterValues[parameter.id] = manufacturerValue;
    }
    if (isCatalogNumberParameter(normalizedName)) {
      state.parameterValues[parameter.id] = isOriginalCatalogNumberParameter(normalizedName)
        ? partNumber.value.trim()
        : titleInput.value.trim();
    }
    if (isConditionParameter(normalizedName)) {
      state.parameterValues[parameter.id] = findDictionaryValueId(parameter, "Używany") || "Używany";
    }
    if (isPreGsprParameter(normalizedName)) {
      state.parameterValues[parameter.id] = findPositiveParameterValue(parameter);
    }
    if (isCarTypeParameter(normalizedName)) {
      const carTypeValue = findDictionaryValueId(parameter, "Samochody osobowe")
        || findDictionaryValueId(parameter, "Samochód osobowy")
        || findDictionaryValueId(parameter, "Osobowe")
        || (parameter.type === "dictionary" ? "" : "Samochody osobowe");
      state.parameterValues[parameter.id] = parameter.restrictions?.multipleChoices && carTypeValue
        ? [carTypeValue]
        : carTypeValue;
    }
    if (isInstallationSideParameter(normalizedName)) {
      const installationSide = detectInstallationSideFromTitle();
      if (installationSide) {
        const sideValue = findInstallationSideValue(parameter, installationSide);
        state.parameterValues[parameter.id] = sideValue
          || (parameter.type === "dictionary" ? (parameter.restrictions?.multipleChoices ? [] : "") : installationSide.label);
      }
    }
  });
}

function detectBrandFromTitle() {
  return findMatchingBrand(titleInput.value.toLowerCase())?.brand || "";
}

function getSelectedVehicle() {
  return state.vehicles.find((item) => item.id === state.selectedVehicleId) || null;
}

function getPreferredManufacturer() {
  return getSelectedVehicle()?.manufacturer || detectBrandFromTitle();
}

function findDictionaryValueId(parameter, expectedValue) {
  const expected = normalizeText(expectedValue);
  const values = parameter.dictionary || [];
  return values.find((item) => normalizeText(item.value) === expected)?.id
    || values.find((item) => {
      const value = normalizeText(item.value);
      return value === `${expected} oe`
        || value === `oe ${expected}`
        || value === `${expected} oryginalne`
        || value === `oryginalne ${expected}`;
    })?.id
    || "";
}

function isManufacturerParameter(name) {
  return name.includes("producent") || name === "marka";
}

function isCatalogNumberParameter(name) {
  return name.includes("numer katalogowy") || name.includes("numer czesci");
}

function isOriginalCatalogNumberParameter(name) {
  return name.includes("oryginalu") || name.includes("oryginalny") || name.includes("oe");
}

function isConditionParameter(name) {
  return name === "stan" || name.includes("stan produktu");
}

function isPreGsprParameter(name) {
  return (name.includes("13.12.2024") || name.includes("13 grudnia 2024"))
    && (name.includes("obrot") || name.includes("rynku") || name.includes("ue") || name.includes("unii europejskiej"));
}

function findPositiveParameterValue(parameter) {
  if (parameter.type === "dictionary") {
    return findDictionaryValueId(parameter, "Tak")
      || findDictionaryValueId(parameter, "Yes")
      || parameter.dictionary?.[0]?.id
      || "";
  }
  return "true";
}

function isCarTypeParameter(name) {
  return name.includes("typ samochodu")
    || name.includes("rodzaj samochodu")
    || name.includes("typ pojazdu")
    || name.includes("rodzaj pojazdu")
    || name === "przeznaczenie";
}

function isInstallationSideParameter(name) {
  return name.includes("strona")
    || name.includes("zabudow")
    || name.includes("montaz")
    || name.includes("umiejscow");
}

function detectInstallationSideFromTitle() {
  const title = ` ${normalizeText(titleInput.value)} `;
  const left = /\b(lewy|lewa|lewe|lewej|lewostronny|lewostronna)\b/.test(title);
  const right = /\b(prawy|prawa|prawe|prawej|prawostronny|prawostronna)\b/.test(title);
  const front = /\b(przod|przedni|przednia|przednie|przodu)\b/.test(title);
  const rear = /\b(tyl|tylny|tylna|tylne|tylu)\b/.test(title);

  if ((left && right) || (front && rear)) return null;
  if (front && left) return { label: "Przód lewa", parts: ["Przód", "Lewa"], variants: ["Przód - lewa strona", "Przód lewy", "Lewy przód", "Przednia lewa", "Lewy przedni", "Z przodu po lewej"] };
  if (front && right) return { label: "Przód prawa", parts: ["Przód", "Prawa"], variants: ["Przód - prawa strona", "Przód prawy", "Prawy przód", "Przednia prawa", "Prawy przedni", "Z przodu po prawej"] };
  if (rear && left) return { label: "Tył lewa", parts: ["Tył", "Lewa"], variants: ["Tył - lewa strona", "Tył lewy", "Lewy tył", "Tylna lewa", "Lewy tylny", "Z tyłu po lewej"] };
  if (rear && right) return { label: "Tył prawa", parts: ["Tył", "Prawa"], variants: ["Tył - prawa strona", "Tył prawy", "Prawy tył", "Tylna prawa", "Prawy tylny", "Z tyłu po prawej"] };
  if (left) return { label: "Lewa", parts: ["Lewa"], variants: ["Lewa", "Lewy", "Lewa strona"] };
  if (right) return { label: "Prawa", parts: ["Prawa"], variants: ["Prawa", "Prawy", "Prawa strona"] };
  if (front) return { label: "Przód", parts: ["Przód"], variants: ["Przód", "Przednia", "Z przodu"] };
  if (rear) return { label: "Tył", parts: ["Tył"], variants: ["Tył", "Tylna", "Z tyłu"] };
  return null;
}

function findInstallationSideValue(parameter, installationSide) {
  const targetParts = installationSide.parts.map(classifyInstallationSidePart);
  if (parameter.restrictions?.multipleChoices) {
    const ids = targetParts
      .map((part) => parameter.dictionary?.find((item) => classifyInstallationSideOption(item.value).includes(part))?.id)
      .filter(Boolean);
    if (ids.length) return [...new Set(ids)];
  }
  const semanticMatch = parameter.dictionary?.find((item) => {
    const optionParts = classifyInstallationSideOption(item.value);
    return targetParts.length === optionParts.length && targetParts.every((part) => optionParts.includes(part));
  });
  if (semanticMatch) return semanticMatch.id;
  for (const variant of installationSide.variants) {
    const id = findDictionaryValueId(parameter, variant);
    if (id) return id;
  }
  return "";
}

function classifyInstallationSidePart(value) {
  const normalized = normalizeText(value);
  if (/\b(lewy|lewa|lewe|lewostronny|lewostronna|lewej)\b/.test(normalized)) return "left";
  if (/\b(prawy|prawa|prawe|prawostronny|prawostronna|prawej)\b/.test(normalized)) return "right";
  if (/\b(przod|przedni|przednia|przednie|przodu)\b/.test(normalized)) return "front";
  if (/\b(tyl|tylny|tylna|tylne|tylu)\b/.test(normalized)) return "rear";
  return normalized;
}

function classifyInstallationSideOption(value) {
  const normalized = normalizeText(value);
  return ["left", "right", "front", "rear"].filter((part) => {
    if (part === "left") return /\b(lewy|lewa|lewe|lewostronny|lewostronna|lewej)\b/.test(normalized);
    if (part === "right") return /\b(prawy|prawa|prawe|prawostronny|prawostronna|prawej)\b/.test(normalized);
    if (part === "front") return /\b(przod|przedni|przednia|przednie|przodu)\b/.test(normalized);
    return /\b(tyl|tylny|tylna|tylne|tylu)\b/.test(normalized);
  });
}

function installationSidePartVariants(part) {
  const normalized = normalizeText(part);
  if (normalized === "lewa") return ["Lewa", "Lewy", "Lewe", "Lewa strona", "Po lewej"];
  if (normalized === "prawa") return ["Prawa", "Prawy", "Prawe", "Prawa strona", "Po prawej"];
  if (normalized === "przod") return ["Przód", "Przedni", "Przednia", "Przednie", "Z przodu"];
  if (normalized === "tyl") return ["Tył", "Tylny", "Tylna", "Tylne", "Z tyłu"];
  return [part];
}

function findDictionaryValueByVariants(parameter, variants) {
  for (const variant of variants) {
    const id = findDictionaryValueId(parameter, variant);
    if (id) return id;
  }
  return "";
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");
}

function setLocalCategorySuggestion(category) {
  if (!category || state.allegroConnected) return;
  categoryInput.innerHTML = `<option value="" data-source="local">Lokalna sugestia: ${escapeHtml(category)}</option>`;
  state.categoryId = "";
}

function appendPartNumberToTitle() {
  const number = partNumber.value.trim();
  let title = titleInput.value.trim();
  if (!number || !title) return;
  if (state.appendedPartNumber) {
    title = title.replace(new RegExp(`\\s*${escapeRegExp(state.appendedPartNumber)}\\s*$`, "i"), "");
  }
  const titleWithoutRepeatedNumber = title.replace(new RegExp(`\\s*${escapeRegExp(number)}\\s*$`, "i"), "");
  titleInput.value = `${titleWithoutRepeatedNumber} ${number}`;
  state.appendedPartNumber = number;
  suggestionPanel.classList.remove("hidden");
  summaryCard.classList.remove("hidden");
  updateSummary();
  scheduleAllegroCategoryLookup();
}

function fixEncoding(value) {
  if (!/[ÃÅÄ]/.test(value)) return value;
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

async function checkConnectionStatus() {
  try {
    const result = await apiRequest("/api/health");
    if (!compatibleServerBuilds.includes(result.build)) {
      connectionDescription.textContent = "Wersja serwera nie pasuje do Wystawiacza. Odśwież stronę lub zgłoś problem administratorowi.";
      return;
    }
    if (!result.connected) return;
    state.allegroConnected = true;
    connectionTitle.textContent = "Konto Allegro połączone";
    connectionDescription.textContent = `Konto Allegro połączone${result.sellerId ? ` · ID sprzedawcy: ${result.sellerId}` : ""}. Kategorie i szablony pobieramy bezpośrednio z Allegro.`;
    connectButton.textContent = "Połączono";
    connectButton.disabled = true;
    disconnectButton.classList.remove("hidden");
    await refreshConnectedAccountInfo();
    await loadShippingRates();
    await loadAfterSalesServices();
    await loadComplianceData();
  } catch (error) {
    connectionDescription.textContent = error.message;
  }
}

async function refreshConnectedAccountInfo() {
  try {
    const account = await apiRequest("/api/me");
    const companyName = account.company?.name;
    const accountLabel = companyName
      ? `${account.login} · firma: ${companyName}`
      : `${account.login} · konto prywatne`;
    connectionDescription.textContent = `Połączone konto: ${accountLabel}. ID sprzedawcy: ${account.id}. Kategorie i szablony pobieramy bezpośrednio z Allegro.`;
  } catch {
    connectionDescription.textContent = "Konto Allegro połączone, ale nie udało się pobrać loginu sprzedawcy.";
  }
}

async function loadShippingRates() {
  try {
    const result = await apiRequest("/api/shipping-rates");
    state.shippingRates = result.shippingRates || [];
    shippingRateInput.innerHTML = state.shippingRates.length
      ? state.shippingRates.map((rate) => `<option value="${escapeHtml(rate.id)}">${escapeHtml(fixEncoding(rate.name))}</option>`).join("")
      : '<option value="">Brak zapisanych profili wysyłki</option>';
  } catch (error) {
    shippingRateInput.innerHTML = `<option value="">Nie udało się pobrać profili</option>`;
    showToast(`Profile wysyłki: ${error.message}`);
  }
}

async function loadAfterSalesServices() {
  try {
    const [returnPolicies, impliedWarranties, warranties] = await Promise.all([
      apiRequest("/api/return-policies"),
      apiRequest("/api/implied-warranties"),
      apiRequest("/api/warranties")
    ]);
    state.afterSalesServices.returnPolicies = returnPolicies.returnPolicies || returnPolicies.items || [];
    state.afterSalesServices.impliedWarranties = impliedWarranties.impliedWarranties || impliedWarranties.items || [];
    state.afterSalesServices.warranties = warranties.warranties || warranties.items || [];
    renderAfterSalesInputs();
    const returnName = state.afterSalesServices.returnPolicies[0]?.name || "brak";
    const impliedName = state.afterSalesServices.impliedWarranties[0]?.name || "brak";
    if (!state.afterSalesServices.returnPolicies.length || !state.afterSalesServices.impliedWarranties.length) {
      showToast("Na tym połączonym koncie Allegro API zwraca 0 szablonów zwrotu/reklamacji.");
      return;
    }
    showToast(`Szablony Allegro: zwrot ${returnName}, reklamacja ${impliedName}.`);
  } catch (error) {
    renderAfterSalesInputs();
    showToast(`Szablony zwrotu/reklamacji: ${error.message}`);
  }
}

async function loadComplianceData() {
  try {
    const [producers, persons] = await Promise.all([
      apiRequest("/api/responsible-producers"),
      apiRequest("/api/responsible-persons")
    ]);
    state.compliance.responsibleProducers = producers.responsibleProducers || producers.items || [];
    state.compliance.responsiblePersons = persons.responsiblePersons || persons.items || [];
    if (!state.compliance.responsibleProducers.length) {
      showToast("Allegro zwraca 0 producentów odpowiedzialnych. Ptaszek GPSR ustawimy automatycznie.");
    }
  } catch (error) {
    state.compliance.responsibleProducers = [];
    state.compliance.responsiblePersons = [];
    showToast(`GPSR/producent odpowiedzialny: ${error.message}`);
  }
}

function renderAfterSalesInputs(product = null) {
  renderAfterSalesSelect(returnPolicyInput, state.afterSalesServices.returnPolicies, "Brak szablonu zwrotu");
  renderAfterSalesSelect(impliedWarrantyInput, state.afterSalesServices.impliedWarranties, "Brak szablonu reklamacji");
  renderAfterSalesSelect(warrantyInput, state.afterSalesServices.warranties, "Brak gwarancji", true);
  if (product?.returnPolicyId) returnPolicyInput.value = product.returnPolicyId;
  if (product?.impliedWarrantyId) impliedWarrantyInput.value = product.impliedWarrantyId;
  if (product?.warrantyId) warrantyInput.value = product.warrantyId;
}

function renderAfterSalesSelect(input, items, emptyLabel, allowEmpty = false) {
  const options = [];
  if (allowEmpty || !items.length) options.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
  options.push(...items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(fixEncoding(item.name || item.id))}</option>`));
  input.innerHTML = options.join("");
}

function saveSession() {
  if (activeProductId) saveActiveProductDraft();
  const sessionName = sessionNameInput.value.trim() || "sesja-produktow";
  const folderLabel = localStorage.getItem("allegroAssistantPhotoFolder") || "";
  const payload = {
    format: "wystawiacz-allegro-session",
    version: 1,
    name: sessionName,
    photoFolderLabel: folderLabel,
    photoRotations: [...state.photoRotations],
    savedAt: new Date().toISOString(),
    vehicles: state.vehicles,
    products: state.products.map(({ image, ...product }) => product)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${toFileName(sessionName)}.wystawiacz.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Sesja zapisana do pliku.");
}

async function loadSession() {
  const file = loadSessionInput.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== "wystawiacz-allegro-session" || !Array.isArray(payload.products)) {
      throw new Error("To nie jest plik sesji programu.");
    }
    state.products = payload.products;
    state.photoRotations = new Map((Array.isArray(payload.photoRotations) ? payload.photoRotations : [])
      .filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && Number.isInteger(entry[1]) && entry[1] >= 0 && entry[1] < 4));
    await restorePhotoRotations();
    state.vehicles = Array.isArray(payload.vehicles) ? payload.vehicles.map(normalizeVehicle) : [];
    state.products.forEach((product) => {
      if (!product.id) product.id = crypto.randomUUID();
    });
    sessionNameInput.value = payload.name || file.name.replace(/\.wystawiacz\.json$/i, "");
    renderProducts();
    renderVehicles();
    const folderLabel = localStorage.getItem("allegroAssistantPhotoFolder");
    sessionStatus.textContent = folderLabel
      ? `Sesja otwarta. Lokalny folder zdjęć: ${folderLabel}. W razie potrzeby wskaż go ponownie.`
      : "Sesja otwarta. Wskaż folder zdjęć na tym komputerze, aby połączyć miniatury po nazwach.";
    showToast(`Otworzono sesję: ${payload.name || file.name}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    loadSessionInput.value = "";
  }
}

function toFileName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ąćęłńóśźż]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "sesja-produktow";
}

function findMatchingBrand(searchText) {
  const matches = [
    { terms: ["volkswagen", "vw", "golf", "passat", "polo", "tiguan", "touran"], brand: "Volkswagen" },
    { terms: ["audi"], brand: "Audi" },
    { terms: ["skoda", "škoda", "octavia", "fabia", "superb"], brand: "Skoda" },
    { terms: ["seat", "leon", "ibiza", "ateca"], brand: "Seat" },
    { terms: ["cupra", "formentor"], brand: "Cupra" },
    { terms: ["bmw"], brand: "BMW" },
    { terms: ["mini", "cooper"], brand: "Mini" },
    { terms: ["mercedes", "mercedes-benz"], brand: "Mercedes-Benz" },
    { terms: ["opel", "astra", "insignia", "corsa"], brand: "Opel" },
    { terms: ["vauxhall"], brand: "Vauxhall" },
    { terms: ["ford", "focus", "mondeo", "fiesta"], brand: "Ford" },
    { terms: ["renault", "megane", "clio", "laguna"], brand: "Renault" },
    { terms: ["dacia", "duster", "logan", "sandero"], brand: "Dacia" },
    { terms: ["peugeot"], brand: "Peugeot" },
    { terms: ["ds"], brand: "DS" },
    { terms: ["citroen", "citroën"], brand: "Citroen" },
    { terms: ["fiat", "abarth"], brand: "Fiat" },
    { terms: ["alfa romeo", "alfa"], brand: "Alfa Romeo" },
    { terms: ["lancia"], brand: "Lancia" },
    { terms: ["jeep"], brand: "Jeep" },
    { terms: ["chrysler"], brand: "Chrysler" },
    { terms: ["dodge"], brand: "Dodge" },
    { terms: ["toyota", "yaris", "corolla", "avensis", "auris"], brand: "Toyota" },
    { terms: ["lexus"], brand: "Lexus" },
    { terms: ["volvo"], brand: "Volvo" },
    { terms: ["nissan"], brand: "Nissan" },
    { terms: ["infiniti"], brand: "Infiniti" },
    { terms: ["hyundai"], brand: "Hyundai" },
    { terms: ["kia"], brand: "Kia" },
    { terms: ["honda", "civic", "accord", "cr-v", "crv"], brand: "Honda" },
    { terms: ["mazda"], brand: "Mazda" },
    { terms: ["mitsubishi"], brand: "Mitsubishi" },
    { terms: ["subaru"], brand: "Subaru" },
    { terms: ["suzuki"], brand: "Suzuki" },
    { terms: ["daihatsu"], brand: "Daihatsu" },
    { terms: ["isuzu"], brand: "Isuzu" },
    { terms: ["ssangyong", "ssang yong"], brand: "SsangYong" },
    { terms: ["chevrolet"], brand: "Chevrolet" },
    { terms: ["daewoo"], brand: "Daewoo" },
    { terms: ["smart"], brand: "Smart" },
    { terms: ["porsche"], brand: "Porsche" },
    { terms: ["jaguar"], brand: "Jaguar" },
    { terms: ["land rover", "range rover", "discovery", "freelander"], brand: "Land Rover" },
    { terms: ["tesla"], brand: "Tesla" },
    { terms: ["saab"], brand: "Saab" },
    { terms: ["iveco"], brand: "Iveco" },
    { terms: ["maserati"], brand: "Maserati" },
    { terms: ["ferrari"], brand: "Ferrari" },
    { terms: ["bentley"], brand: "Bentley" },
    { terms: ["aston martin"], brand: "Aston Martin" }
  ];

  const normalizedText = normalizeText(searchText);
  return matches.find(({ terms }) => terms.some((term) => hasTerm(normalizedText, normalizeText(term)))) || null;
}

function normalizeManufacturerName(value) {
  const trimmed = value.trim();
  return findMatchingBrand(trimmed)?.brand || trimmed;
}

function renderManufacturerOptions(extraNames = []) {
  if (!vehicleManufacturerOptions) return;
  allegroManufacturerOptions = [
    ...allegroManufacturerOptions,
    ...extraNames.map((name) => fixEncoding(String(name || "").trim())).filter(Boolean)
  ];
  const names = [...new Set([...OE_MANUFACTURERS, ...allegroManufacturerOptions])]
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second, "pl"));
  vehicleManufacturerOptions.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

function addManufacturerOptionsFromParameters() {
  const names = [];
  state.requiredParameters.forEach((parameter) => {
    if (!isManufacturerParameter(normalizeText(parameter.name))) return;
    (parameter.dictionary || []).forEach((item) => {
      if (item.value) names.push(item.value);
    });
  });
  renderManufacturerOptions(names);
}

function findMatchingCategory(searchText) {
  const matches = [
    { terms: ["lampa tylna", "lampy tylne"], value: "Lampy tylne" },
    { terms: ["lampa przednia", "reflektor", "halogen"], value: "Lampy przednie" },
    { terms: ["kierunkowskaz"], value: "Kierunkowskazy" },
    { terms: ["przełącznik szyb", "włącznik szyb", "przycisk szyb", "panel szyb"], value: "Przełączniki szyb" },
    { terms: ["lusterko", "wkład lusterka"], value: "Lusterka zewnętrzne" },
    { terms: ["zderzak"], value: "Zderzaki" },
    { terms: ["błotnik"], value: "Błotniki" },
    { terms: ["maska", "pokrywa silnika"], value: "Maski" },
    { terms: ["drzwi"], value: "Drzwi" },
    { terms: ["klamka"], value: "Klamki" },
    { terms: ["zamek drzwi", "zamek klapy"], value: "Zamki" },
    { terms: ["alternator"], value: "Alternatory" },
    { terms: ["rozrusznik"], value: "Rozruszniki" },
    { terms: ["sprężarka klimatyzacji", "kompresor klimatyzacji"], value: "Sprężarki klimatyzacji" },
    { terms: ["wentylator chłodnicy"], value: "Wentylatory chłodnicy" },
    { terms: ["chłodnica"], value: "Chłodnice" },
    { terms: ["pompa paliwa"], value: "Pompy paliwa" },
    { terms: ["pompa wody"], value: "Pompy wody" },
    { terms: ["pompa abs", "sterownik abs"], value: "Pompy ABS" },
    { terms: ["zacisk hamulcowy"], value: "Zaciski hamulcowe" },
    { terms: ["tarcza hamulcowa"], value: "Tarcze hamulcowe" },
    { terms: ["wahacz"], value: "Wahacze" },
    { terms: ["amortyzator"], value: "Amortyzatory" },
    { terms: ["maglownica", "przekładnia kierownicza"], value: "Przekładnie kierownicze" },
    { terms: ["turbo", "turbosprężarka"], value: "Turbosprężarki" },
    { terms: ["wtrysk", "wtryskiwacz"], value: "Wtryskiwacze" },
    { terms: ["przepustnica"], value: "Przepustnice" },
    { terms: ["egr", "zawór egr"], value: "Zawory EGR" },
    { terms: ["czujnik parkowania", "pdc"], value: "Czujniki parkowania" },
    { terms: ["czujnik"], value: "Czujniki" },
    { terms: ["sterownik silnika", "komputer silnika", "ecu"], value: "Sterowniki silnika" },
    { terms: ["radio", "nawigacja"], value: "Radia i nawigacje" },
    { terms: ["licznik", "zegar"], value: "Liczniki" },
    { terms: ["poduszka powietrzna", "airbag"], value: "Poduszki powietrzne" },
    { terms: ["kierownica"], value: "Kierownice" },
    { terms: ["skrzynia biegów"], value: "Skrzynie biegów" },
    { terms: ["silnik"], value: "Silniki kompletne" }
  ];

  return matches.find(({ terms }) => terms.some((term) => hasTerm(searchText, term)))?.value || "";
}

function hasTerm(searchText, term) {
  return ` ${searchText} `.includes(` ${term} `) || searchText.includes(term);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function togglePhoto(name) {
  if (!name) return;
  previewPhotoName = name;
  if (state.selectedPhotoNames.includes(name)) {
    state.selectedPhotoNames = state.selectedPhotoNames.filter((photoName) => photoName !== name);
  } else {
    state.selectedPhotoNames.push(name);
  }
  renderPhotos();
}

function navigatePhoto(direction) {
  const names = [...state.localPhotosByName.keys()];
  if (!names.length) return;
  const currentIndex = Math.max(names.indexOf(previewPhotoName), 0);
  previewPhotoName = names[(currentIndex + direction + names.length) % names.length];
  renderPhotos();
}

async function rotatePreviewPhoto(direction) {
  const name = previewPhotoName;
  const photo = state.localPhotosByName.get(name);
  if (!photo || photo.rotating) return;
  const turns = ((state.photoRotations.get(name) || 0) + direction + 4) % 4;
  try {
    photo.rotating = true;
    renderPhotos();
    await applyPhotoRotation(photo, turns);
    state.photoRotations.set(name, turns);
  } catch (error) {
    showToast(error.message || "Nie udalo sie obrocic zdjecia.");
  } finally {
    photo.rotating = false;
    renderPhotos();
    renderProducts();
  }
}

async function restorePhotoRotations() {
  for (const photo of state.localPhotosByName.values()) {
    try {
      await applyPhotoRotation(photo, state.photoRotations.get(photo.name) || 0);
    } catch (error) {
      showToast(`Nie udalo sie przywrocic obrotu: ${photo.name}. ${error.message}`);
    }
  }
}

async function applyPhotoRotation(photo, turns) {
  photo.originalFile ||= photo.file;
  let file = photo.originalFile;
  if (turns) {
    // Always render from the original to avoid accumulating JPEG compression.
    const sourceUrl = URL.createObjectURL(photo.originalFile);
    try {
      const img = new Image();
      img.src = sourceUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = turns % 2 ? img.naturalHeight : img.naturalWidth;
      canvas.height = turns % 2 ? img.naturalWidth : img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Nie mozna przygotowac obrotu zdjecia.");
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(turns * Math.PI / 2);
      context.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const type = photo.originalFile.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.95));
      if (!blob) throw new Error("Nie udalo sie zapisac obroconego zdjecia.");
      file = new File([blob], photo.name, { type, lastModified: photo.originalFile.lastModified });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }
  const url = URL.createObjectURL(file);
  URL.revokeObjectURL(photo.url);
  photo.file = file;
  photo.url = url;
}

function setPreviewAsMainPhoto() {
  if (!previewPhotoName || !state.selectedPhotoNames.includes(previewPhotoName)) return;
  state.selectedPhotoNames = [
    previewPhotoName,
    ...state.selectedPhotoNames.filter((name) => name !== previewPhotoName)
  ];
  renderPhotos();
  showToast("Zmieniono zdjęcie główne.");
}

function renderDescriptionPreview() {
  const mainPhotoUrl = findPhotoUrl(state.selectedPhotoNames[0]);
  descriptionPreviewImage.src = mainPhotoUrl || "";
  descriptionPreviewImage.classList.toggle("hidden", !mainPhotoUrl);
  descriptionMissingImage.classList.toggle("hidden", Boolean(mainPhotoUrl));
  descriptionPreviewTitle.textContent = titleInput.value.trim() || "Tytuł aukcji pojawi się tutaj";
  updateAutomaticDescriptionText();
  descriptionPreviewText.textContent = state.descriptionText;
  if (descriptionTextInput.value !== state.descriptionText) descriptionTextInput.value = state.descriptionText;
}

function buildDescriptionModel() {
  const lines = buildDescriptionParagraphs(state.descriptionText);
  return {
    sections: [
      {
        items: [
          { type: "IMAGE", photoName: state.selectedPhotoNames[0] || "" },
          {
            type: "TEXT",
            content: `<p>${escapeHtml(titleInput.value.trim()).toUpperCase()}</p>${lines}`
          }
        ]
      }
    ]
  };
}

function buildAllegroDescription(imageUrls) {
  const mainImageUrl = imageUrls[0] || "";
  const text = `<p>${escapeHtml(titleInput.value.trim()).toUpperCase()}</p>${buildDescriptionParagraphs(state.descriptionText)}`;
  return {
    sections: [
      {
        items: [
          ...(mainImageUrl ? [{ type: "IMAGE", url: mainImageUrl }] : []),
          { type: "TEXT", content: text }
        ]
      }
    ]
  };
}

function updateAutomaticDescriptionText() {
  if (state.descriptionManuallyEdited) return;
  const vehicle = state.vehicles.find((item) => item.id === state.selectedVehicleId);
  state.descriptionText = [
    "Część używana 100% sprawna",
    vehicle?.full ? `Pasuje do: ${vehicle.full}` : ""
  ].filter(Boolean).join("\n\n");
}

function addVehicle() {
  const manufacturer = normalizeManufacturerName(vehicleManufacturerInput.value);
  const short = vehicleShortInput.value.trim();
  const full = vehicleFullInput.value.trim();
  if (!manufacturer || !short || !full) {
    showToast("Wpisz producenta OE, skrót oraz pełny opis auta.");
    return;
  }
  state.vehicles.push({ id: crypto.randomUUID(), manufacturer, short, full });
  vehicleManufacturerInput.value = "";
  vehicleShortInput.value = "";
  vehicleFullInput.value = "";
  renderVehicles();
  showToast("Auto dodane do listy sesji.");
}

function renderVehicles() {
  vehicleList.innerHTML = state.vehicles.length
    ? state.vehicles.map((vehicle) => `
      <span class="vehicle-chip" title="${escapeHtml([vehicle.manufacturer, vehicle.full].filter(Boolean).join(" - "))}">
        <strong>${escapeHtml(vehicle.manufacturer || "OE")}</strong> ${escapeHtml(vehicle.short)}
        <button type="button" data-remove-vehicle-id="${escapeHtml(vehicle.id)}" aria-label="Usuń auto">×</button>
      </span>`).join("")
    : "<small>Lista aut jest pusta.</small>";
  vehicleList.querySelectorAll("[data-remove-vehicle-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.vehicles = state.vehicles.filter((vehicle) => vehicle.id !== button.dataset.removeVehicleId);
      if (state.selectedVehicleId === button.dataset.removeVehicleId) state.selectedVehicleId = "";
      renderVehicles();
    });
  });
  renderVehicleButtons();
}

function renderVehicleButtons() {
  vehicleButtons.innerHTML = state.vehicles.length
    ? state.vehicles.map((vehicle) => `
      <button class="vehicle-use-button ${vehicle.id === state.selectedVehicleId ? "active" : ""}" type="button" data-use-vehicle-id="${escapeHtml(vehicle.id)}" title="${escapeHtml([vehicle.manufacturer, vehicle.full].filter(Boolean).join(" - "))}">
        ${escapeHtml(vehicle.short)}
      </button>`).join("")
    : "<small>Najpierw dodaj auta do listy sesji.</small>";
  vehicleButtons.querySelectorAll("[data-use-vehicle-id]").forEach((button) => {
    button.addEventListener("click", () => useVehicle(button.dataset.useVehicleId));
  });
}

function useVehicle(id) {
  const vehicle = state.vehicles.find((item) => item.id === id);
  if (!vehicle) return;
  const previousVehicle = state.vehicles.find((item) => item.id === state.selectedVehicleId);
  let title = titleInput.value.trim();
  if (previousVehicle?.short) title = title.replace(new RegExp(`\\s*${escapeRegExp(previousVehicle.short)}\\s*`, "i"), " ").trim();
  const part = partNumber.value.trim();
  if (part) title = title.replace(new RegExp(`\\s*${escapeRegExp(part)}\\s*$`, "i"), "").trim();
  titleInput.value = `${title}${title ? " " : ""}${vehicle.short}${part ? ` ${part}` : ""}`.trim();
  state.selectedVehicleId = id;
  state.appendedPartNumber = part;
  state.descriptionManuallyEdited = false;
  updateSummary();
  renderVehicleButtons();
  scheduleAllegroCategoryLookup();
}

function normalizeVehicle(vehicle) {
  const short = vehicle?.short || "";
  const full = vehicle?.full || "";
  const manufacturer = normalizeManufacturerName(vehicle?.manufacturer || findMatchingBrand(`${short} ${full}`)?.brand || "");
  return {
    id: vehicle?.id || crypto.randomUUID(),
    manufacturer,
    short,
    full
  };
}

function getTitleWithoutPartNumber() {
  const part = partNumber.value.trim();
  return part ? titleInput.value.trim().replace(new RegExp(`\\s*${escapeRegExp(part)}\\s*$`, "i"), "") : titleInput.value.trim();
}

function openSearch(baseUrl, query) {
  if (!query) {
    showToast("Brakuje tekstu do wyszukania.");
    return;
  }
  window.open(`${baseUrl}${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
}

const publishingProducts = new Set();
async function publishProduct(id) {
  if (publishingProducts.has(id)) return;
  if (activeProductId === id) saveActiveProductDraft();
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  if (product.allegroOfferId || product.publishStatus === "WYSTAWIONO") {
    showToast("Ta aukcja jest juz wystawiona. Nie wysylamy jej ponownie.");
    return;
  }
  applyDefaultAfterSalesToProduct(product);
  const validationError = validateProductBeforePublish(product);
  if (validationError) {
    showToast(validationError);
    return;
  }
  const accepted = confirm(`Wystawić tę jedną aukcję na Allegro?\n\n${product.title}\nCena: ${product.price} PLN`);
  if (!accepted) return;
  const location = getPublishLocation();
  if (!location) return;

  publishingProducts.add(id);
  product.publishError = "";
  let stage = "Wysylanie zdjec";
  product.publishStatus = "Wysyłanie zdjęć...";
  renderProducts();
  try {
    const imageUrls = await uploadProductImages(product);
    stage = "Pobieranie parametrow kategorii";
    product.publishStatus = "Tworzenie oferty...";
    renderProducts();
    const parameterDefinitions = await loadCategoryParameterDefinitions(product.categoryId);
    const offer = buildAllegroOfferPayload(product, imageUrls, parameterDefinitions, location);
    stage = "Tworzenie oferty";
    const result = await apiRequest("/api/product-offers", {
      method: "POST",
      body: JSON.stringify({ offerBase64: toBase64Utf8(JSON.stringify(offer)) })
    });
    product.allegroOfferId = result.id || result.offer?.id || "";
    product.publishStatus = "WYSTAWIONO";
    product.allegroResponse = result;
    showToast(`Wystawiono aukcję${product.allegroOfferId ? ` ID: ${product.allegroOfferId}` : ""}.`);
  } catch (error) {
    product.publishStatus = "BŁĄD";
    product.publishError = `${stage}: ${error.message}${stage === "Tworzenie oferty" ? " Przed ponowna proba sprawdz Moje oferty w Allegro: przy przerwanym polaczeniu oferta mogla powstac." : ""}`;
    showToast(product.publishError);
  } finally {
    publishingProducts.delete(id);
    renderProducts();
  }
}

function applyDefaultAfterSalesToProduct(product) {
  if (!product.returnPolicyId && returnPolicyInput.value) {
    product.returnPolicyId = returnPolicyInput.value;
    product.returnPolicyName = returnPolicyInput.options[returnPolicyInput.selectedIndex]?.textContent || "";
  }
  if (!product.impliedWarrantyId && impliedWarrantyInput.value) {
    product.impliedWarrantyId = impliedWarrantyInput.value;
    product.impliedWarrantyName = impliedWarrantyInput.options[impliedWarrantyInput.selectedIndex]?.textContent || "";
  }
  if (!product.warrantyId && warrantyInput.value) {
    product.warrantyId = warrantyInput.value;
    product.warrantyName = warrantyInput.options[warrantyInput.selectedIndex]?.textContent || "";
  }
}

function validateProductBeforePublish(product) {
  if (!state.allegroConnected) return "Najpierw połącz konto Allegro na świeżej wersji programu.";
  if (!product.title) return "Brakuje tytułu.";
  const titleError = window.TitleEditor.error(product.title);
  if (titleError) return titleError;
  if (!product.categoryId) return "Brakuje kategorii Allegro.";
  if (!Number(product.price)) return "Brakuje ceny.";
  if (!product.shippingRateId) return "Brakuje profilu wysyłki Allegro.";
  if (!product.returnPolicyId) return "Wybierz warunki zwrotu Allegro.";
  if (!product.impliedWarrantyId) return "Wybierz warunki reklamacji Allegro.";
  if (!product.photoNames?.length) return "Brakuje zdjęć.";
  const missingPhoto = product.photoNames.find((name) => !state.localPhotosByName.has(name));
  if (missingPhoto) return `Nie widzę pliku zdjęcia: ${missingPhoto}. Wskaż folder zdjęć ponownie.`;
  return "";
}

function getPublishLocation() {
  const saved = JSON.parse(localStorage.getItem("allegroAssistantPublishLocation") || "null");
  if (saved?.city && saved?.postCode && saved?.province) {
    const normalizedSaved = { ...saved, province: normalizeProvince(saved.province) };
    localStorage.setItem("allegroAssistantPublishLocation", JSON.stringify(normalizedSaved));
    return normalizedSaved;
  }
  fillLocationModal();
  locationModal.classList.remove("hidden");
  showToast("Najpierw ustaw lokalizację ofert. Zapiszesz ją raz.");
  return null;
}

function fillLocationModal() {
  const saved = JSON.parse(localStorage.getItem("allegroAssistantPublishLocation") || "null") || {};
  locationCityInput.value = saved.city || "";
  locationPostCodeInput.value = saved.postCode || "";
  locationProvinceInput.value = normalizeProvince(saved.province || "KUJAWSKO_POMORSKIE");
}

function savePublishLocation(location) {
  const normalized = {
    countryCode: "PL",
    city: location.city.trim(),
    postCode: location.postCode.trim(),
    province: normalizeProvince(location.province)
  };
  localStorage.setItem("allegroAssistantPublishLocation", JSON.stringify(normalized));
  return normalized;
}

async function uploadProductImages(product) {
  const urls = [];
  for (const photoName of product.photoNames) {
    const photo = state.localPhotosByName.get(photoName);
    if (!photo?.file) throw new Error(`Brakuje lokalnego pliku zdjęcia: ${photoName}`);
    if (photo.rotating) throw new Error("Poczekaj na zakonczenie obracania zdjecia.");
    if (photo.file.size > 20 * 1024 * 1024) throw new Error(`Zdjecie ${photoName} przekracza 20 MB.`);
    let result;
    try { result = await apiRequest("/api/upload-image", {
      method: "POST",
      headers: { "Content-Type": photo.file.type || "image/jpeg" },
      body: photo.file
    }); } catch (error) { throw new Error(`Zdjecie ${urls.length + 1}/${product.photoNames.length} (${photoName}): ${error.message}`); }
    const url = result.location || result.url || result.imageUrl;
    if (!url) throw new Error("Allegro nie zwróciło adresu przesłanego zdjęcia.");
    urls.push(url);
  }
  return urls;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Nie udało się odczytać zdjęcia."));
    reader.readAsDataURL(file);
  });
}

async function loadCategoryParameterDefinitions(categoryId) {
  const result = await apiRequest(`/api/category-parameters/${encodeURIComponent(categoryId)}`);
  return result.parameters || [];
}

function buildAllegroOfferPayload(product, imageUrls, parameterDefinitions, location) {
  const { productParameters, offerParameters } = splitOfferParameters(product.parameterValues || {}, parameterDefinitions);
  const quantity = Math.max(Number(product.stock) || 1, 1);
  const afterSalesServices = buildAfterSalesServices(product);
  const productSetElement = {
    product: {
      name: product.title,
      category: { id: product.categoryId },
      images: imageUrls,
      parameters: productParameters
    },
    marketedBeforeGPSRObligation: true
  };
  const responsibleProducer = findResponsibleProducerForProduct(product);
  if (responsibleProducer) productSetElement.responsibleProducer = responsibleProducer;
  return {
    name: product.title,
    category: { id: product.categoryId },
    productSet: [productSetElement],
    parameters: offerParameters,
    images: imageUrls,
    description: buildProductDescriptionForPublish(product, imageUrls),
    sellingMode: {
      format: "BUY_NOW",
      price: {
        amount: normalizePriceAmount(product.price),
        currency: "PLN"
      }
    },
    stock: {
      available: quantity,
      unit: "UNIT"
    },
    delivery: {
      shippingRates: {
        id: product.shippingRateId
      }
    },
    afterSalesServices,
    location,
    payments: {
      invoice: "VAT"
    },
    publication: {
      status: "ACTIVE"
    }
  };
}

function findResponsibleProducerForProduct(product) {
  const producerName = normalizeText(product.brand || product.manufacturer || "");
  if (!producerName) return null;
  const match = state.compliance.responsibleProducers.find((producer) => {
    const names = [
      producer.name,
      producer.producerData?.tradeName,
      producer.producerData?.name,
      producer.producerData?.companyName
    ].filter(Boolean).map(normalizeText);
    return names.some((name) => name === producerName || name.includes(producerName) || producerName.includes(name));
  });
  return match?.id ? { type: "ID", id: match.id } : null;
}

function buildAfterSalesServices(product) {
  const services = {
    returnPolicy: { id: product.returnPolicyId },
    impliedWarranty: { id: product.impliedWarrantyId }
  };
  if (product.warrantyId) {
    services.warranty = { id: product.warrantyId };
  }
  return services;
}

function buildProductDescriptionForPublish(product, imageUrls) {
  const mainImageUrl = imageUrls[0] || "";
  const text = `<p>${escapeHtml(product.title).toUpperCase()}</p>${buildDescriptionParagraphs(product.descriptionText || "Część używana 100% sprawna")}`;
  return {
    sections: [
      {
        items: [
          ...(mainImageUrl ? [{ type: "IMAGE", url: mainImageUrl }] : []),
          { type: "TEXT", content: text }
        ]
      }
    ]
  };
}

function buildDescriptionParagraphs(text) {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function splitOfferParameters(parameterValues, parameterDefinitions) {
  const productParameters = [];
  const offerParameters = [];
  parameterDefinitions.forEach((parameter) => {
    const value = parameterValues[parameter.id];
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
    const converted = convertParameterValue(parameter, value);
    if (!converted) return;
    const describesProduct = parameter.options?.describesProduct !== false || parameter.requiredForProduct === true;
    if (describesProduct && !isConditionParameter(normalizeText(parameter.name))) productParameters.push(converted);
    else offerParameters.push(converted);
  });
  return { productParameters, offerParameters };
}

function convertParameterValue(parameter, value) {
  if (parameter.type === "dictionary") {
    const valuesIds = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
    return valuesIds.length ? { id: parameter.id, valuesIds } : null;
  }
  const values = Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
  return values.length ? { id: parameter.id, values } : null;
}

function normalizePriceAmount(value) {
  return Number(String(value).replace(",", ".")).toFixed(2);
}

function normalizeProvince(value) {
  const text = normalizeText(value || "kujawsko-pomorskie");
  const provinces = [
    ["DOLNOSLASKIE", "dolnoslaskie dolny slask"],
    ["KUJAWSKO_POMORSKIE", "kujawsko pomorskie kujawy pomorskie"],
    ["LUBELSKIE", "lubelskie"],
    ["LUBUSKIE", "lubuskie"],
    ["LODZKIE", "lodzkie lodz"],
    ["MALOPOLSKIE", "malopolskie malopolska"],
    ["MAZOWIECKIE", "mazowieckie mazowsze warszawa"],
    ["OPOLSKIE", "opolskie"],
    ["PODKARPACKIE", "podkarpackie"],
    ["PODLASKIE", "podlaskie"],
    ["POMORSKIE", "pomorskie"],
    ["SLASKIE", "slaskie slask"],
    ["SWIETOKRZYSKIE", "swietokrzyskie"],
    ["WARMINSKO_MAZURSKIE", "warminsko mazurskie warmia mazury"],
    ["WIELKOPOLSKIE", "wielkopolskie wielkopolska poznan"],
    ["ZACHODNIOPOMORSKIE", "zachodniopomorskie zachodnio pomorskie"]
  ];
  const matched = provinces.find(([code, words]) => normalizeText(code).includes(text) || words.includes(text) || text.includes(normalizeText(code)));
  return matched?.[0] || String(value || "KUJAWSKO_POMORSKIE").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function toBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function findPhotoUrl(name) {
  return state.localPhotosByName.get(name)?.url || "";
}

function editProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  activeProductId = id;
  partNumber.value = product.enteredPartNumber || "";
  titleInput.value = product.title || "";
  categoryInput.innerHTML = `<option value="${escapeHtml(product.categoryId || "")}">${escapeHtml(product.category || "Wybierz kategorię")}</option>`;
  categoryInput.value = product.categoryId || "";
  state.categoryId = product.categoryId || "";
  categoryLocked = Boolean(state.categoryId);
  state.parameterValues = { ...(product.parameterValues || {}) };
  categoryStatus.textContent = product.categoryId ? `Wybrana kategoria Allegro · ID: ${product.categoryId}` : "Wybierz kategorię Allegro";
  priceInput.value = product.price || "";
  stockInput.value = product.stock || "1";
  state.selectedPhotoNames = [...(product.photoNames || [])];
  previewPhotoName = state.selectedPhotoNames[0] || previewPhotoName;
  if (product.shippingRateId) shippingRateInput.value = product.shippingRateId;
  renderAfterSalesInputs(product);
  state.appendedPartNumber = product.enteredPartNumber || "";
  state.selectedVehicleId = product.selectedVehicleId || "";
  state.descriptionText = product.descriptionText || "Część używana 100% sprawna";
  state.descriptionManuallyEdited = Boolean(product.descriptionText);
  descriptionTextInput.value = state.descriptionText;
  suggestionPanel.classList.remove("hidden");
  summaryCard.classList.remove("hidden");
  addButton.textContent = "Zapisz zmiany";
  updateSummary();
  if (state.categoryId) loadCategoryDetails(state.categoryId);
  renderPhotos();
  renderProducts();
  summaryCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function navigateProduct(direction) {
  if (!state.products.length) return;
  const currentId = activeProductId;
  if (activeProductId) saveActiveProductDraft();
  const currentIndex = state.products.findIndex((product) => product.id === currentId);
  const startIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + state.products.length) % state.products.length;
  editProduct(state.products[nextIndex].id);
}

function saveActiveProductDraft() {
  const product = state.products.find((item) => item.id === activeProductId);
  if (!product) return;
  product.title = titleInput.value.trim();
  product.enteredPartNumber = partNumber.value.trim();
  product.allegroPartNumber = product.title;
  product.brand = getPreferredManufacturer();
  product.category = categoryInput.options[categoryInput.selectedIndex]?.textContent || "";
  product.categoryId = state.categoryId;
  product.categoryPath = product.category;
  product.parameterValues = { ...state.parameterValues };
  product.price = priceInput.value.trim();
  product.stock = Number(stockInput.value);
  product.shippingRateId = shippingRateInput.value;
  product.shippingRateName = shippingRateInput.options[shippingRateInput.selectedIndex]?.textContent || "";
  product.returnPolicyId = returnPolicyInput.value;
  product.returnPolicyName = returnPolicyInput.options[returnPolicyInput.selectedIndex]?.textContent || "";
  product.impliedWarrantyId = impliedWarrantyInput.value;
  product.impliedWarrantyName = impliedWarrantyInput.options[impliedWarrantyInput.selectedIndex]?.textContent || "";
  product.warrantyId = warrantyInput.value;
  product.warrantyName = warrantyInput.options[warrantyInput.selectedIndex]?.textContent || "";
  product.photoNames = [...state.selectedPhotoNames];
  product.image = findPhotoUrl(product.photoNames[0]);
  product.description = buildDescriptionModel();
  product.descriptionText = state.descriptionText;
  product.selectedVehicleId = state.selectedVehicleId;
  renderProducts();
}

function updateProductNavigation() {
  const activeIndex = state.products.findIndex((product) => product.id === activeProductId);
  const hasProducts = state.products.length > 0;
  previousProductButton.disabled = !hasProducts;
  nextProductButton.disabled = !hasProducts;
  activeProductLabel.textContent = activeIndex >= 0
    ? `Aukcja ${activeIndex + 1} z ${state.products.length}`
    : `Nowa aukcja · zapisanych: ${state.products.length}`;
}

function formatPrice(price) {
  return Number(price).toFixed(2).replace(".", ",");
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

