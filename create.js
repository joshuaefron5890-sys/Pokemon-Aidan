/* global netlifyIdentity */

// ── State ──────────────────────────────────────────────────
const STATE_KEY = "wizard_state_v1";
const ADMIN_SESSION_KEY = "pokebinder.admin.session";

// Write the admin session so /admin auto-logs the user in after the wizard
function saveAdminSession(token, user, expiresIn) {
  try {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
      access_token:  token,
      refresh_token: user?.token?.refresh_token || null,
      user:          { email: user?.email || null, id: user?.id || null, user_metadata: user?.user_metadata || {} },
      expires_at:    Math.round(Date.now() / 1000) + (expiresIn || 3600),
    }));
  } catch {}
}

let wizardData = {
  owner:     "",
  slug:      "",
  isPublic:  false,
  location:  null,   // { zip, city, state } resolved from zip lookup
  token:     null,   // JWT after signup/login
  cards:     [],     // confirmed cards from step 3
  photo:     null,   // base64 JPEG after crop (persisted so page reloads don't lose it)
};

// Restore partial state from localStorage (survives email confirmation redirect)
try {
  const saved = localStorage.getItem(STATE_KEY);
  if (saved) Object.assign(wizardData, JSON.parse(saved));
} catch {}

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(wizardData)); } catch {}
}

// ── Step management ────────────────────────────────────────

let currentStep = 1;

function goTo(n) {
  document.querySelectorAll(".wizard-step").forEach((el, i) => {
    el.classList.toggle("active", i + 1 === n);
  });
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`pill-${i}`);
    if (!pill) continue;
    pill.classList.remove("active", "done");
    if (i < n)      pill.classList.add("done");
    else if (i === n) pill.classList.add("active");
  }
  currentStep = n;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Step 1: Binder info ────────────────────────────────────

// ── Photo upload + crop ────────────────────────────────────

let pendingPhoto = null; // raw base64 (no data: prefix), set after cropping

const photoFileInput  = document.getElementById("photo-file-input");
const photoPlaceholder = document.getElementById("photo-placeholder");
const photoHasImage   = document.getElementById("photo-has-image");
const photoPreview    = document.getElementById("photo-preview");
const cropArea        = document.getElementById("crop-area");
const cropCanvas      = document.getElementById("crop-canvas");
const cropZoomSlider  = document.getElementById("crop-zoom");

const CROP_SIZE = 260; // canvas display size in px
const OUT_SIZE  = 400; // exported JPEG size in px

// Crop state
let cropImg = null;
let cropX = 0, cropY = 0, cropZoom = 1;
let dragging = false, dragSX, dragSY, panSX, panSY;
let lastPinchDist = null;

// ── File input / drag-drop ──────────────────────────────────

photoFileInput.addEventListener("change", e => {
  if (e.target.files[0]) openCrop(e.target.files[0]);
});

const uploadWrap = document.getElementById("photo-upload-wrap");
uploadWrap.addEventListener("dragover", e => e.preventDefault());
uploadWrap.addEventListener("drop", e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) openCrop(file);
});

// ── Open crop UI ────────────────────────────────────────────

function openCrop(file) {
  const url = URL.createObjectURL(file);
  cropImg = new Image();
  cropImg.onload = () => {
    URL.revokeObjectURL(url);
    // Initial zoom: shorter side fills the circle
    cropZoom = CROP_SIZE / Math.min(cropImg.naturalWidth, cropImg.naturalHeight);
    // Center the image
    cropX = (CROP_SIZE - cropImg.naturalWidth  * cropZoom) / 2;
    cropY = (CROP_SIZE - cropImg.naturalHeight * cropZoom) / 2;
    cropZoomSlider.value = 1;
    renderCrop();
    photoPlaceholder.classList.add("hidden");
    photoHasImage.classList.add("hidden");
    cropArea.classList.remove("hidden");
  };
  cropImg.src = url;
}

// ── Render crop preview ─────────────────────────────────────

function renderCrop() {
  if (!cropImg) return;
  const ctx = cropCanvas.getContext("2d");
  cropCanvas.width  = CROP_SIZE;
  cropCanvas.height = CROP_SIZE;

  const w = cropImg.naturalWidth  * cropZoom;
  const h = cropImg.naturalHeight * cropZoom;

  // Dim layer (full image, desaturated)
  ctx.globalAlpha = 0.35;
  ctx.drawImage(cropImg, cropX, cropY, w, h);
  ctx.globalAlpha = 1;

  // Full-brightness circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(cropImg, cropX, cropY, w, h);
  ctx.restore();

  // Golden ring
  ctx.strokeStyle = "rgba(247,201,72,.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

// ── Zoom ────────────────────────────────────────────────────

function applyZoom(newZoom) {
  newZoom = Math.max(1, Math.min(3, newZoom));
  // Zoom from center of canvas
  const pivotX = CROP_SIZE / 2, pivotY = CROP_SIZE / 2;
  const ratio  = newZoom / cropZoom;
  cropX = pivotX - (pivotX - cropX) * ratio;
  cropY = pivotY - (pivotY - cropY) * ratio;
  cropZoom = newZoom;
  clampPan();
  renderCrop();
}

cropZoomSlider.addEventListener("input", () => {
  // Slider goes 1–3; map to zoom relative to fit
  const baseZoom = CROP_SIZE / Math.min(cropImg.naturalWidth, cropImg.naturalHeight);
  applyZoom(baseZoom * parseFloat(cropZoomSlider.value));
});

// Scroll-to-zoom on canvas
cropCanvas.addEventListener("wheel", e => {
  e.preventDefault();
  const baseZoom = CROP_SIZE / Math.min(cropImg.naturalWidth, cropImg.naturalHeight);
  const newRaw   = (cropZoom / baseZoom) - e.deltaY * 0.002;
  cropZoomSlider.value = Math.max(1, Math.min(3, newRaw));
  applyZoom(baseZoom * parseFloat(cropZoomSlider.value));
}, { passive: false });

// ── Pan — mouse ─────────────────────────────────────────────

cropCanvas.addEventListener("mousedown", e => {
  dragging = true; dragSX = e.clientX; dragSY = e.clientY;
  panSX = cropX; panSY = cropY;
  cropCanvas.style.cursor = "grabbing";
});
window.addEventListener("mousemove", e => {
  if (!dragging) return;
  cropX = panSX + (e.clientX - dragSX);
  cropY = panSY + (e.clientY - dragSY);
  clampPan(); renderCrop();
});
window.addEventListener("mouseup", () => {
  dragging = false;
  cropCanvas.style.cursor = "grab";
});

// ── Pan + pinch — touch ──────────────────────────────────────

cropCanvas.addEventListener("touchstart", e => {
  if (e.touches.length === 1) {
    dragging = true;
    dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY;
    panSX = cropX; panSY = cropY;
    lastPinchDist = null;
  } else if (e.touches.length === 2) {
    dragging = false;
    lastPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}, { passive: true });

cropCanvas.addEventListener("touchmove", e => {
  e.preventDefault();
  if (e.touches.length === 1 && dragging) {
    cropX = panSX + (e.touches[0].clientX - dragSX);
    cropY = panSY + (e.touches[0].clientY - dragSY);
    clampPan(); renderCrop();
  } else if (e.touches.length === 2 && lastPinchDist !== null) {
    const dist  = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const baseZoom = CROP_SIZE / Math.min(cropImg.naturalWidth, cropImg.naturalHeight);
    const newRaw   = (cropZoom / baseZoom) * (dist / lastPinchDist);
    lastPinchDist  = dist;
    cropZoomSlider.value = Math.max(1, Math.min(3, newRaw));
    applyZoom(baseZoom * parseFloat(cropZoomSlider.value));
  }
}, { passive: false });

cropCanvas.addEventListener("touchend", () => { dragging = false; lastPinchDist = null; });

// ── Clamp pan so image never fully leaves the circle ─────────

function clampPan() {
  const w = cropImg.naturalWidth  * cropZoom;
  const h = cropImg.naturalHeight * cropZoom;
  const r = CROP_SIZE / 2;
  // Image edge must stay within r pixels of the center
  cropX = Math.min(r, Math.max(r - w, cropX));
  cropY = Math.min(r, Math.max(r - h, cropY));
}

// ── Apply / Cancel ──────────────────────────────────────────

document.getElementById("crop-apply").addEventListener("click", () => {
  const scale = OUT_SIZE / CROP_SIZE;
  const out   = document.createElement("canvas");
  out.width = out.height = OUT_SIZE;
  const ctx = out.getContext("2d");

  // Clip to circle
  ctx.beginPath();
  ctx.arc(OUT_SIZE / 2, OUT_SIZE / 2, OUT_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(cropImg,
    cropX * scale, cropY * scale,
    cropImg.naturalWidth * cropZoom * scale,
    cropImg.naturalHeight * cropZoom * scale
  );

  const dataUrl = out.toDataURL("image/jpeg", 0.85);
  pendingPhoto  = dataUrl.split(",")[1];
  wizardData.photo = pendingPhoto;
  saveState();
  photoPreview.src = dataUrl;

  cropArea.classList.add("hidden");
  photoHasImage.classList.remove("hidden");
});

document.getElementById("crop-cancel").addEventListener("click", () => {
  cropArea.classList.add("hidden");
  photoPlaceholder.classList.remove("hidden");
  photoFileInput.value = "";
});

document.getElementById("photo-remove").addEventListener("click", () => {
  pendingPhoto = null;
  wizardData.photo = null;
  saveState();
  photoFileInput.value = "";
  photoHasImage.classList.add("hidden");
  photoPlaceholder.classList.remove("hidden");
});

const ownerInput = document.getElementById("owner-name");
const slugInput  = document.getElementById("binder-slug");
const slugStatus = document.getElementById("slug-status");

function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function slugValid(s) {
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s);
}

ownerInput.addEventListener("input", () => {
  const auto = toSlug(ownerInput.value);
  if (!slugInput.dataset.manualEdit) slugInput.value = auto;
  validateSlug();
});

slugInput.addEventListener("input", () => {
  slugInput.dataset.manualEdit = "1";
  validateSlug();
});

function validateSlug() {
  const s = slugInput.value;
  if (!s) { slugStatus.textContent = ""; return false; }
  if (slugValid(s)) {
    slugStatus.innerHTML = `<span class="slug-ok">✓ /binder/${s}</span>`;
    return true;
  }
  slugStatus.innerHTML = `<span class="slug-err">Use lowercase letters, numbers, and hyphens (min 3 chars).</span>`;
  return false;
}

// Visibility radio
document.querySelectorAll(".vis-option").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".vis-option").forEach(o => o.classList.remove("checked"));
    opt.classList.add("checked");
    opt.querySelector("input").checked = true;
  });
});

// ── Zip code lookup ───────────────────────────────────────────

let zipLookupTimer = null;
let resolvedLocation = null; // { zip, city, state } once valid

document.getElementById("wizard-zip").addEventListener("input", e => {
  const zip = e.target.value.trim();
  clearTimeout(zipLookupTimer);
  resolvedLocation = null;
  const preview  = document.getElementById("wizard-zip-preview");
  const cityEl   = document.getElementById("wizard-zip-city");
  preview.classList.add("hidden");
  if (zip.length === 5 && /^\d{5}$/.test(zip)) {
    zipLookupTimer = setTimeout(() => doZipLookup(zip), 400);
  }
});

async function doZipLookup(zip) {
  const preview = document.getElementById("wizard-zip-preview");
  const cityEl  = document.getElementById("wizard-zip-city");
  try {
    const res  = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) { cityEl.textContent = "Zip code not found"; preview.classList.remove("hidden"); return; }
    const data  = await res.json();
    const place = data.places?.[0];
    if (place) {
      const city  = place["place name"];
      const state = place["state abbreviation"];
      resolvedLocation = { zip, city, state };
      cityEl.textContent = `${city}, ${state}`;
      preview.classList.remove("hidden");
    }
  } catch {
    cityEl.textContent = "Could not look up zip code";
    document.getElementById("wizard-zip-preview").classList.remove("hidden");
  }
}

// Restore zip if returning after email confirmation
if (wizardData.location) {
  resolvedLocation = wizardData.location;
  document.getElementById("wizard-zip").value = wizardData.location.zip;
  document.getElementById("wizard-zip-city").textContent = `${wizardData.location.city}, ${wizardData.location.state}`;
  document.getElementById("wizard-zip-preview").classList.remove("hidden");
}

document.getElementById("step1-next").addEventListener("click", () => {
  const owner = ownerInput.value.trim();
  const slug  = slugInput.value.trim();
  const zip   = document.getElementById("wizard-zip").value.trim();
  const errEl = document.getElementById("step1-error");
  errEl.textContent = "";

  if (!owner) { errEl.textContent = "Please enter your name."; return; }
  if (!slugValid(slug)) { errEl.textContent = "Please enter a valid binder URL."; return; }
  if (!zip || !/^\d{5}$/.test(zip)) { errEl.textContent = "Please enter a valid 5-digit zip code."; return; }
  if (!resolvedLocation) { errEl.textContent = "Zip code not recognized — please try again."; return; }

  // Auto-apply crop if user clicked Continue without pressing "Use Photo"
  if (!cropArea.classList.contains("hidden") && cropImg) {
    document.getElementById("crop-apply").click();
  }

  wizardData.owner    = owner;
  wizardData.slug     = slug;
  wizardData.isPublic = document.querySelector("[name=visibility]:checked")?.value !== "private";
  wizardData.location = resolvedLocation;
  saveState();
  goTo(2);
});

// Restore step 1 fields if returning
if (wizardData.owner) ownerInput.value = wizardData.owner;
if (wizardData.slug)  { slugInput.value = wizardData.slug; slugInput.dataset.manualEdit = "1"; validateSlug(); }
if (wizardData.photo) {
  pendingPhoto = wizardData.photo;
  photoPreview.src = `data:image/jpeg;base64,${pendingPhoto}`;
  photoPlaceholder.classList.add("hidden");
  photoHasImage.classList.remove("hidden");
}

// ── Step 2: Account creation ───────────────────────────────

const emailInput    = document.getElementById("signup-email");
const passwordInput = document.getElementById("signup-password");
const step2Btn      = document.getElementById("step2-next");
const step2Spinner  = document.getElementById("step2-spinner");
const step2Label    = document.getElementById("step2-label");
const step2Error    = document.getElementById("step2-error");

// If user returns after email confirmation, token will be in netlifyIdentity
netlifyIdentity.on("init", user => {
  if (user && wizardData.owner && !wizardData.token) {
    wizardData.token = user.token?.access_token;
    saveState();
    goTo(3);
  }
});

netlifyIdentity.on("login", user => {
  netlifyIdentity.close();
  const token = user.token?.access_token;
  saveAdminSession(token, user, user.token?.expires_in);
  wizardData.token = token;
  saveState();
  goTo(3);
});

step2Btn.addEventListener("click", async () => {
  const email    = emailInput.value.trim();
  const password = passwordInput.value;
  step2Error.textContent = "";

  if (!email || !email.includes("@")) { step2Error.textContent = "Please enter a valid email."; return; }
  if (password.length < 8) { step2Error.textContent = "Password must be at least 8 characters."; return; }

  step2Btn.disabled = true;
  step2Spinner.classList.remove("hidden");
  step2Label.textContent = "Creating account…";

  try {
    // Attempt signup via GoTrue API
    const res = await fetch("/.netlify/identity/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, data: { full_name: wizardData.owner } }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.msg || data.error_description || "Signup failed. Try a different email.");
    }

    if (data.access_token) {
      // Sync into Identity Widget's localStorage so the admin page recognises the session
      try {
        localStorage.setItem("gotrue.user", JSON.stringify({
          ...data,
          expires_at: Math.round(Date.now() / 1000) + (data.expires_in || 3600),
        }));
      } catch {}
      saveAdminSession(data.access_token, data.user, data.expires_in);
      wizardData.token = data.access_token;
      saveState();
      goTo(3);
    } else {
      // No token yet — try logging in immediately (works when email confirmation is disabled
      // but the signup response omits the token)
      try {
        const loginRes = await fetch("/.netlify/identity/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `grant_type=password&username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
        });
        const loginData = await loginRes.json();
        if (loginRes.ok && loginData.access_token) {
          try {
            localStorage.setItem("gotrue.user", JSON.stringify({
              ...loginData,
              expires_at: Math.round(Date.now() / 1000) + (loginData.expires_in || 3600),
            }));
          } catch {}
          saveAdminSession(loginData.access_token, loginData.user, loginData.expires_in);
          wizardData.token = loginData.access_token;
          saveState();
          goTo(3);
          return;
        }
      } catch {}

      // Email confirmation still required — tell the user
      step2Spinner.classList.add("hidden");
      step2Label.textContent = "Create Account";
      step2Btn.disabled = false;
      step2Error.textContent = "";
      step2Error.style.color = "#4ade80";
      step2Error.textContent = "Check your email to confirm your account, then come back here.";
      saveState();
    }
  } catch (err) {
    step2Btn.disabled = false;
    step2Spinner.classList.add("hidden");
    step2Label.textContent = "Create Account";
    step2Error.textContent = err.message;
  }
});

document.getElementById("login-instead").addEventListener("click", () => {
  netlifyIdentity.open("login");
});

// ── Step 3: Card search ─────────────────────────────────────

const searchInput  = document.getElementById("card-search-input");
const searchBtn    = document.getElementById("card-search-btn");
const searchStatus = document.getElementById("card-search-status");
const resultsEl    = document.getElementById("card-results");
const resultsGrid  = document.getElementById("results-grid");
const trayList     = document.getElementById("tray-list");
const trayCount    = document.getElementById("tray-count");
const trayEmpty    = document.getElementById("tray-empty");
const step3NextBtn = document.getElementById("step3-next");
const step3Spinner = document.getElementById("step3-spinner");
const step3Label   = document.getElementById("step3-label");

function updateTray() {
  const cards = wizardData.cards;
  trayCount.textContent = `(${cards.length})`;
  trayList.querySelectorAll(".tray-chip").forEach(c => c.remove());
  if (cards.length === 0) {
    trayEmpty.classList.remove("hidden");
  } else {
    trayEmpty.classList.add("hidden");
    cards.forEach((card, i) => {
      const chip = document.createElement("div");
      chip.className = "tray-chip";
      chip.innerHTML = `<span>${card.query}</span><button class="tray-chip-remove" data-i="${i}">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        wizardData.cards.splice(i, 1);
        saveState();
        updateTray();
      });
      trayList.appendChild(chip);
    });
  }
}

updateTray();

function parseSearchQuery(q) {
  const match = q.trim().match(/^(.+?)\s+([A-Z]*\d+(?:\/\d+)?)$/);
  if (match) return { name: match[1].trim(), number: match[2].split("/")[0] };
  return { name: q.trim(), number: null };
}

function getMarketPrice(card) {
  const prices = card.tcgplayer?.prices;
  if (!prices) return null;
  for (const type of ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil"]) {
    if (prices[type]?.market != null) return prices[type].market;
  }
  return null;
}

function cardImgUrl(cardId) {
  const lastDash = cardId.lastIndexOf("-");
  return `https://images.pokemontcg.io/${cardId.slice(0, lastDash)}/${cardId.slice(lastDash + 1)}.png`;
}

async function doSearch() {
  const q = searchInput.value.trim();
  if (!q) return;

  searchBtn.disabled = true;
  searchBtn.textContent = "Searching…";
  searchStatus.textContent = "";
  resultsEl.classList.add("hidden");
  resultsGrid.innerHTML = "";

  try {
    const { name, number } = parseSearchQuery(q);
    let apiQ = `name:"${name}"`;
    if (number) apiQ += ` number:"${number}"`;
    const res  = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(apiQ)}&pageSize=9&orderBy=-set.releaseDate`);
    const json = await res.json();
    const cards = json.data || [];

    if (!cards.length) {
      searchStatus.textContent = "No cards found. Try a different name or number.";
    } else {
      cards.forEach(card => {
        const price = getMarketPrice(card);
        const btn = document.createElement("button");
        btn.className = "result-item";
        btn.innerHTML = `
          <img src="${cardImgUrl(card.id)}" alt="${card.name}" loading="lazy" onerror="this.style.opacity='.25'" />
          <div class="result-name">${card.name}</div>
          <div class="result-set">${card.set?.name || ""}</div>
          ${price ? `<div class="result-price">$${price.toFixed(2)}</div>` : ""}`;
        btn.addEventListener("click", () => addCard(card));
        resultsGrid.appendChild(btn);
      });
      resultsEl.classList.remove("hidden");
    }
  } catch {
    searchStatus.textContent = "Search failed. Please try again.";
  }

  searchBtn.disabled = false;
  searchBtn.textContent = "Search";
}

function addCard(card) {
  if (wizardData.cards.some(c => c.cardId === card.id)) {
    searchStatus.textContent = "That card is already in your binder.";
    return;
  }
  const price = getMarketPrice(card);
  wizardData.cards.push({
    query:         `${card.name} ${card.number}`,
    cardId:        card.id,
    setName:       card.set?.name || "",
    tcgUrl:        card.tcgplayer?.url || "",
    fallbackPrice: price || undefined,
  });
  saveState();
  updateTray();
  resultsEl.classList.add("hidden");
  resultsGrid.innerHTML = "";
  searchInput.value = "";
  searchStatus.textContent = `✓ Added ${card.name} (${card.set?.name || ""})`;
}

searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
searchBtn.addEventListener("click", doSearch);

// ── Step 3: Tabs ────────────────────────────────────────────

let activeWizTab = "name";
document.querySelectorAll(".wiz-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    activeWizTab = tab.dataset.tab;
    document.querySelectorAll(".wiz-tab").forEach(t => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".wiz-tab-panel").forEach(p =>
      p.classList.toggle("active", p.id === `wiz-tab-${activeWizTab}`)
    );
    resultsEl.classList.add("hidden");
    resultsGrid.innerHTML = "";
  });
});

// ── Step 3: Photo tab ───────────────────────────────────────

function resizeAndIdentify(file) {
  const statusEl = document.getElementById("wiz-photo-status");
  statusEl.textContent = "Identifying card…";
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = async () => {
      const MAX = 1024;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      try {
        const token = wizardData.token;
        const res = await fetch("/.netlify/functions/identify-card", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ imageData: b64, mediaType: "image/jpeg" }),
        });
        const data = await res.json();
        const cards = data.cards || [];
        if (!cards.length) {
          statusEl.textContent = "Couldn't identify the card. Try the Search tab.";
          return;
        }
        statusEl.textContent = "";
        resultsGrid.innerHTML = "";
        cards.forEach(card => {
          const imgSrc = card.cardId ? cardImgUrl(card.cardId) : "";
          const btn = document.createElement("button");
          btn.className = "result-item";
          btn.innerHTML = `
            ${imgSrc ? `<img src="${imgSrc}" alt="${card.query}" loading="lazy" onerror="this.style.opacity='.25'" />` : ""}
            <div class="result-name">${card.query}</div>
            <div class="result-set">${card.setName || ""}</div>
            ${card.marketPrice ? `<div class="result-price">$${Number(card.marketPrice).toFixed(2)}</div>` : ""}`;
          btn.addEventListener("click", () => addIdentifiedCard(card));
          resultsGrid.appendChild(btn);
        });
        resultsEl.classList.remove("hidden");
      } catch {
        statusEl.textContent = "Identification failed. Please try again.";
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function addIdentifiedCard(card) {
  if (card.cardId && wizardData.cards.some(c => c.cardId === card.cardId)) {
    document.getElementById("wiz-photo-status").textContent = "That card is already in your binder.";
    return;
  }
  wizardData.cards.push({
    query:         card.query,
    cardId:        card.cardId || "",
    setName:       card.setName || "",
    tcgUrl:        card.tcgUrl || "",
    fallbackPrice: card.marketPrice || undefined,
  });
  saveState();
  updateTray();
  resultsEl.classList.add("hidden");
  resultsGrid.innerHTML = "";
  document.getElementById("wiz-photo-status").textContent = `✓ Added ${card.query}`;
}

document.getElementById("wiz-camera-input").addEventListener("change", e => {
  if (e.target.files[0]) resizeAndIdentify(e.target.files[0]);
});
document.getElementById("wiz-upload-input").addEventListener("change", e => {
  if (e.target.files[0]) resizeAndIdentify(e.target.files[0]);
});

// ── Step 3: TCG Link tab ────────────────────────────────────

function parseTcgLink(link) {
  try {
    const parts = new URL(link).pathname.split("/").filter(Boolean);
    const slug  = parts[parts.length - 1] || "";
    let cleaned = slug.replace(/^pokemon-/, "");
    const numMatch = cleaned.match(/-(\d+)$/);
    const numStr   = numMatch ? parseInt(numMatch[1], 10).toString() : null;
    if (numMatch) cleaned = cleaned.slice(0, numMatch.index);
    const suffixes  = new Set(["ex", "gx", "v", "vmax", "vstar", "mega", "break", "prime"]);
    const slugParts = cleaned.split("-");
    let nameWords   = [slugParts[slugParts.length - 1]];
    if (slugParts.length >= 2 && suffixes.has(slugParts[slugParts.length - 1])) {
      nameWords = [slugParts[slugParts.length - 2], slugParts[slugParts.length - 1]];
    }
    return numStr ? `${nameWords.join(" ")} ${numStr}` : nameWords.join(" ");
  } catch { return null; }
}

document.getElementById("wiz-link-btn").addEventListener("click", () => {
  const link      = document.getElementById("wiz-link-input").value.trim();
  const statusEl  = document.getElementById("wiz-link-status");
  if (!link || !link.includes("tcgplayer.com")) {
    statusEl.textContent = "Please paste a valid TCGPlayer URL.";
    return;
  }
  const q = parseTcgLink(link);
  if (!q) { statusEl.textContent = "Couldn't parse that URL."; return; }
  statusEl.textContent = "";
  searchInput.value = q;
  activeWizTab = "name";
  document.querySelectorAll(".wiz-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === "name"));
  document.querySelectorAll(".wiz-tab-panel").forEach(p => p.classList.toggle("active", p.id === "wiz-tab-name"));
  doSearch();
});
document.getElementById("wiz-link-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("wiz-link-btn").click();
});

step3NextBtn.addEventListener("click", createBinder);
document.getElementById("skip-cards").addEventListener("click", createBinder);

async function createBinder() {
  const errEl = document.getElementById("step3-error");
  errEl.textContent = "";
  step3NextBtn.disabled = true;
  step3Spinner.classList.remove("hidden");
  step3Label.textContent = "Creating…";

  try {
    const token = wizardData.token || netlifyIdentity.currentUser()?.token?.access_token;
    if (!token) throw new Error("Not signed in. Please go back to step 2.");

    const res = await fetch("/.netlify/functions/create-binder", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        slug:     wizardData.slug,
        owner:    wizardData.owner,
        isPublic: wizardData.isPublic,
        cards:    wizardData.cards,
        photo:    pendingPhoto || wizardData.photo || null,
        location: wizardData.location || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    // Write binder_url + full_name into Netlify Identity user metadata so the
    // admin panel can load this user's binder without a hardcoded email map.
    try {
      await fetch("/.netlify/identity/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data: { full_name: wizardData.owner, binder_url: `/binder/${data.slug}` } }),
      });
    } catch {} // non-fatal — binder already created, metadata is a nice-to-have

    // Clear saved state
    localStorage.removeItem(STATE_KEY);

    // Show success
    const fullUrl = `${location.origin}/binder/${data.slug}`;
    document.getElementById("success-url").textContent = fullUrl;
    document.getElementById("go-to-binder").addEventListener("click", () => {
      window.location.href = "/admin";
    });
    document.getElementById("success-url").addEventListener("click", () => {
      navigator.clipboard?.writeText(fullUrl);
      document.getElementById("success-url").textContent = "✓ Copied!";
      setTimeout(() => { document.getElementById("success-url").textContent = fullUrl; }, 2000);
    });

    goTo(4);
  } catch (err) {
    errEl.textContent = err.message;
    step3NextBtn.disabled = false;
    step3Spinner.classList.add("hidden");
    step3Label.textContent = "Create My Binder";
  }
}

// Initial step — if we already have a token, skip to step 3
if (wizardData.token || netlifyIdentity.currentUser()) {
  if (wizardData.owner && wizardData.slug) goTo(3);
}
