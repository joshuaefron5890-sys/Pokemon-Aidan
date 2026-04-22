/* global netlifyIdentity */

// ── Shared chat state ───────────────────────────────────────
let history = [];
let pendingImage = null;

// ── Session management ──────────────────────────────────────
// We manage our own session under a separate key so netlifyIdentity's
// internal storage listener never fires spurious logout events.

const SESSION_KEY = "pokebinder.admin.session";

function getStoredSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s?.access_token || (s.expires_at || 0) <= Math.round(Date.now() / 1000)) return null;
    // Self-heal: old sessions may have been saved without user.email — decode JWT as fix
    if (!s.user?.email && s.access_token) {
      const claims = jwtClaims(s.access_token);
      if (claims?.email) {
        s.user = { id: claims.sub, email: claims.email, ...(s.user || {}) };
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
      }
    }
    // Don't gate on email presence — showAdmin() will recover it from the JWT
    return s;
  } catch {}
  return null;
}

function jwtClaims(token) {
  try {
    let b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - b64.length % 4) % 4);
    return JSON.parse(atob(b64));
  } catch { return null; }
}

function saveSession(data, knownEmail = null) {
  try {
    let user = data.user;
    // Ensure email is captured — try data.user, then JWT claims, then the typed email
    if (!user?.email) {
      const claims = data.access_token ? jwtClaims(data.access_token) : null;
      const email = claims?.email || knownEmail;
      if (email) user = { id: claims?.sub || user?.id, email, ...(user || {}) };
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...data, user,
      expires_at: Math.round(Date.now() / 1000) + (data.expires_in || 3600),
    }));
  } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

// Patch netlifyIdentity.currentUser() so all existing API call code works.
// We own the session entirely — ignore the widget's stored state.
netlifyIdentity.currentUser = () => {
  const session = getStoredSession();
  if (!session) return null;
  return { ...(session.user || {}), jwt: async () => getStoredSession()?.access_token || null };
};

// Build a user object that always has jwt() — reads token fresh from storage,
// falls back to the token captured at creation time.
function makeUserFromSession(session) {
  const captured = session.access_token || null;
  return {
    ...(session.user || {}),
    jwt: async () => getStoredSession()?.access_token || captured || null,
  };
}

// ── Binder URL map — must be declared before showAdmin is called ────────────
// Map known admin emails to their hardcoded binder URLs (legacy static binders).
const ADMIN_BINDER_MAP = {
  "joshuaefron5890@gmail.com": "/AidanEfron",
  "joshuaefron@yahoo.com":     "/binder/josh-efron",
  "callie.m.frisch@gmail.com": "/binder/callie-efron",
};

function binderUrlForUser(user) {
  if (!user) return null;
  if (user.user_metadata?.binder_url) return user.user_metadata.binder_url;
  const emailLow = user.email?.toLowerCase();
  if (emailLow && ADMIN_BINDER_MAP[emailLow]) return ADMIN_BINDER_MAP[emailLow];
  return null;
}

function isAidan(user) {
  return user?.email?.toLowerCase() === "joshuaefron5890@gmail.com";
}

// ── Navigation labels — must be declared before showAdmin is called ──────────
const VIEW_LABELS = {
  binder:    "My Binder",
  shared:    "Digital Binder Community",
  trades:    "Trade Proposals",
  offers:    "Offers Made",
  profile:   "My Profile",
};

// ── Auth: check stored session immediately (don't rely on widget init timing) ──
const _earlySession = getStoredSession();
if (_earlySession) {
  // admin.js loads at end of <body> so DOM is already ready — call directly
  showAdmin(makeUserFromSession(_earlySession));
}

netlifyIdentity.on("init", user => {
  if (_earlySession) return; // already handled above
  if (user) { showAdmin(user); return; }
  const patchedUser = netlifyIdentity.currentUser();
  if (patchedUser) { showAdmin(patchedUser); return; }
  showLogin();
});
netlifyIdentity.on("login", user => { netlifyIdentity.close(); showAdmin(user); });

// ── Custom inline login ─────────────────────────────────────
document.getElementById("login-btn").addEventListener("click", async () => {
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl  = document.getElementById("login-error");
  const label    = document.getElementById("login-label");
  const spinner  = document.getElementById("login-spinner");

  errorEl.textContent = "";
  if (!email || !password) { errorEl.textContent = "Please enter your email and password."; return; }

  document.getElementById("login-btn").disabled = true;
  label.classList.add("hidden");
  spinner.classList.remove("hidden");

  try {
    const res  = await fetch("/.netlify/identity/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=password&username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || "Invalid email or password.");

    saveSession(data, email); // pass typed email as fallback if GoTrue omits user.email
    // Spread full data.user so user_metadata.binder_url is preserved, then
    // override jwt() so it always reads a fresh token from storage.
    const freshToken = data.access_token;
    const loginUser = {
      ...(data.user || {}),
      email: data.user?.email || email,
      jwt:   async () => getStoredSession()?.access_token || freshToken || null,
    };
    showAdmin(loginUser);
  } catch (err) {
    errorEl.textContent = err.message;
    document.getElementById("login-btn").disabled = false;
    label.classList.remove("hidden");
    spinner.classList.add("hidden");
  }
});

document.getElementById("login-email")?.addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("login-password").focus();
});
document.getElementById("login-password")?.addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("login-btn").click();
});

function doLogout() {
  clearSession();
  try { netlifyIdentity.logout(); } catch {}
  showLogin();
}
document.getElementById("logout-btn").addEventListener("click", doLogout);
document.getElementById("profile-logout-btn").addEventListener("click", doLogout);

async function showAdmin(user) {
  if (!user) { showLogin(); return; }

  // If the user object has no email, decode it from the JWT access token as a last resort.
  // This handles the case where GoTrue omits user data in the token response or where
  // the netlifyIdentity widget overrides our currentUser() patch.
  if (!user.email && user.jwt) {
    try {
      const token = await user.jwt().catch(() => null);
      if (token) {
        const claims = jwtClaims(token);
        if (claims?.email) user = { ...user, email: claims.email, id: claims.sub || user.id };
      }
    } catch {}
  }

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("admin-app").classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email || "";
  const profileEmail = document.getElementById("profile-user-email");
  if (profileEmail) profileEmail.textContent = user.email;

  const aidan = isAidan(user);
  window.IS_AIDAN_ADMIN = aidan;

  let binderUrl = binderUrlForUser(user);
  const iframe  = document.getElementById("binder-iframe");
  const pubLink = document.getElementById("view-public-link");

  // Show the binder view immediately — don't wait for the async server lookup
  showView("binder");

  // If metadata/map lookup missed, query the server for a binder linked to this email
  let noBinderReason = "";
  if (!binderUrl && !aidan) {
    // Dark loading placeholder while we fetch
    iframe.srcdoc = `<!doctype html><html><head><meta charset="UTF-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#4a5680;font-family:system-ui,sans-serif;font-size:.9rem}</style></head><body>Loading binder…</body></html>`;
    try {
      const token = await user.jwt().catch(() => null);
      console.log("[admin] get-my-binder token present:", !!token, "email:", user.email);
      const res   = await fetch("/.netlify/functions/get-my-binder", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      console.log("[admin] get-my-binder status:", res.status);
      if (res.ok) {
        const data = await res.json();
        binderUrl = data.binderUrl;
        window.BINDER_SLUG = data.slug;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn("[admin] get-my-binder error:", errData);
        noBinderReason = res.status === 401 ? "auth" : "notfound";
      }
    } catch (err) {
      console.error("[admin] get-my-binder exception:", err);
      noBinderReason = "error";
    }
  }

  const createLink  = document.getElementById("create-binder-link");
  const noBinder    = document.getElementById("no-binder-panel");

  if (binderUrl) {
    if (noBinder)   { noBinder.style.display = "none"; noBinder.classList.add("hidden"); }
    if (createLink) createLink.classList.add("hidden");
    iframe.style.display = "";
    iframe.src = binderUrl;
    if (pubLink) pubLink.href = binderUrl;
  } else {
    // Hide iframe, show the native "Create Your Binder" panel
    iframe.style.display = "none";
    iframe.srcdoc = "";
    if (noBinder)   { noBinder.style.display = "flex"; noBinder.classList.remove("hidden"); }
    if (createLink) createLink.classList.remove("hidden");
    if (pubLink)    pubLink.href = "/create";
  }

  if (!window.BINDER_SLUG) {
    window.BINDER_SLUG = aidan ? "aidan"
      : binderUrl?.startsWith("/binder/") ? binderUrl.replace("/binder/", "")
      : null;
  }
}

function showLogin() {
  document.getElementById("admin-app").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

// ── Navigation ──────────────────────────────────────────────

function showView(id) {
  // Hide all views
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  // Show target
  const target = document.getElementById(`view-${id}`);
  if (target) target.classList.remove("hidden");

  // Update nav active state
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === id);
  });

  // Update mobile title
  const mobileTitle = document.getElementById("mobile-title");
  if (mobileTitle) mobileTitle.textContent = VIEW_LABELS[id] || id;

  // Close sidebar on mobile
  document.getElementById("sidebar").classList.remove("open");
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === "shared")  { loadSharedBinders(); loadFavorites(); }
    if (btn.dataset.view === "trades")    loadTradeProposals();
    if (btn.dataset.view === "offers")    loadOffersView();
    if (btn.dataset.view === "profile")   loadProfileView();
  });
});

// ── Community tab switching ─────────────────────────────────
document.querySelectorAll(".community-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".community-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".community-tab-panel").forEach(p => p.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(`community-panel-${tab.dataset.communityTab}`)?.classList.remove("hidden");
    if (tab.dataset.communityTab === "forsale") loadForSale();
  });
});

// ── Dynamic binder gallery ──────────────────────────────────

let sharedLoaded = false;

async function loadSharedBinders() {
  if (sharedLoaded) return;
  sharedLoaded = true;

  const grid = document.querySelector(".binders-grid");
  if (!grid) return;

  // Update location for static binder cards
  fetch(`/.netlify/functions/get-location?slug=aidan`)
    .then(r => r.ok ? r.json() : {})
    .then(loc => {
      if (loc.city) {
        const el = document.getElementById("aidan-shared-meta");
        if (el) el.textContent = `📍 ${loc.city}, ${loc.state}`;
      }
    }).catch(() => {});

  try {
    const res  = await fetch("/.netlify/functions/list-binders");
    const list = await res.json();
    if (!Array.isArray(list)) return;

    list.forEach(b => {
      // Skip slugs already shown as static cards
      if (grid.querySelector(`[href="/binder/${b.slug}"]`)) return;

      const initial = b.owner.charAt(0).toUpperCase();
      const colors  = ["#6366f1,#8b5cf6", "#f59e0b,#ef4444", "#10b981,#059669", "#3b82f6,#2563eb"];
      const grad    = colors[b.slug.charCodeAt(0) % colors.length];

      const card = document.createElement("a");
      card.className = "binder-card";
      card.href = `/binder/${b.slug}`;
      card.target = "_blank";
      card.rel = "noopener";
      card.innerHTML = `
        <div class="binder-card-avatar binder-card-avatar--photo" style="background:linear-gradient(135deg,${grad})">
          <img src="/.netlify/functions/get-photo?slug=${b.slug}" alt="${initial}"
            onerror="this.parentElement.classList.remove('binder-card-avatar--photo');this.parentElement.textContent='${initial}';this.remove()" />
        </div>
        <div class="binder-card-info">
          <div class="binder-card-name">${b.owner}'s Binder</div>
          <div class="binder-card-meta">${b.location?.city ? `📍 ${b.location.city}, ${b.location.state}` : 'Public collection'}</div>
        </div>
        <div class="binder-card-badge">View</div>`;
      grid.appendChild(card);
    });
  } catch {}
}

// ── My Favorites ────────────────────────────────────────────

function binderPageUrl(slug) {
  if (slug === "aidan") return "/AidanEfron";

  return `/binder/${slug}`;
}

async function loadFavorites() {
  const grid = document.getElementById("favorites-grid");
  if (!grid) return;
  grid.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Loading…</p>`;
  exitFavSelectMode();

  const selectBtn = document.getElementById("fav-select-btn");
  if (selectBtn) {
    selectBtn.style.display = "none";
    selectBtn.onclick = () => favSelectMode ? exitFavSelectMode() : enterFavSelectMode();
  }

  const bulkCancelBtn = document.getElementById("fav-bulk-cancel-btn");
  const bulkTradeBtn  = document.getElementById("fav-bulk-trade-btn");
  const bulkOfferBtn  = document.getElementById("fav-bulk-offer-btn");
  if (bulkCancelBtn) bulkCancelBtn.onclick = exitFavSelectMode;
  if (bulkTradeBtn) bulkTradeBtn.onclick = () => {
    if (!selectedFavs.size) return;
    exitFavSelectMode();
    openTradeDrawer([...selectedFavs.values()]);
  };
  if (bulkOfferBtn) bulkOfferBtn.onclick = () => {
    if (!selectedFavs.size) return;
    exitFavSelectMode();
    openOfferModal([...selectedFavs.values()]);
  };

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res   = await fetch("/.netlify/functions/get-favorites", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data  = await res.json();
    const cards = data.cards || [];

    if (!cards.length) {
      grid.innerHTML = `
        <div class="favorites-empty">
          <div class="favorites-empty-icon">♡</div>
          <div class="favorites-empty-title">No favorites yet</div>
          <p style="font-size:.85rem;color:var(--text-muted)">Visit a binder while logged in and tap the heart on any card.</p>
        </div>`;
      return;
    }

    if (selectBtn) selectBtn.style.display = "";

    grid.innerHTML = "";
    cards.forEach(card => {
      const key = card.cardId || card.query;
      const imgSrc = card.imageUrl || (() => {
        if (!card.cardId) return "";
        const i = card.cardId.lastIndexOf("-");
        return i < 0 ? "" : `https://images.pokemontcg.io/${card.cardId.slice(0, i)}/${card.cardId.slice(i + 1)}.png`;
      })();

      const el = document.createElement("div");
      el.className = "forsale-tile fav-tile";
      el.innerHTML = `
        <div class="forsale-tile-img-wrap">
          ${imgSrc
            ? `<img class="forsale-tile-img" src="${imgSrc}" alt="${card.name || card.query}" loading="lazy" data-pin-nopin="true"
                onerror="this.style.display='none'" />`
            : `<div class="forsale-tile-img-placeholder">${card.name || card.query}</div>`}
          <div class="fav-select-overlay" aria-hidden="true"></div>
          <div class="fav-tile-checkbox" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <button class="fav-tile-remove-btn" title="Remove from favorites">✕</button>
        </div>
        <div class="forsale-tile-info">
          <div class="forsale-tile-name">${card.name || card.query}</div>
          <div class="forsale-tile-meta">From: <a href="${binderPageUrl(card.binderSlug)}" target="_blank" rel="noopener">${card.binderOwner || card.binderSlug}'s Binder</a></div>
        </div>
        <div class="forsale-tile-actions">
          <button class="fav-trade-btn forsale-contact-btn" title="Propose a trade">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>Trade</span>
          </button>
          <button class="fav-offer-btn forsale-contact-btn" title="Make a price offer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Offer</span>
          </button>
        </div>`;

      el.addEventListener("click", e => {
        if (!favSelectMode) return;
        if (e.target.closest(".forsale-tile-actions") || e.target.closest(".fav-tile-remove-btn")) return;
        if (selectedFavs.has(key)) {
          selectedFavs.delete(key);
          el.classList.remove("fav-selected");
        } else {
          selectedFavs.set(key, card);
          el.classList.add("fav-selected");
        }
        renderFavBulkBar();
      });

      el.querySelector(".fav-trade-btn").addEventListener("click", () => openTradeDrawer([card]));
      el.querySelector(".fav-offer-btn").addEventListener("click", () => openOfferModal([card]));
      el.querySelector(".fav-tile-remove-btn").addEventListener("click", () => removeFavorite(card, el));
      grid.appendChild(el);
    });
  } catch (err) {
    grid.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Failed to load favorites: ${err.message}</p>`;
  }
}

async function removeFavorite(card, el) {
  el.style.opacity = ".4";
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res   = await fetch("/.netlify/functions/update-favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "remove", card }),
    });
    if (!res.ok) throw new Error("Failed");
    el.remove();
    const grid = document.getElementById("favorites-grid");
    if (grid && !grid.querySelector(".fav-item")) {
      grid.innerHTML = `
        <div class="favorites-empty">
          <div class="favorites-empty-icon">♡</div>
          <div class="favorites-empty-title">No favorites yet</div>
          <p style="font-size:.85rem;color:var(--text-muted)">Visit a binder while logged in and tap the heart on any card.</p>
        </div>`;
    }
  } catch {
    el.style.opacity = "1";
  }
}

// ── Cards for Sale/Trade ────────────────────────────────────

let forSaleLoaded = false;

async function loadForSale() {
  if (forSaleLoaded) return;
  forSaleLoaded = true;

  const grid = document.getElementById("forsale-grid");
  if (!grid) return;
  grid.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Loading…</p>`;

  try {
    const res  = await fetch("/.netlify/functions/list-for-sale");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let { cards } = await res.json();

    // Exclude the logged-in user's own cards
    // binderUrlForUser returns a URL path like "/binder/josh-efron" or "/AidanEfron";
    // extract just the slug portion that matches binderSlug in the results
    const myPath = binderUrlForUser(netlifyIdentity.currentUser()) || "";
    const mySlug = myPath.startsWith("/binder/") ? myPath.slice("/binder/".length) : null;
    if (mySlug) cards = cards.filter(c => c.binderSlug !== mySlug);

    if (!cards.length) {
      forSaleLoaded = false; // allow retry in case cards get added
      grid.innerHTML = `
        <div class="favorites-empty">
          <div class="favorites-empty-icon">🏷️</div>
          <div class="favorites-empty-title">No cards listed yet</div>
          <p style="font-size:.85rem;color:var(--text-muted)">Cards marked for sale or trade will appear here.</p>
        </div>`;
      return;
    }

    grid.innerHTML = "";
    cards.forEach(card => {
      const imgSrc = card.imageUrl || (() => {
        if (!card.cardId) return "";
        const i = card.cardId.lastIndexOf("-");
        return i < 0 ? "" : `https://images.pokemontcg.io/${card.cardId.slice(0, i)}/${card.cardId.slice(i + 1)}.png`;
      })();

      const binderUrl = card.binderSlug === "aidan" ? "/AidanEfron" : `/binder/${card.binderSlug}`;

      const el = document.createElement("div");
      const heartSvg = filled => `<svg width="12" height="12" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

      el.className = "forsale-tile";
      el.innerHTML = `
        <div class="forsale-tile-img-wrap">
          ${imgSrc
            ? `<img class="forsale-tile-img" src="${imgSrc}" alt="${card.name}" loading="lazy" data-pin-nopin="true"
                onerror="this.style.display='none'" />`
            : `<div class="forsale-tile-img-placeholder">${card.name}</div>`}
          <button class="forsale-heart-btn" title="Add to favorites">${heartSvg(false)}</button>
        </div>
        <div class="forsale-tile-info">
          <div class="forsale-tile-name">${card.name}${card.grade ? ` <span class="forsale-grade">${card.grade}</span>` : ""}</div>
          ${card.setName ? `<div class="forsale-tile-meta">${card.setName}</div>` : ""}
          <div class="forsale-tile-meta">From: <a href="${binderUrl}" target="_blank" rel="noopener">${card.binderOwner}'s Binder</a></div>
        </div>
        <div class="forsale-tile-actions">
          <button class="fav-trade-btn forsale-contact-btn" title="Propose a trade">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            <span>Trade</span>
          </button>
          <button class="fav-offer-btn forsale-contact-btn" title="Make a price offer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Offer</span>
          </button>
        </div>`;

      el.querySelector(".fav-trade-btn").addEventListener("click", () => openTradeDrawer([card]));
      el.querySelector(".fav-offer-btn").addEventListener("click", () => openOfferModal([card]));
      const heartBtn = el.querySelector(".forsale-heart-btn");
      heartBtn.addEventListener("click", async () => {
        if (heartBtn.disabled) return;
        const isFaved = heartBtn.classList.contains("faved");
        heartBtn.disabled = true;
        try {
          const user  = netlifyIdentity.currentUser();
          const token = user ? await user.jwt() : null;
          const res   = await fetch("/.netlify/functions/update-favorites", {
            method:  "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body:    JSON.stringify({ action: isFaved ? "remove" : "add", card }),
          });
          if (!res.ok) throw new Error("Failed");
          heartBtn.classList.toggle("faved", !isFaved);
          heartBtn.innerHTML = heartSvg(!isFaved);
          heartBtn.title = !isFaved ? "Remove from favorites" : "Add to favorites";
          heartBtn.classList.add("fav-pulse");
          heartBtn.addEventListener("animationend", () => heartBtn.classList.remove("fav-pulse"), { once: true });
        } catch { /* leave state unchanged */ }
        heartBtn.disabled = false;
      });
      grid.appendChild(el);
    });
  } catch (err) {
    grid.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Failed to load: ${err.message}</p>`;
    forSaleLoaded = false;
  }
}

// Group an array of cards by their binderSlug
function groupByBinder(cards) {
  return cards.reduce((groups, card) => {
    const slug = card.binderSlug;
    (groups[slug] = groups[slug] || []).push(card);
    return groups;
  }, {});
}

// ── Favorites multi-select ────────────────────────────────────

let favSelectMode = false;
const selectedFavs = new Map(); // key: cardId||query → card object

function enterFavSelectMode() {
  favSelectMode = true;
  document.getElementById("fav-select-btn").textContent = "Done";
  document.getElementById("favorites-grid").classList.add("fav-select-active");
  renderFavBulkBar();
}

function exitFavSelectMode() {
  favSelectMode = false;
  selectedFavs.clear();
  document.getElementById("fav-select-btn").textContent = "Select Multiple";
  document.getElementById("favorites-grid").classList.remove("fav-select-active");
  document.querySelectorAll(".fav-tile.fav-selected").forEach(el => el.classList.remove("fav-selected"));
  renderFavBulkBar();
}

function renderFavBulkBar() {
  const bar = document.getElementById("fav-bulk-bar");
  if (!bar) return;
  const n = selectedFavs.size;
  if (!favSelectMode || n === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  document.getElementById("fav-bulk-count").textContent = `${n} card${n !== 1 ? "s" : ""} selected`;
}

// ── Trade Drawer ─────────────────────────────────────────────

let tradeDrawerCards = [];       // array of wanted cards (1 for single, N for bulk)
let myCards          = [];       // user's binder cards (loaded once per drawer open)
let selectedOffers   = new Map(); // key: cardId||query → card object

// ── Load the current user's binder cards ──────────────────────

async function loadMyCards() {
  const slug = window.BINDER_SLUG;
  if (!slug) return [];
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res = await fetch(`/.netlify/functions/get-binder?slug=${encodeURIComponent(slug)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.cards || []).map(normalizeCard);
  } catch { return []; }
}

function normalizeCard(entry) {
  if (typeof entry === "string") return { query: entry, cardId: "", imageUrl: "", tcgUrl: "" };
  return { query: entry.query || "", cardId: entry.cardId || "", imageUrl: entry.imageUrl || "", tcgUrl: entry.tcgUrl || "" };
}

function cardThumb(card) {
  if (card.imageUrl) return card.imageUrl;
  if (card.cardId) {
    const i = card.cardId.lastIndexOf("-");
    if (i >= 0) return `https://images.pokemontcg.io/${card.cardId.slice(0, i)}/${card.cardId.slice(i + 1)}.png`;
  }
  return "";
}

// ── Card picker ───────────────────────────────────────────────

function filterCardResults() {
  const q       = document.getElementById("trade-card-search").value.trim().toLowerCase();
  const results = document.getElementById("trade-card-results");
  if (!q) { results.innerHTML = ""; results.classList.add("hidden"); return; }

  const matches = myCards.filter(c => c.query.toLowerCase().includes(q)).slice(0, 8);

  if (!matches.length) {
    results.innerHTML = `<div class="trade-no-results">No cards in your binder match "${document.getElementById("trade-card-search").value.trim()}"</div>`;
    results.classList.remove("hidden");
    return;
  }

  results.innerHTML = "";
  matches.forEach(card => {
    const key        = card.cardId || card.query;
    const isSelected = selectedOffers.has(key);
    const img        = cardThumb(card);

    const item = document.createElement("div");
    item.className = `trade-result-item${isSelected ? " selected" : ""}`;
    item.innerHTML = `
      ${img ? `<img src="${img}" alt="" class="trade-result-img" loading="lazy" />` : `<div class="trade-result-img-placeholder"></div>`}
      <span class="trade-result-name">${card.query}</span>
      ${isSelected ? `<svg class="trade-result-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>` : ""}`;

    item.addEventListener("click", () => {
      if (isSelected) removeOfferedCard(key);
      else { selectOfferedCard(card); document.getElementById("trade-card-search").value = ""; results.classList.add("hidden"); }
      filterCardResults();
    });
    results.appendChild(item);
  });
  results.classList.remove("hidden");
}

function selectOfferedCard(card) {
  selectedOffers.set(card.cardId || card.query, card);
  renderOfferedChips();
}

function removeOfferedCard(key) {
  selectedOffers.delete(key);
  renderOfferedChips();
  filterCardResults();
}

function renderOfferedChips() {
  const chips = document.getElementById("trade-offered-chips");
  chips.innerHTML = "";
  selectedOffers.forEach((card, key) => {
    const chip = document.createElement("div");
    chip.className = "trade-offered-chip";
    const img = cardThumb(card);
    chip.innerHTML = `
      ${img ? `<img src="${img}" alt="" class="trade-chip-img" />` : ""}
      <span class="trade-chip-name">${card.query}</span>
      <button class="trade-chip-remove" aria-label="Remove">✕</button>`;
    chip.querySelector(".trade-chip-remove").addEventListener("click", () => removeOfferedCard(key));
    chips.appendChild(chip);
  });
}

// ── Drawer open / close ───────────────────────────────────────

async function openTradeDrawer(cards) {
  tradeDrawerCards = Array.isArray(cards) ? cards : [cards];
  selectedOffers.clear();
  renderOfferedChips();

  // Populate "you want" preview — show all selected cards
  const wantedEl = document.getElementById("trade-wanted-card");
  const binderGroups = groupByBinder(tradeDrawerCards);
  const binderCount = Object.keys(binderGroups).length;

  wantedEl.innerHTML = tradeDrawerCards.map(card => {
    const imgSrc = card.imageUrl || (() => {
      if (!card.cardId) return "";
      const i = card.cardId.lastIndexOf("-");
      return i < 0 ? "" : `https://images.pokemontcg.io/${card.cardId.slice(0, i)}/${card.cardId.slice(i + 1)}.png`;
    })();
    return `
      <div class="trade-wanted-row">
        ${imgSrc ? `<img src="${imgSrc}" alt="${card.name || card.query}" class="trade-wanted-img" />` : ""}
        <div class="trade-wanted-info">
          <div class="trade-wanted-name">${card.name || card.query}</div>
          <div class="trade-wanted-binder">From: ${card.binderOwner || card.binderSlug}'s Binder</div>
        </div>
      </div>`;
  }).join("");

  // Show multi-binder notice
  const errEl = document.getElementById("trade-error");
  if (binderCount > 1) {
    errEl.textContent = `Note: This will send ${binderCount} separate trade proposals (one per binder).`;
    errEl.classList.remove("hidden");
    errEl.style.color = "var(--accent)";
  } else {
    errEl.classList.add("hidden");
    errEl.style.color = "";
  }

  document.getElementById("trade-card-search").value = "";
  document.getElementById("trade-card-results").innerHTML = "";
  document.getElementById("trade-card-results").classList.add("hidden");
  document.getElementById("trade-message").value = "";
  document.getElementById("trade-drawer-backdrop").classList.remove("hidden");
  document.getElementById("trade-drawer").classList.remove("hidden");

  // Load user's binder cards
  myCards = await loadMyCards();
  document.getElementById("trade-no-cards-msg").classList.toggle("hidden", myCards.length > 0);
  document.getElementById("trade-card-search").focus();
}

function closeTradeDrawer() {
  document.getElementById("trade-drawer-backdrop").classList.add("hidden");
  document.getElementById("trade-drawer").classList.add("hidden");
  tradeDrawerCards = [];
}

document.getElementById("trade-card-search").addEventListener("input", filterCardResults);
document.getElementById("trade-card-search").addEventListener("keydown", e => {
  if (e.key === "Escape") { document.getElementById("trade-card-results").classList.add("hidden"); }
});
document.getElementById("trade-drawer-close").addEventListener("click", closeTradeDrawer);
document.getElementById("trade-drawer-backdrop").addEventListener("click", closeTradeDrawer);

document.getElementById("trade-submit-btn").addEventListener("click", async () => {
  const offeredCards = [...selectedOffers.values()].map(c => ({
    query:    c.query    || "",
    cardId:   c.cardId   || "",
    imageUrl: c.imageUrl || "",
    tcgUrl:   c.tcgUrl   || "",
  }));

  const errEl = document.getElementById("trade-error");
  if (!offeredCards.length) {
    errEl.textContent = "Select at least one card from your collection to offer.";
    errEl.classList.remove("hidden");
    errEl.style.color = "";
    return;
  }

  const btn = document.getElementById("trade-submit-btn");
  btn.disabled = true;
  btn.textContent = "Sending…";
  errEl.classList.add("hidden");

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const message = document.getElementById("trade-message").value.trim();

    // Group wanted cards by binder — one trade proposal per binder
    const binderGroups = groupByBinder(tradeDrawerCards);
    await Promise.all(
      Object.values(binderGroups).map(wantedCards =>
        fetch("/.netlify/functions/create-trade", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ wantedCards, offeredCards, message }),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
      )
    );
    closeTradeDrawer();
    showView("trades");
    loadTradeProposals();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    errEl.style.color = "";
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Trade Proposal";
  }
});

// ── Trade Proposals View ──────────────────────────────────────

function tradeStatusBadge(status) {
  const map = {
    pending:   ["#f59e0b", "Pending"],
    accepted:  ["#10b981", "Accepted"],
    rejected:  ["#ef4444", "Rejected"],
    withdrawn: ["#6b7280", "Withdrawn"],
  };
  const [color, label] = map[status] || ["#6b7280", status];
  return `<span class="trade-status-badge" style="background:${color}22;color:${color};border-color:${color}44">${label}</span>`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function loadTradeProposals() {
  const container = document.getElementById("trades-content");
  container.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Loading…</p>`;

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const slug  = window.BINDER_SLUG || "";
    const res   = await fetch(`/.netlify/functions/get-trades?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sent, received: allReceived } = await res.json();
    const received = allReceived.filter(t => t.status !== "withdrawn");

    if (!sent.length && !received.length) {
      container.innerHTML = `
        <div class="favorites-empty">
          <div class="favorites-empty-icon" style="font-size:2rem">⇄</div>
          <div class="favorites-empty-title">No trade proposals yet</div>
          <p style="font-size:.85rem;color:var(--text-muted)">Favorite a card and click "Propose Trade" to get started.</p>
        </div>`;
      return;
    }

    container.innerHTML = "";

    if (received.length) {
      container.insertAdjacentHTML("beforeend", `<div class="trades-section-label">Received</div>`);
      received.forEach(trade => {
        const el = buildTradeCard(trade, "received");
        container.appendChild(el);
        if (["pending", "accepted"].includes(trade.status)) {
          loadTradeMessages(trade.id, el.querySelector(".trade-chat-msgs"));
        }
      });
    }

    if (sent.length) {
      container.insertAdjacentHTML("beforeend", `<div class="trades-section-label" style="margin-top:1.5rem">Sent by You</div>`);
      sent.forEach(trade => {
        const el = buildTradeCard(trade, "sent");
        container.appendChild(el);
        if (["pending", "accepted"].includes(trade.status)) {
          loadTradeMessages(trade.id, el.querySelector(".trade-chat-msgs"));
        }
      });
    }
  } catch (err) {
    container.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Failed to load: ${err.message}</p>`;
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

async function loadTradeMessages(tradeId, msgsEl) {
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const slug  = encodeURIComponent(window.BINDER_SLUG || "");
    const res   = await fetch(`/.netlify/functions/get-trade-messages?tradeId=${encodeURIComponent(tradeId)}&mySlug=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error();
    const messages = await res.json();
    renderTradeMessages(messages, msgsEl, user?.id);
  } catch {
    msgsEl.innerHTML = `<p class="trade-chat-empty">Could not load messages.</p>`;
  }
}

function renderTradeMessages(messages, msgsEl, myId) {
  if (!messages.length) {
    msgsEl.innerHTML = `<p class="trade-chat-empty">No messages yet — start the conversation!</p>`;
    return;
  }
  msgsEl.innerHTML = messages.map(msg => {
    const mine = msg.senderId === myId;
    const time = new Date(msg.timestamp).toLocaleTimeString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `<div class="trade-chat-msg ${mine ? "mine" : "theirs"}">
      <span class="trade-chat-sender">${mine ? "You" : escHtml(msg.senderEmail)}</span>
      <div class="trade-chat-bubble">${escHtml(msg.text)}</div>
      <span class="trade-chat-time">${time}</span>
    </div>`;
  }).join("");
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function sendTradeMessage(tradeId, inputEl, msgsEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  inputEl.disabled = true;
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res   = await fetch("/.netlify/functions/send-trade-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tradeId, mySlug: window.BINDER_SLUG || "", text }),
    });
    if (!res.ok) throw new Error();
    await loadTradeMessages(tradeId, msgsEl);
  } catch {
    inputEl.value = text;
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
}

function buildTradeCard(trade, direction) {
  // Support both wantedCards (array) and legacy wantedCard (single)
  const wantedCards = trade.wantedCards || (trade.wantedCard ? [trade.wantedCard] : []);
  const card = wantedCards[0] || {};

  const el = document.createElement("div");
  el.className = "trade-card-item";
  el.dataset.tradeId = trade.id;

  const heading = direction === "received"
    ? `<strong>${trade.initiatorName}</strong> wants ${wantedCards.length > 1 ? "these cards" : "your card"}:`
    : `You want${wantedCards.length > 1 ? ` (${wantedCards.length} cards)` : ""}:`;

  const wantedHtml = wantedCards.map(c => {
    const imgSrc = c.imageUrl || (() => {
      if (!c.cardId) return "";
      const i = c.cardId.lastIndexOf("-");
      return i < 0 ? "" : `https://images.pokemontcg.io/${c.cardId.slice(0, i)}/${c.cardId.slice(i + 1)}.png`;
    })();
    return `
      <div class="trade-wanted-row">
        ${imgSrc ? `<img src="${imgSrc}" alt="${c.name || c.query}" class="trade-card-img" />` : ""}
        <div class="trade-card-info">
          <div class="trade-card-name">${c.name || c.query}</div>
          <div class="trade-card-binder">From: ${c.binderOwner || c.binderSlug}'s Binder</div>
        </div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="trade-card-top">
      <div class="trade-card-preview">
        <div class="trade-card-info"><div class="trade-card-heading">${heading}</div></div>
        ${wantedHtml}
      </div>
      <div class="trade-card-meta">
        ${tradeStatusBadge(trade.status)}
        <span class="trade-card-date">${fmtDate(trade.createdAt)}</span>
      </div>
    </div>
    <div class="trade-card-offers">
      <span class="trade-offers-label">${direction === "received" ? "They offer:" : "You offered:"}</span>
      ${trade.offeredCards.map(c => {
        if (typeof c === "string") return `<span class="trade-offer-pill">${c}</span>`;
        const imgSrc = c.imageUrl || (c.cardId ? (() => {
          const i = c.cardId.lastIndexOf("-");
          return i < 0 ? "" : `https://images.pokemontcg.io/${c.cardId.slice(0, i)}/${c.cardId.slice(i + 1)}.png`;
        })() : "");
        const inner = imgSrc
          ? `<img src="${imgSrc}" alt="${c.query}" class="trade-offer-thumb" loading="lazy" /><span class="trade-offer-pill-name">${c.query}</span>`
          : `<span class="trade-offer-pill-name">${c.query}</span>`;
        return c.tcgUrl
          ? `<a href="${c.tcgUrl}" target="_blank" rel="noopener" class="trade-offer-card">${inner}</a>`
          : `<span class="trade-offer-card">${inner}</span>`;
      }).join("")}
    </div>
    ${trade.message ? `<div class="trade-card-message">"${trade.message}"</div>` : ""}
    <div class="trade-card-actions"></div>`;

  const actionsEl = el.querySelector(".trade-card-actions");

  if (trade.status === "pending") {
    if (direction === "sent") {
      const wdBtn = document.createElement("button");
      wdBtn.className = "trade-action-btn trade-action-withdraw";
      wdBtn.textContent = "Withdraw";
      wdBtn.addEventListener("click", () => doTradeAction(trade.id, "withdraw", null, el));
      actionsEl.appendChild(wdBtn);
    } else {
      const acceptBtn = document.createElement("button");
      acceptBtn.className = "trade-action-btn trade-action-accept";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", () => doTradeAction(trade.id, "accept", window.BINDER_SLUG, el));

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "trade-action-btn trade-action-reject";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", () => doTradeAction(trade.id, "reject", window.BINDER_SLUG, el));

      actionsEl.appendChild(acceptBtn);
      actionsEl.appendChild(rejectBtn);
    }
  }

  if (trade.status === "withdrawn" && direction === "sent") {
    const rmBtn = document.createElement("button");
    rmBtn.className = "trade-action-btn trade-action-withdraw";
    rmBtn.textContent = "Remove";
    rmBtn.addEventListener("click", () => doTradeAction(trade.id, "delete", null, el));
    actionsEl.appendChild(rmBtn);
  }

  if (["accepted", "rejected"].includes(trade.status)) {
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "trade-action-btn trade-action-withdraw";
    dismissBtn.textContent = "Remove";
    dismissBtn.addEventListener("click", () =>
      doTradeAction(trade.id, "dismiss", direction === "received" ? window.BINDER_SLUG : null, el)
    );
    actionsEl.appendChild(dismissBtn);
  }

  // Chat section for active trades
  if (["pending", "accepted"].includes(trade.status)) {
    const chatEl = document.createElement("div");
    chatEl.className = "trade-chat";
    chatEl.innerHTML = `
      <div class="trade-chat-label">Messages</div>
      <div class="trade-chat-msgs"><p class="trade-chat-empty">Loading…</p></div>
      <div class="trade-chat-compose">
        <input class="trade-chat-input" type="text" placeholder="Type a message…" autocomplete="off" />
        <button class="trade-chat-send">Send</button>
      </div>`;

    const input   = chatEl.querySelector(".trade-chat-input");
    const sendBtn = chatEl.querySelector(".trade-chat-send");
    const msgsEl  = chatEl.querySelector(".trade-chat-msgs");

    const doSend = () => {
      if (input.value.trim()) sendTradeMessage(trade.id, input, msgsEl);
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    sendBtn.addEventListener("click", doSend);

    el.appendChild(chatEl);
  }

  return el;
}

function showSwapPrompt(el, message, onYes, onNo) {
  const actionsEl = el.querySelector(".trade-card-actions");
  if (!actionsEl) return;
  actionsEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "swap-prompt";
  wrap.innerHTML = `<p class="swap-prompt-text">${message}</p>`;

  const yesBtn = document.createElement("button");
  yesBtn.className = "trade-action-btn trade-action-accept";
  yesBtn.textContent = "Yes, update binders";
  yesBtn.addEventListener("click", async () => {
    yesBtn.disabled = true; noBtn.disabled = true;
    yesBtn.textContent = "Updating…";
    await onYes();
  });

  const noBtn = document.createElement("button");
  noBtn.className = "trade-action-btn trade-action-secondary";
  noBtn.textContent = "Not now";
  noBtn.addEventListener("click", onNo);

  wrap.appendChild(yesBtn);
  wrap.appendChild(noBtn);
  actionsEl.appendChild(wrap);
}

async function doTradeAction(tradeId, action, binderSlug, el) {
  el.style.opacity = ".5";
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res = await fetch("/.netlify/functions/update-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tradeId, action, binderSlug }),
    });
    if (!res.ok) throw new Error("Failed");
    el.style.opacity = "1";
    if (action === "delete") {
      el.remove();
    } else if (action === "accept") {
      showSwapPrompt(
        el,
        "Update binders to reflect the trade?",
        async () => {
          const freshToken = await netlifyIdentity.currentUser()?.jwt();
          const swapRes = await fetch("/.netlify/functions/execute-trade-swap", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
            body: JSON.stringify({ tradeId, recipientSlug: binderSlug }),
          });
          const swapData = await swapRes.json();
          if (!swapRes.ok) {
            alert(swapData.error || "Swap failed. You can update your binder manually.");
          }
          loadTradeProposals();
        },
        () => loadTradeProposals()
      );
    } else {
      loadTradeProposals();
    }
  } catch {
    el.style.opacity = "1";
  }
}

// Mobile sidebar toggle
document.getElementById("hamburger")?.addEventListener("click", () =>
  document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("sidebar-close")?.addEventListener("click", () =>
  document.getElementById("sidebar").classList.remove("open"));

// ── Image handling (shared) ─────────────────────────────────

document.getElementById("image-upload").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) readImage(file);
});
document.getElementById("remove-image").addEventListener("click", clearImage);

document.addEventListener("paste", e => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith("image/"));
  if (item) readImage(item.getAsFile());
});

function readImage(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const [, data] = ev.target.result.split(",");
    pendingImage = { data, mediaType: file.type };
    document.getElementById("preview-img").src = ev.target.result;
    document.getElementById("popup-preview-img").src = ev.target.result;
    document.getElementById("image-preview-row").classList.remove("hidden");
    document.getElementById("popup-image-preview-row").classList.remove("hidden");
    updateSendBtns();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  pendingImage = null;
  document.getElementById("image-preview-row").classList.add("hidden");
  document.getElementById("popup-image-preview-row").classList.add("hidden");
  document.getElementById("image-upload").value = "";
  document.getElementById("popup-image-upload").value = "";
  updateSendBtns();
}

document.getElementById("popup-remove-image").addEventListener("click", clearImage);

// ── Chat inputs (sidebar assistant) ────────────────────────

const chatInput = document.getElementById("chat-input");
const sendBtn   = document.getElementById("send-btn");

chatInput.addEventListener("input", () => {
  updateSendBtns();
  autoResize(chatInput);
});
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(false); }
});
sendBtn.addEventListener("click", () => sendMessage(false));

// ── Chat inputs (floating popup) ───────────────────────────

const popupInput   = document.getElementById("popup-chat-input");
const popupSendBtn = document.getElementById("popup-send-btn");

popupInput.addEventListener("input", () => {
  updateSendBtns();
  autoResize(popupInput);
});
popupInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!popupSendBtn.disabled) sendMessage(true); }
});
popupSendBtn.addEventListener("click", () => sendMessage(true));

document.getElementById("popup-image-upload").addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) readImage(file);
});

function updateSendBtns() {
  sendBtn.disabled      = !(chatInput.value.trim()   || pendingImage);
  popupSendBtn.disabled = !(popupInput.value.trim()  || pendingImage);
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// ── Floating chat bubble ────────────────────────────────────

const bubble  = document.getElementById("chat-bubble");
const popup   = document.getElementById("chat-popup");
const popupClose = document.getElementById("popup-close");

bubble.addEventListener("click", () => {
  const isOpen = popup.classList.toggle("open");
  bubble.classList.toggle("active", isOpen);
  if (isOpen) popupInput.focus();
});

popupClose.addEventListener("click", () => {
  popup.classList.remove("open");
  bubble.classList.remove("active");
});

document.getElementById("popup-fullscreen")?.addEventListener("click", () => {
  popup.classList.remove("open");
  bubble.classList.remove("active");
  showView("assistant");
});

// ── Make an Offer modal ──────────────────────────────────────

let offerTargetCards = [];

function openOfferModal(cardsOrCard) {
  offerTargetCards = Array.isArray(cardsOrCard) ? cardsOrCard : [cardsOrCard];

  // Build preview: show all cards (scrollable if many)
  document.getElementById("offer-card-preview").innerHTML = offerTargetCards.map(card => {
    const imgSrc = card.imageUrl || (() => {
      if (!card.cardId) return "";
      const i = card.cardId.lastIndexOf("-");
      return i < 0 ? "" : `https://images.pokemontcg.io/${card.cardId.slice(0, i)}/${card.cardId.slice(i + 1)}.png`;
    })();
    return `
      <div class="offer-card-preview-inner">
        ${imgSrc ? `<img src="${imgSrc}" alt="${card.name || card.query}" class="offer-preview-img" />` : ""}
        <div>
          <div class="offer-preview-name">${card.name || card.query}</div>
          <div class="offer-preview-binder">From: ${card.binderOwner || card.binderSlug}'s Binder</div>
        </div>
      </div>`;
  }).join("");

  const binderCount = Object.keys(groupByBinder(offerTargetCards)).length;
  const errEl = document.getElementById("offer-error");
  if (binderCount > 1) {
    errEl.textContent = `Note: This will send ${binderCount} separate offers (one per binder).`;
    errEl.style.color = "var(--accent)";
  } else {
    errEl.textContent = "";
    errEl.style.color = "";
  }

  // Update label to reflect total vs single
  const label = document.querySelector(".offer-field-label");
  if (label) label.textContent = offerTargetCards.length > 1 ? `Your Total Offer (USD)` : `Your Offer (USD)`;

  document.getElementById("offer-price-input").value = "";
  document.getElementById("offer-message-input").value = "";
  document.getElementById("offer-modal-backdrop").classList.remove("hidden");
  document.getElementById("offer-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("offer-price-input").focus(), 50);
}

function closeOfferModal() {
  document.getElementById("offer-modal-backdrop").classList.add("hidden");
  document.getElementById("offer-modal").classList.add("hidden");
  offerTargetCards = [];
}

document.getElementById("offer-modal-close").addEventListener("click", closeOfferModal);
document.getElementById("offer-cancel-btn").addEventListener("click", closeOfferModal);
document.getElementById("offer-modal-backdrop").addEventListener("click", closeOfferModal);

document.getElementById("offer-submit-btn").addEventListener("click", async () => {
  const errEl    = document.getElementById("offer-error");
  const price    = parseFloat(document.getElementById("offer-price-input").value);
  const msg      = document.getElementById("offer-message-input").value.trim();
  const submitBtn = document.getElementById("offer-submit-btn");

  if (!offerTargetCards.length) return;
  if (!price || price <= 0) {
    errEl.textContent = "Please enter a valid offer amount.";
    errEl.style.color = "";
    return;
  }

  errEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const token = await netlifyIdentity.currentUser()?.jwt();

    // Group by binder — one offer per binder
    const binderGroups = groupByBinder(offerTargetCards);
    await Promise.all(
      Object.values(binderGroups).map(cards =>
        fetch("/.netlify/functions/create-offer", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ cards, price, message: msg }),
        }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
      )
    );
    closeOfferModal();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.color = "";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Offer";
  }
});

// ── Offer chat ────────────────────────────────────────────────

async function loadOfferMessages(offerId, msgsEl) {
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const slug  = encodeURIComponent(window.BINDER_SLUG || "");
    const res   = await fetch(`/.netlify/functions/get-offer-messages?offerId=${encodeURIComponent(offerId)}&mySlug=${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error();
    const messages = await res.json();
    renderTradeMessages(messages, msgsEl, user?.id);
  } catch {
    msgsEl.innerHTML = `<p class="trade-chat-empty">Could not load messages.</p>`;
  }
}

async function sendOfferMessage(offerId, inputEl, msgsEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  inputEl.disabled = true;
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res   = await fetch("/.netlify/functions/send-offer-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ offerId, mySlug: window.BINDER_SLUG || "", text }),
    });
    if (!res.ok) throw new Error();
    await loadOfferMessages(offerId, msgsEl);
  } catch {
    inputEl.value = text;
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
}

// ── Offers Made view ─────────────────────────────────────────

async function loadOffersView() {
  const container = document.getElementById("offers-content");
  container.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Loading…</p>`;

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const slug  = window.BINDER_SLUG || "";
    const res   = await fetch(`/.netlify/functions/get-offers?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { sent, received: allReceived } = await res.json();
    const received = allReceived.filter(o => o.status !== "withdrawn");

    if (!sent.length && !received.length) {
      container.innerHTML = `
        <div class="favorites-empty">
          <div class="favorites-empty-icon" style="font-size:2rem">$</div>
          <div class="favorites-empty-title">No offers yet</div>
          <p style="font-size:.85rem;color:var(--text-muted)">Favorite a card and click "Make an Offer" to get started.</p>
        </div>`;
      return;
    }

    container.innerHTML = "";

    if (received.length) {
      container.insertAdjacentHTML("beforeend", `<div class="trades-section-label">Received</div>`);
      received.forEach(offer => {
        const el = buildOfferCard(offer, "received");
        container.appendChild(el);
        if (["pending", "accepted"].includes(offer.status)) {
          loadOfferMessages(offer.id, el.querySelector(".trade-chat-msgs"));
        }
      });
    }
    if (sent.length) {
      container.insertAdjacentHTML("beforeend", `<div class="trades-section-label" style="margin-top:1.5rem">Sent by You</div>`);
      sent.forEach(offer => {
        const el = buildOfferCard(offer, "sent");
        container.appendChild(el);
        if (["pending", "accepted"].includes(offer.status)) {
          loadOfferMessages(offer.id, el.querySelector(".trade-chat-msgs"));
        }
      });
    }
  } catch (err) {
    container.innerHTML = `<p style="padding:1.5rem;color:var(--text-muted)">Failed to load: ${err.message}</p>`;
  }
}

function buildOfferCard(offer, direction) {
  // Support both cards (array) and legacy card (single)
  const cards = offer.cards || (offer.card ? [offer.card] : []);
  const card = cards[0] || {};

  const heading = direction === "received"
    ? `<strong>${offer.initiatorEmail}</strong> wants ${cards.length > 1 ? `${cards.length} cards` : "your card"}:`
    : `You offered on${cards.length > 1 ? ` (${cards.length} cards)` : ""}:`;

  const cardsHtml = cards.map(c => {
    const imgSrc = c.imageUrl || (() => {
      if (!c.cardId) return "";
      const i = c.cardId.lastIndexOf("-");
      return i < 0 ? "" : `https://images.pokemontcg.io/${c.cardId.slice(0, i)}/${c.cardId.slice(i + 1)}.png`;
    })();
    return `
      <div class="trade-wanted-row">
        ${imgSrc ? `<img src="${imgSrc}" alt="${c.name || c.query}" class="trade-card-img" />` : ""}
        <div class="trade-card-info">
          <div class="trade-card-name">${c.name || c.query}</div>
          <div class="trade-card-binder">From: ${c.binderOwner || c.binderSlug}'s Binder</div>
        </div>
      </div>`;
  }).join("");

  const el = document.createElement("div");
  el.className = "trade-card-item";
  el.dataset.offerId = offer.id;

  el.innerHTML = `
    <div class="trade-card-top">
      <div class="trade-card-preview">
        <div class="trade-card-info"><div class="trade-card-heading">${heading}</div></div>
        ${cardsHtml}
      </div>
      <div class="trade-card-meta">
        ${tradeStatusBadge(offer.status)}
        <span class="trade-card-date">${fmtDate(offer.createdAt)}</span>
      </div>
    </div>
    <div class="offer-price-row">
      <span class="offer-price-label">${direction === "received" ? "Their offer:" : "Your offer:"}</span>
      <span class="offer-price-amount">$${Number(offer.price).toFixed(2)}</span>
    </div>
    ${offer.message ? `<div class="trade-card-message">"${offer.message}"</div>` : ""}
    <div class="trade-card-actions"></div>`;

  const actionsEl = el.querySelector(".trade-card-actions");

  if (offer.status === "pending") {
    if (direction === "sent") {
      const wdBtn = document.createElement("button");
      wdBtn.className = "trade-action-btn trade-action-withdraw";
      wdBtn.textContent = "Withdraw";
      wdBtn.addEventListener("click", () => doOfferAction(offer.id, "withdraw", null, el));
      actionsEl.appendChild(wdBtn);
    } else {
      const acceptBtn = document.createElement("button");
      acceptBtn.className = "trade-action-btn trade-action-accept";
      acceptBtn.textContent = "Accept";
      acceptBtn.addEventListener("click", () => doOfferAction(offer.id, "accept", window.BINDER_SLUG, el));
      const rejectBtn = document.createElement("button");
      rejectBtn.className = "trade-action-btn trade-action-reject";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", () => doOfferAction(offer.id, "reject", window.BINDER_SLUG, el));
      actionsEl.appendChild(acceptBtn);
      actionsEl.appendChild(rejectBtn);
    }
  }

  if (offer.status === "withdrawn" && direction === "sent") {
    const rmBtn = document.createElement("button");
    rmBtn.className = "trade-action-btn trade-action-withdraw";
    rmBtn.textContent = "Remove";
    rmBtn.addEventListener("click", () => doOfferAction(offer.id, "delete", null, el));
    actionsEl.appendChild(rmBtn);
  }

  if (["accepted", "rejected"].includes(offer.status)) {
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "trade-action-btn trade-action-withdraw";
    dismissBtn.textContent = "Remove";
    dismissBtn.addEventListener("click", () =>
      doOfferAction(offer.id, "dismiss", direction === "received" ? window.BINDER_SLUG : null, el)
    );
    actionsEl.appendChild(dismissBtn);
  }

  if (["pending", "accepted"].includes(offer.status)) {
    const chatEl = document.createElement("div");
    chatEl.className = "trade-chat";
    chatEl.innerHTML = `
      <div class="trade-chat-label">Messages</div>
      <div class="trade-chat-msgs"><p class="trade-chat-empty">Loading…</p></div>
      <div class="trade-chat-compose">
        <input class="trade-chat-input" type="text" placeholder="Type a message…" autocomplete="off" />
        <button class="trade-chat-send">Send</button>
      </div>`;
    const input   = chatEl.querySelector(".trade-chat-input");
    const sendBtn = chatEl.querySelector(".trade-chat-send");
    const msgsEl  = chatEl.querySelector(".trade-chat-msgs");
    sendBtn.addEventListener("click", () => { if (input.value.trim()) sendOfferMessage(offer.id, input, msgsEl); });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && input.value.trim()) sendOfferMessage(offer.id, input, msgsEl); });
    el.appendChild(chatEl);
  }

  return el;
}

async function doOfferAction(offerId, action, binderSlug, el) {
  el.style.opacity = ".5";
  try {
    const token = await netlifyIdentity.currentUser()?.jwt();
    const res = await fetch("/.netlify/functions/update-offer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ offerId, action, binderSlug }),
    });
    if (!res.ok) throw new Error("Failed");
    el.style.opacity = "1";
    if (action === "delete") {
      el.remove();
    } else if (action === "accept") {
      showSwapPrompt(
        el,
        "Remove these cards from your binder to reflect the sale?",
        async () => {
          const freshToken = await netlifyIdentity.currentUser()?.jwt();
          const swapRes = await fetch("/.netlify/functions/execute-offer-swap", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
            body: JSON.stringify({ offerId, recipientSlug: binderSlug }),
          });
          const swapData = await swapRes.json();
          if (!swapRes.ok) {
            alert(swapData.error || "Could not update binder. You can remove the cards manually.");
          }
          loadOffersView();
        },
        () => loadOffersView()
      );
    } else {
      loadOffersView();
    }
  } catch {
    el.style.opacity = "1";
  }
}

// ── My Profile view ─────────────────────────────────────────

let pendingLocation = null;

async function loadProfileView() {
  let slug = window.BINDER_SLUG;

  // If slug not resolved yet (showAdmin still in flight), look it up now
  if (!slug || slug === "aidan") {
    if (slug !== "aidan") {
      try {
        const user  = netlifyIdentity.currentUser();
        const token = user ? await user.jwt().catch(() => null) : null;
        const res   = await fetch("/.netlify/functions/get-my-binder", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          window.BINDER_SLUG = data.slug;
          slug = data.slug;
        }
      } catch {}
    }
  }

  // Profile photo — fetch via JS so we control success/failure reliably
  const img         = document.getElementById("profile-current-photo");
  const placeholder = document.getElementById("profile-photo-placeholder");
  img.style.display = "none";
  placeholder.style.display = "flex";
  if (slug) {
    try {
      const resp = await fetch(`/.netlify/functions/get-photo?slug=${encodeURIComponent(slug)}&_t=${Date.now()}`);
      if (resp.ok) {
        const blob = await resp.blob();
        if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(blob);
        img.style.display = "";
        placeholder.style.display = "none";
      }
    } catch { /* no photo — placeholder stays */ }
  }

  document.getElementById("profile-photo-status").textContent = "";
  document.getElementById("profile-location-status").textContent = "";
  document.getElementById("profile-privacy-status").textContent = "";

  // Load binder privacy state
  const privacyCard = document.getElementById("profile-privacy-card");
  if (slug && slug !== "aidan") {
    privacyCard?.classList.remove("hidden");
    try {
      const user  = netlifyIdentity.currentUser();
      const token = user ? await user.jwt().catch(() => null) : null;
      const res = await fetch(`/.netlify/functions/get-binder?slug=${encodeURIComponent(slug)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const val = data.public ? "public" : "private";
        const radio = document.querySelector(`input[name="binder-privacy"][value="${val}"]`);
        if (radio) radio.checked = true;
        document.getElementById("profile-save-privacy-btn").disabled = true;
      }
    } catch {}
  } else {
    privacyCard?.classList.add("hidden");
  }

  // Load saved location
  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res   = await fetch("/.netlify/functions/get-profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.location) {
        const { zip, city, state } = data.location;
        document.getElementById("profile-zip-input").value = zip || "";
        document.getElementById("profile-saved-city").textContent = `${city}, ${state}`;
        document.getElementById("profile-saved-location").classList.remove("hidden");
        if (zip) {
          document.getElementById("profile-city-name").textContent = `${city}, ${state}`;
          document.getElementById("profile-city-preview").classList.remove("hidden");
          pendingLocation = { zip, city, state };
          document.getElementById("profile-save-location-btn").disabled = false;
        }
        // Sync to public locations store in case this was saved before the locations store existed
        if (slug && city) {
          fetch("/.netlify/functions/update-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ location: { zip, city, state }, slug }),
          }).catch(() => {});
        }
      } else {
        document.getElementById("profile-saved-location").classList.add("hidden");
      }
    }
  } catch {}
}

// ── Photo change ──────────────────────────────────────────────

document.getElementById("profile-photo-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("profile-photo-status");
  statusEl.textContent = "Uploading…";

  try {
    const reader = new FileReader();
    const base64 = await new Promise((res, rej) => {
      reader.onload = ev => res(ev.target.result.split(",")[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    const slug  = window.BINDER_SLUG;
    if (!slug) throw new Error("No binder slug found.");
    const token = await netlifyIdentity.currentUser()?.jwt();
    const resp  = await fetch("/.netlify/functions/update-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, photo: base64 }),
    });
    if (!resp.ok) { const d = await resp.json(); throw new Error(d.error || "Upload failed"); }

    statusEl.textContent = "✓ Photo updated!";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);

    const img = document.getElementById("profile-current-photo");
    img.src = `/.netlify/functions/get-photo?slug=${slug}&_t=${Date.now()}`;
    img.style.display = "";
    document.getElementById("profile-photo-placeholder").style.display = "none";

    const iframe = document.getElementById("binder-iframe");
    const base = iframe.src.split("?")[0];
    iframe.src = `${base}?_t=${Date.now()}`;
    sharedLoaded = false;
  } catch (err) {
    statusEl.textContent = err.message;
  }
  e.target.value = "";
});

// ── Photo remove ──────────────────────────────────────────────

document.getElementById("profile-remove-photo-btn").addEventListener("click", async () => {
  if (!confirm("Remove your profile photo?")) return;
  const statusEl = document.getElementById("profile-photo-status");
  statusEl.textContent = "Removing…";
  try {
    const slug  = window.BINDER_SLUG;
    const token = await netlifyIdentity.currentUser()?.jwt();
    const resp  = await fetch("/.netlify/functions/remove-photo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug }),
    });
    if (!resp.ok) throw new Error((await resp.json()).error || "Failed");

    statusEl.textContent = "✓ Photo removed.";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);

    const img = document.getElementById("profile-current-photo");
    img.style.display = "none";
    document.getElementById("profile-photo-placeholder").style.display = "flex";

    sharedLoaded = false;
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

// ── Zip code lookup ───────────────────────────────────────────

let zipTimer = null;

document.getElementById("profile-zip-input").addEventListener("input", e => {
  const zip = e.target.value.trim();
  clearTimeout(zipTimer);
  pendingLocation = null;
  document.getElementById("profile-save-location-btn").disabled = true;
  document.getElementById("profile-city-preview").classList.add("hidden");

  if (zip.length === 5 && /^\d{5}$/.test(zip)) {
    zipTimer = setTimeout(() => lookupZip(zip), 400);
  }
});

async function lookupZip(zip) {
  const previewEl  = document.getElementById("profile-city-preview");
  const cityNameEl = document.getElementById("profile-city-name");
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) {
      cityNameEl.textContent = "Zip code not found";
      previewEl.classList.remove("hidden");
      return;
    }
    const data  = await res.json();
    const place = data.places?.[0];
    if (place) {
      const city  = place["place name"];
      const state = place["state abbreviation"];
      cityNameEl.textContent = `${city}, ${state}`;
      previewEl.classList.remove("hidden");
      pendingLocation = { zip, city, state };
      document.getElementById("profile-save-location-btn").disabled = false;
    }
  } catch {
    cityNameEl.textContent = "Could not look up zip code";
    previewEl.classList.remove("hidden");
  }
}

// ── Save location ─────────────────────────────────────────────

document.getElementById("profile-save-location-btn").addEventListener("click", async () => {
  if (!pendingLocation) return;
  const statusEl = document.getElementById("profile-location-status");
  statusEl.textContent = "Saving…";
  try {
    const token = await netlifyIdentity.currentUser()?.jwt();
    const resp  = await fetch("/.netlify/functions/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ location: pendingLocation, slug: window.BINDER_SLUG }),
    });
    if (!resp.ok) throw new Error("Failed to save");

    statusEl.textContent = "✓ Location saved!";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
    document.getElementById("profile-saved-city").textContent = `${pendingLocation.city}, ${pendingLocation.state}`;
    document.getElementById("profile-saved-location").classList.remove("hidden");
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

// ── Binder privacy radio + save ─────────────────────────────

document.querySelectorAll("input[name='binder-privacy']").forEach(radio => {
  radio.addEventListener("change", () => {
    document.getElementById("profile-save-privacy-btn").disabled = false;
    document.getElementById("profile-privacy-status").textContent = "";
  });
});

document.getElementById("profile-save-privacy-btn").addEventListener("click", async () => {
  const selected = document.querySelector("input[name='binder-privacy']:checked");
  if (!selected) return;
  const isPublic = selected.value === "public";
  const statusEl = document.getElementById("profile-privacy-status");
  const saveBtn  = document.getElementById("profile-save-privacy-btn");
  const slug = window.BINDER_SLUG;
  if (!slug) return;

  saveBtn.disabled = true;
  statusEl.textContent = "Saving…";
  try {
    const token = await netlifyIdentity.currentUser()?.jwt();
    const resp  = await fetch("/.netlify/functions/set-binder-privacy", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slug, public: isPublic }),
    });
    if (!resp.ok) throw new Error("Failed to save");
    statusEl.textContent = isPublic ? "✓ Binder is now public" : "✓ Binder is now private";
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
    // Reset shared gallery so it reloads with updated visibility
    sharedLoaded = false;
  } catch (err) {
    statusEl.textContent = err.message;
    saveBtn.disabled = false;
  }
});

// ── Core send function ──────────────────────────────────────

async function sendMessage(isPopup) {
  const input = isPopup ? popupInput : chatInput;
  const text  = input.value.trim();
  if (!text && !pendingImage) return;

  const content = [];
  if (pendingImage) {
    content.push({ type: "image", source: { type: "base64", media_type: pendingImage.mediaType, data: pendingImage.data } });
  }
  if (text) content.push({ type: "text", text });

  // Append to BOTH message lists
  appendMessage("user", text || "📷 Card image", false);
  appendMessage("user", text || "📷 Card image", true);

  history.push({
    role: "user",
    content: content.length === 1 && content[0].type === "text" ? text : content,
  });

  input.value = "";
  input.style.height = "auto";
  clearImage();

  const typing1 = appendTyping(false);
  const typing2 = appendTyping(true);

  try {
    const user  = netlifyIdentity.currentUser();
    const token = user ? await user.jwt() : null;
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json();
    typing1.remove();
    typing2.remove();

    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

    history.push({ role: "assistant", content: data.reply });
    appendMessage("assistant", data.reply, false);
    appendMessage("assistant", data.reply, true);
  } catch (err) {
    typing1.remove();
    typing2.remove();
    appendMessage("error", `⚠️ ${err.message}`, false);
    appendMessage("error", `⚠️ ${err.message}`, true);
  }
}

// ── Render helpers ──────────────────────────────────────────

function appendMessage(role, text, isPopup) {
  const listEl = isPopup
    ? document.getElementById("popup-messages")
    : document.getElementById("messages");

  const cardsMatch = text.match ? text.match(/<cards>([\s\S]*?)<\/cards>/) : null;
  const displayText = text.replace ? text.replace(/<cards>[\s\S]*?<\/cards>/g, "").trim() : text;

  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;

  if (role === "assistant") {
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = "🤖";
    wrap.appendChild(av);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = displayText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  wrap.appendChild(bubble);

  if (cardsMatch && !isPopup) {
    try {
      const cards = JSON.parse(cardsMatch[1]);
      if (cards.length) {
        const grid = document.createElement("div");
        grid.className = "cards-thumb-grid";
        cards.slice(0, 30).forEach(card => {
          const lastDash = card.cardId.lastIndexOf("-");
          const setId = card.cardId.slice(0, lastDash);
          const num   = card.cardId.slice(lastDash + 1);
          const img   = document.createElement("img");
          img.src     = `https://images.pokemontcg.io/${setId}/${num}.png`;
          img.alt     = card.query;
          img.title   = card.query;
          img.className = "card-thumb";
          img.onerror = () => img.remove();
          grid.appendChild(img);
        });
        wrap.appendChild(grid);
      }
    } catch (_) {}
  }

  listEl.appendChild(wrap);
  listEl.scrollTop = listEl.scrollHeight;
  return wrap;
}

function appendTyping(isPopup) {
  const listEl = isPopup
    ? document.getElementById("popup-messages")
    : document.getElementById("messages");

  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.innerHTML = `<div class="avatar">🤖</div><div class="message-bubble typing"><span></span><span></span><span></span></div>`;
  listEl.appendChild(wrap);
  listEl.scrollTop = listEl.scrollHeight;
  return wrap;
}
