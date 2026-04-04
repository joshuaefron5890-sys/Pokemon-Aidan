const API_BASE = "https://api.pokemontcg.io/v2/cards";
const TCGDEX_BASE = "https://api.tcgdex.net/v2/en/cards";
const CACHE_KEY = "pokemon_portfolio_cache_v6";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
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

function createCardElement(query, card, price, overrides = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `card-item ${getRarityClass(card)}`;
  wrapper.dataset.price = price ?? -1; // used for sorting

  const tcgUrl = getTcgPlayerUrl(card, query, overrides.tcgUrl);
  const imgSrc = overrides.imageUrl || card?.images?.large || card?.images?.small || "";
  const cardName = card ? card.name : query;
  const setName = card?.set?.name || "";
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
        ${price != null ? `<div class="card-price-badge">${priceDisplay}</div>` : ""}
      </div>
      <div class="card-info">
        <div class="card-name">${cardName}</div>
        ${setName ? `<div class="card-set">${setName}</div>` : ""}
        <div class="card-meta">
          <span class="card-number">#${cardNumber}</span>
          ${rarity ? `<span class="card-rarity">${rarity}</span>` : ""}
        </div>
        <div class="card-price ${price == null ? "card-price-unknown" : ""}">${priceDisplay}</div>
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

// ── Pagination ─────────────────────────────────────────────

let sortedResults = [];
let currentPage = 0;

function renderNextPage() {
  const grid = document.getElementById("card-grid");
  const sentinel = document.getElementById("load-sentinel");
  const start = currentPage * PAGE_SIZE;
  const slice = sortedResults.slice(start, start + PAGE_SIZE);
  slice.forEach(({ query, card, price, overrides }) =>
    grid.insertBefore(createCardElement(query, card, price, overrides), sentinel)
  );
  currentPage++;
  if (currentPage * PAGE_SIZE >= sortedResults.length) sentinel.style.display = "none";
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
      doneCount++;
      if (freshCount > 0) loadingEl.textContent = `Loading ${doneCount} / ${CARD_LIST.length}…`;
      return { query, card, price: getMarketPrice(card), overrides };
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

  const missing = sortedResults.filter(r => r.price == null).length;
  loadingEl.textContent = missing > 0
    ? `${missing} card${missing !== 1 ? "s" : ""} without price data`
    : "";

  if (DEBUG) renderDebugTable(sortedResults);
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

document.addEventListener("DOMContentLoaded", loadCollection);
