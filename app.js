const API_BASE = "https://api.pokemontcg.io/v2/cards";
const TCGDEX_BASE = "https://api.tcgdex.net/v2/en/cards";
const CACHE_KEY = "pokemon_portfolio_cache_v6";
const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const FETCH_TIMEOUT_MS = 5000;             // 5 seconds per card
const PAGE_SIZE = 20;

const DEBUG = new URLSearchParams(location.search).has("debug");

// ── Entry helpers ──────────────────────────────────────────
// CARD_LIST entries can be a plain string ("Bulbasaur 133/132")
// or an object with overrides:
// { query, setName, tcgUrl, cardId }
// cardId: exact pokemontcg.io ID (e.g. "sv8-232") — bypasses search entirely

function entryQuery(entry) {
  return typeof entry === "string" ? entry : entry.query;
}

function entryOverrides(entry) {
  return typeof entry === "string" ? {} : entry;
}

// ── Cache helpers ──────────────────────────────────────────
// Uses undefined as "not in cache" so null (card not found) can be cached too

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* storage full — skip */ }
}

function getCached(query) {
  const cache = loadCache();
  const entry = cache[query];
  if (entry === undefined) return undefined;         // not cached
  if (Date.now() - entry.ts > CACHE_TTL_MS) return undefined; // expired
  return entry.card;                                 // may be null (not found)
}

function setCached(query, card) {
  const cache = loadCache();
  cache[query] = { card, ts: Date.now() };
  saveCache(cache);
}

// ── API ────────────────────────────────────────────────────

// Normalize a TCGdex card response to the same shape as pokemontcg.io
function normalizeTcgdexCard(json) {
  if (!json || !json.name) return null;
  const imgBase = json.image || "";
  return {
    id: json.id,
    name: json.name,
    number: String(json.localId || json.number || ""),
    images: {
      large: imgBase ? `${imgBase}/high.webp` : "",
      small: imgBase ? `${imgBase}/low.webp` : "",
    },
    set: {
      name: json.set?.name || "",
      printedTotal: json.set?.cardCount?.total ?? json.set?.total ?? "?",
      total: json.set?.cardCount?.total ?? json.set?.total ?? "?",
    },
    rarity: json.rarity || "",
    tcgplayer: null, // TCGdex has no price data
  };
}

async function apiFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

async function fetchCard(query, setName, cardId) {
  const cacheKey = cardId || (setName ? `${query}|${setName}` : query);
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  const [namePart, numberPart] = parseCardQuery(query);

  try {
    // If we have an exact card ID, fetch directly — no search needed
    if (cardId) {
      let card = null;
      try {
        const json = await apiFetch(`${API_BASE}/${cardId}`);
        card = json?.data || null; // single-card endpoint wraps in { data: {...} }
      } catch { /* pokemontcg.io 404 or network error — fall through to TCGdex */ }

      // TCGdex fallback for cards not yet in pokemontcg.io (e.g. MEP promos)
      if (!card) {
        try {
          const tcgJson = await apiFetch(`${TCGDEX_BASE}/${cardId}`);
          card = normalizeTcgdexCard(tcgJson);
        } catch { /* TCGdex also failed — card stays null */ }
      }

      setCached(cacheKey, card);
      return card;
    }

    // First try: name + number (+ set name if provided)
    let q1 = `name:"${namePart}" number:"${numberPart}"`;
    if (setName) q1 += ` set.name:"${setName}"`;
    const json1 = await apiFetch(`${API_BASE}?q=${encodeURIComponent(q1)}&pageSize=10`);
    if (json1.data && json1.data.length > 0) {
      const card = json1.data.find(c => c.name.toLowerCase() === namePart.toLowerCase())
        || json1.data[0];
      setCached(cacheKey, card);
      return card;
    }

    // Only fall back to name-only if no setName was specified
    // (if setName was given and didn't match, return null rather than a wrong card)
    if (setName) {
      setCached(cacheKey, null);
      return null;
    }

    const q2 = `name:"${namePart}"`;
    const json2 = await apiFetch(`${API_BASE}?q=${encodeURIComponent(q2)}&pageSize=10`);
    const card = (json2.data || []).find(c => c.name.toLowerCase() === namePart.toLowerCase())
      || json2.data?.[0]
      || null;
    setCached(cacheKey, card);
    return card;
  } catch (e) {
    console.warn(`Failed to fetch "${query}":`, e);
    return null;
  }
}

function parseCardQuery(query) {
  // Matches plain numbers (051), fractions (133/132), and promo codes (XY30, SM01)
  const match = query.trim().match(/^(.+?)\s+([A-Z]*\d+(?:\/\d+)?)$/);
  if (match) {
    return [match[1].trim(), match[2].split("/")[0]];
  }
  return [query.trim(), ""];
}

// ── Price / display helpers ────────────────────────────────

function getMarketPrice(card) {
  if (!card || !card.tcgplayer || !card.tcgplayer.prices) return null;
  const prices = card.tcgplayer.prices;
  const priority = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "unlimited"];
  for (const type of priority) {
    if (prices[type]?.market != null) return prices[type].market;
  }
  for (const type of Object.keys(prices)) {
    if (prices[type]?.market != null) return prices[type].market;
  }
  return null;
}

function getTcgPlayerUrl(card, query, overrideTcgUrl) {
  return overrideTcgUrl
    || card?.tcgplayer?.url
    || `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}&view=grid`;
}

function formatPrice(price) {
  if (price == null) return "—";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function getRarityClass(card) {
  const rarity = (card?.rarity || "").toLowerCase();
  if (rarity.includes("secret") || rarity.includes("special")) return "rarity-secret";
  if (rarity.includes("ultra") || rarity.includes("hyper")) return "rarity-ultra";
  if (rarity.includes("rare holo") || rarity.includes("double rare")) return "rarity-holo";
  if (rarity.includes("rare")) return "rarity-rare";
  return "";
}

// ── Card rendering ─────────────────────────────────────────

function createCardElement(query, card, price, overrides = {}, isStaticPrice = false) {
  const wrapper = document.createElement("div");
  const grade = overrides.grade ?? null;
  wrapper.className = `card-item ${getRarityClass(card)}${grade ? " graded" : ""}`;
  wrapper.dataset.price = price ?? -1; // used for sorting

  const tcgUrl = getTcgPlayerUrl(card, query, overrides.tcgUrl);
  const imgSrc = overrides.imageUrl || card?.images?.large || card?.images?.small || "";
  const cardName = card ? card.name : query;
  const setName = card?.set?.name || "";
  const series = card?.set?.series || "";
  const cardNumber = card
    ? `${card.number}/${card.set?.printedTotal || card.set?.total || "?"}`
    : query.split(" ").pop();
  const priceDisplay = formatPrice(price);
  const rarity = card?.rarity || "";

  wrapper.innerHTML = `
    <a href="${tcgUrl}" target="_blank" rel="noopener" class="card-link">
      <div class="card-image-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${cardName}" class="card-img" loading="lazy" />`
          : `<div class="card-img-placeholder"><span>${cardName}</span></div>`
        }
        ${grade ? `<div class="card-grade-badge">Grade ${grade}</div>` : ""}
        ${price != null ? `<div class="card-price-badge${isStaticPrice ? " static" : ""}">${isStaticPrice ? "~" : ""}${priceDisplay}</div>` : ""}
      </div>
      <div class="card-info">
        <div class="card-name">${cardName}</div>
        ${series ? `<div class="card-series">${series}</div>` : ""}
        ${setName ? `<div class="card-set">${setName}</div>` : ""}
        <div class="card-meta">
          <span class="card-number">#${cardNumber}</span>
          ${rarity ? `<span class="card-rarity">${rarity}</span>` : ""}
        </div>
        <div class="card-price ${price == null ? "card-price-unknown" : isStaticPrice ? "card-price-static" : ""}">${isStaticPrice ? "~" : ""}${priceDisplay}</div>
      </div>
    </a>
  `;
  return wrapper;
}

function createSkeletonCard() {
  const el = document.createElement("div");
  el.className = "card-item card-skeleton";
  el.innerHTML = `
    <div class="card-image-wrap skeleton-img"></div>
    <div class="card-info">
      <div class="skeleton-line skeleton-name"></div>
      <div class="skeleton-line skeleton-set"></div>
      <div class="skeleton-line skeleton-price"></div>
    </div>
  `;
  return el;
}

// ── Filters ────────────────────────────────────────────────

let currentFilter = "";
let currentSeries = "";
let currentGradeFilter = "";

function normalizeSearch(str) {
  // Lowercase and collapse whitespace — no regex on user input so special chars are safe
  return String(str).toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesFilter(query, card, overrides) {
  if (!currentFilter) return true;
  const target = normalizeSearch([
    card ? card.name : "",
    card ? card.set?.name : "",
    card ? card.number : "",
    overrides.query || query,
    overrides.setName || "",
  ].join(" "));
  // Every space-separated token must appear somewhere in the target
  return normalizeSearch(currentFilter).split(" ").filter(Boolean)
    .every(token => target.includes(token));
}

function getFilteredResults() {
  return sortedResults.filter(({ query, card, overrides }) => {
    if (currentSeries && (card?.set?.series || "") !== currentSeries) return false;
    if (currentGradeFilter === "graded" && !overrides.grade) return false;
    if (currentGradeFilter === "non-graded" && overrides.grade) return false;
    return matchesFilter(query, card, overrides);
  });
}

function buildSeriesDropdown() {
  const btn = document.getElementById("series-btn");
  const panel = document.getElementById("series-panel");
  const labelEl = document.getElementById("series-label");
  const searchEl = document.getElementById("series-search");
  const listEl = document.getElementById("series-options");

  // Collect unique series, sorted
  const allSeries = [...new Set(
    sortedResults.map(r => r.card?.set?.series).filter(Boolean)
  )].sort();

  // Build options: "All Series" + each unique series
  const options = [{ label: "All Series", value: "" }, ...allSeries.map(s => ({ label: s, value: s }))];

  function renderOptions(query = "") {
    const q = query.toLowerCase();
    listEl.innerHTML = "";
    options.forEach(({ label, value }) => {
      if (q && value && !label.toLowerCase().includes(q)) return;
      const li = document.createElement("li");
      li.textContent = label;
      if (value === currentSeries) li.classList.add("selected");
      li.addEventListener("click", () => {
        currentSeries = value;
        labelEl.textContent = value || "All Series";
        btn.classList.toggle("active", !!value);
        panel.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        resetAndRender();
      });
      listEl.appendChild(li);
    });
  }

  renderOptions();

  // Toggle open/close
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen);
    if (isOpen) { searchEl.value = ""; renderOptions(); searchEl.focus(); }
  });

  // Live search within dropdown
  searchEl.addEventListener("input", () => renderOptions(searchEl.value));
  searchEl.addEventListener("click", e => e.stopPropagation());

  // Close on outside click
  document.addEventListener("click", () => {
    panel.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  });
}

function buildGradeDropdown() {
  const btn = document.getElementById("grade-btn");
  const panel = document.getElementById("grade-panel");
  const labelEl = document.getElementById("grade-label");

  const options = [
    { label: "All Cards",       value: "" },
    { label: "Graded Only",     value: "graded" },
    { label: "Non-Graded Only", value: "non-graded" },
  ];

  function renderOptions() {
    const listEl = document.getElementById("grade-options");
    listEl.innerHTML = "";
    options.forEach(({ label, value }) => {
      const li = document.createElement("li");
      li.textContent = label;
      if (value === currentGradeFilter) li.classList.add("selected");
      li.addEventListener("click", () => {
        currentGradeFilter = value;
        labelEl.textContent = label;
        btn.classList.toggle("active", !!value);
        panel.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
        resetAndRender();
      });
      listEl.appendChild(li);
    });
  }

  renderOptions();

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen);
    if (isOpen) renderOptions();
  });

  document.addEventListener("click", () => {
    panel.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  });
}

// ── Pagination ─────────────────────────────────────────────

let sortedResults = [];
let currentPage = 0;

function renderNextPage() {
  const grid = document.getElementById("card-grid");
  const sentinel = document.getElementById("load-sentinel");
  const filtered = getFilteredResults();
  const start = currentPage * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  slice.forEach(({ query, card, price, overrides, isStaticPrice }) =>
    grid.insertBefore(createCardElement(query, card, price, overrides, isStaticPrice), sentinel)
  );
  currentPage++;
  if (currentPage * PAGE_SIZE >= filtered.length) sentinel.style.display = "none";
  else sentinel.style.display = "";
}

function resetAndRender() {
  const grid = document.getElementById("card-grid");
  const sentinel = document.getElementById("load-sentinel");
  const statusEl = document.getElementById("search-status");
  grid.querySelectorAll(".card-item").forEach(el => el.remove());
  sentinel.style.display = "";
  currentPage = 0;
  const filtered = getFilteredResults();
  if (statusEl) {
    if (currentFilter) {
      statusEl.innerHTML = `<span class="search-status-pill"><strong>${filtered.length}</strong> of ${sortedResults.length} cards matched</span>`;
    } else {
      statusEl.innerHTML = "";
    }
  }
  renderNextPage();
}

function setupIntersectionObserver() {
  const sentinel = document.getElementById("load-sentinel");
  new IntersectionObserver(
    entries => { if (entries[0].isIntersecting) renderNextPage(); },
    { rootMargin: "200px" }
  ).observe(sentinel);
}

// ── Main ───────────────────────────────────────────────────

async function loadCollection() {
  const grid = document.getElementById("card-grid");
  const totalEl = document.getElementById("total-value");
  const countEl = document.getElementById("card-count");
  const loadingEl = document.getElementById("loading-status");
  const sentinel = document.getElementById("load-sentinel");

  countEl.textContent = CARD_LIST.length;

  // Count how many are already cached (undefined = not cached)
  const freshCount = CARD_LIST.filter(e => getCached(entryQuery(e)) === undefined).length;
  loadingEl.textContent = freshCount === 0
    ? "Loading from cache…"
    : freshCount === CARD_LIST.length
      ? "Fetching card data…"
      : `Fetching ${freshCount} new card${freshCount !== 1 ? "s" : ""}, rest from cache…`;

  // Show skeletons for first page while loading
  const skeletonCount = Math.min(PAGE_SIZE, CARD_LIST.length);
  for (let i = 0; i < skeletonCount; i++) grid.insertBefore(createSkeletonCard(), sentinel);

  // Fetch all in parallel — cached cards return immediately, others have a 5s timeout
  let doneCount = 0;
  const results = await Promise.all(
    CARD_LIST.map(async entry => {
      const query = entryQuery(entry);
      const overrides = entryOverrides(entry);
      const card = await fetchCard(query, overrides.setName, overrides.cardId);
      const apiPrice = getMarketPrice(card);
      const price = apiPrice ?? overrides.fallbackPrice ?? null;
      const isStaticPrice = apiPrice == null && overrides.fallbackPrice != null;
      doneCount++;
      if (freshCount > 0) loadingEl.textContent = `Loading ${doneCount} / ${CARD_LIST.length}…`;
      return { query, card, price, overrides, isStaticPrice };
    })
  );

  // Sort by price descending (no price → end)
  sortedResults = results.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return b.price - a.price;
  });

  // Update total
  const total = sortedResults.reduce((sum, r) => sum + (r.price || 0), 0);
  totalEl.textContent = formatPrice(total);

  // Remove skeletons, render first page
  grid.querySelectorAll(".card-skeleton").forEach(el => el.remove());
  currentPage = 0;
  setupIntersectionObserver();
  renderNextPage();
  buildSeriesDropdown();
  buildGradeDropdown();

  loadingEl.textContent = "";

  if (DEBUG) renderDebugTable(sortedResults);

  // ── Search wiring ──
  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  searchInput.addEventListener("input", () => {
    currentFilter = searchInput.value;
    searchClear.style.display = currentFilter ? "block" : "none";
    resetAndRender();
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    currentFilter = "";
    searchClear.style.display = "none";
    resetAndRender();
    searchInput.focus();
  });

  // Press "/" anywhere to focus search (unless already in an input)
  document.addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
    if (e.key === "Escape" && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });
}

function renderDebugTable(results) {
  const existing = document.getElementById("debug-table-wrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "debug-table-wrap";
  wrap.style.cssText = "max-width:1400px;margin:2rem auto;padding:0 1.5rem;overflow-x:auto;position:relative;z-index:1";

  const rows = results.map(({ query, card, price, overrides }) => {
    const expected = overrides.setName || "—";
    const got = card ? `${card.name} · ${card.set?.name || "?"} · #${card.number}` : "NOT FOUND";
    const imgOk = card ? "✓" : "✗";
    const match = card && overrides.setName
      ? card.set?.name?.toLowerCase().includes(overrides.setName.toLowerCase()) ? "✓" : "⚠️"
      : card ? "?" : "✗";
    return `<tr>
      <td>${query}</td>
      <td>${expected}</td>
      <td>${got}</td>
      <td style="text-align:center">${match}</td>
      <td style="text-align:center">${price != null ? "$" + price.toFixed(2) : "—"}</td>
      <td style="text-align:center">${card ? `<img src="${card.images?.small}" style="height:40px">` : "✗"}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `
    <h2 style="color:var(--accent);margin-bottom:1rem;font-size:1rem;text-transform:uppercase;letter-spacing:.08em">
      🔍 Debug Mode — API vs Expected
    </h2>
    <table style="width:100%;border-collapse:collapse;font-size:.8rem;background:var(--surface);border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:var(--surface2);color:var(--text-muted);text-align:left">
          <th style="padding:.6rem .8rem">Query</th>
          <th style="padding:.6rem .8rem">Expected Set</th>
          <th style="padding:.6rem .8rem">API Returned</th>
          <th style="padding:.6rem .8rem;text-align:center">Match</th>
          <th style="padding:.6rem .8rem;text-align:center">Price</th>
          <th style="padding:.6rem .8rem;text-align:center">Image</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.querySelector(".grid-container").before(wrap);
}

if (!window.BINDER_LOADER) {
  document.addEventListener("DOMContentLoaded", loadCollection);
}
