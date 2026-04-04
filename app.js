const API_BASE = "https://api.pokemontcg.io/v2/cards";
const CACHE_KEY = "pokemon_portfolio_cache";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FETCH_TIMEOUT_MS = 5000;             // 5 seconds per card
const PAGE_SIZE = 20;

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

async function fetchCard(query) {
  const cached = getCached(query);
  if (cached !== undefined) return cached; // null (not found) is also a valid cached result

  const [namePart, numberPart] = parseCardQuery(query);
  const q = `name:"${namePart}" number:"${numberPart}"`;
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&pageSize=10`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    let card = null;
    if (json.data && json.data.length > 0) {
      card = json.data.find(c => c.name.toLowerCase() === namePart.toLowerCase())
        || json.data[0];
    }
    setCached(query, card);
    return card;
  } catch (e) {
    clearTimeout(timeout);
    console.warn(`Failed to fetch "${query}":`, e);
    return null; // don't cache failures so we retry next visit
  }
}

function parseCardQuery(query) {
  const match = query.trim().match(/^(.+?)\s+(\d+(?:\/\d+)?)$/);
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

function getTcgPlayerUrl(card, query) {
  return card?.tcgplayer?.url
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

function createCardElement(query, card, price) {
  const wrapper = document.createElement("div");
  wrapper.className = `card-item ${getRarityClass(card)}`;
  wrapper.dataset.price = price ?? -1; // used for sorting

  const tcgUrl = getTcgPlayerUrl(card, query);
  const imgSrc = card?.images?.large || card?.images?.small || "";
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
  slice.forEach(({ query, card, price }) =>
    grid.insertBefore(createCardElement(query, card, price), sentinel)
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
  const freshCount = CARD_LIST.filter(q => getCached(q) === undefined).length;
  loadingEl.textContent = freshCount === 0
    ? "Loading from cache…"
    : freshCount === CARD_LIST.length
      ? "Fetching card data…"
      : `Fetching ${freshCount} new card${freshCount !== 1 ? "s" : ""}, rest from cache…`;

  // Show skeletons for first page while loading
  const skeletonCount = Math.min(PAGE_SIZE, CARD_LIST.length);
  for (let i = 0; i < skeletonCount; i++) grid.insertBefore(createSkeletonCard(), sentinel);

  // Fetch all in parallel — cached cards return immediately, others have a 5s timeout
  const results = await Promise.all(
    CARD_LIST.map(async query => {
      const card = await fetchCard(query);
      return { query, card, price: getMarketPrice(card) };
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
}

document.addEventListener("DOMContentLoaded", loadCollection);
