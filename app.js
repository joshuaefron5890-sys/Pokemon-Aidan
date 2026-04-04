const API_BASE = "https://api.pokemontcg.io/v2/cards";
const CACHE_KEY = "pokemon_portfolio_cache";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PAGE_SIZE = 20;

// ── Cache helpers ──────────────────────────────────────────

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — just skip caching
  }
}

function getCached(query) {
  const cache = loadCache();
  const entry = cache[query];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null; // expired
  return entry.card; // may be null (card not found) — that's also cached
}

function setCached(query, card) {
  const cache = loadCache();
  cache[query] = { card, ts: Date.now() };
  saveCache(cache);
}

// ── API ────────────────────────────────────────────────────

async function fetchCard(query) {
  const cached = getCached(query);
  if (cached !== null) return cached;

  const [namePart, numberPart] = parseCardQuery(query);
  const q = `name:"${namePart}" number:"${numberPart}"`;
  const url = `${API_BASE}?q=${encodeURIComponent(q)}&pageSize=10`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    let card = null;
    if (json.data && json.data.length > 0) {
      const exact = json.data.find(
        c => c.name.toLowerCase() === namePart.toLowerCase()
      );
      card = exact || json.data[0];
    }
    setCached(query, card);
    return card;
  } catch (e) {
    clearTimeout(timeout);
    console.warn(`Failed to fetch "${query}":`, e);
    return null;
  }
}

function parseCardQuery(query) {
  const match = query.trim().match(/^(.+?)\s+(\d+(?:\/\d+)?)$/);
  if (match) {
    const name = match[1].trim();
    const number = match[2].split("/")[0];
    return [name, number];
  }
  return [query.trim(), ""];
}

// ── Price / display helpers ────────────────────────────────

function getMarketPrice(card) {
  if (!card || !card.tcgplayer || !card.tcgplayer.prices) return null;
  const prices = card.tcgplayer.prices;
  const types = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "unlimited"];
  for (const type of types) {
    if (prices[type] && prices[type].market != null) return prices[type].market;
  }
  for (const type of Object.keys(prices)) {
    if (prices[type] && prices[type].market != null) return prices[type].market;
  }
  return null;
}

function getTcgPlayerUrl(card, query) {
  if (card && card.tcgplayer && card.tcgplayer.url) return card.tcgplayer.url;
  return `https://www.tcgplayer.com/search/all/product?q=${encodeURIComponent(query)}&view=grid`;
}

function formatPrice(price) {
  if (price == null) return "—";
  return price.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function getRarityClass(card) {
  if (!card) return "";
  const rarity = (card.rarity || "").toLowerCase();
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

  const tcgUrl = getTcgPlayerUrl(card, query);
  const imgSrc = card ? card.images.large || card.images.small : "";
  const cardName = card ? card.name : query;
  const setName = card ? (card.set ? card.set.name : "") : "";
  const cardNumber = card
    ? `${card.number}/${card.set?.printedTotal || card.set?.total || "?"}`
    : query.split(" ").pop();
  const priceDisplay = formatPrice(price);
  const rarity = card ? card.rarity || "" : "";

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
  const wrapper = document.createElement("div");
  wrapper.className = "card-item card-skeleton";
  wrapper.innerHTML = `
    <div class="card-image-wrap skeleton-img"></div>
    <div class="card-info">
      <div class="skeleton-line skeleton-name"></div>
      <div class="skeleton-line skeleton-set"></div>
      <div class="skeleton-line skeleton-price"></div>
    </div>
  `;
  return wrapper;
}

// ── Pagination ─────────────────────────────────────────────

let allResults = [];
let currentPage = 0;

function renderNextPage() {
  const grid = document.getElementById("card-grid");
  const sentinel = document.getElementById("load-sentinel");
  const start = currentPage * PAGE_SIZE;
  const slice = allResults.slice(start, start + PAGE_SIZE);

  slice.forEach(({ query, card, price }) => {
    grid.insertBefore(createCardElement(query, card, price), sentinel);
  });

  currentPage++;

  // Hide sentinel once all cards are shown
  if (currentPage * PAGE_SIZE >= allResults.length) {
    sentinel.style.display = "none";
  }
}

function setupIntersectionObserver() {
  const sentinel = document.getElementById("load-sentinel");
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) renderNextPage();
    },
    { rootMargin: "200px" } // start loading 200px before it scrolls into view
  );
  observer.observe(sentinel);
}

// ── Main ───────────────────────────────────────────────────

async function loadCollection() {
  const grid = document.getElementById("card-grid");
  const totalEl = document.getElementById("total-value");
  const countEl = document.getElementById("card-count");
  const loadingEl = document.getElementById("loading-status");
  const sentinel = document.getElementById("load-sentinel");

  countEl.textContent = CARD_LIST.length;

  // Show skeletons only for the first page
  const skeletonCount = Math.min(PAGE_SIZE, CARD_LIST.length);
  for (let i = 0; i < skeletonCount; i++) {
    grid.insertBefore(createSkeletonCard(), sentinel);
  }

  // Check how many cards are already cached
  const cachedCount = CARD_LIST.filter(q => getCached(q) !== null).length;
  loadingEl.textContent = cachedCount === CARD_LIST.length
    ? "Loading from cache…"
    : `Fetching ${CARD_LIST.length - cachedCount} new card${CARD_LIST.length - cachedCount !== 1 ? "s" : ""}…`;

  // Fetch all in parallel (cached cards return instantly)
  const results = await Promise.all(
    CARD_LIST.map(async (query) => {
      const card = await fetchCard(query);
      const price = getMarketPrice(card);
      return { query, card, price };
    })
  );

  // Sort by price descending (nulls at end)
  results.sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return b.price - a.price;
  });

  allResults = results;

  const total = results.reduce((sum, r) => sum + (r.price || 0), 0);
  totalEl.textContent = formatPrice(total);
  loadingEl.textContent = "";

  // Remove skeletons and render first page
  grid.querySelectorAll(".card-skeleton").forEach(el => el.remove());
  setupIntersectionObserver();
  renderNextPage();

  const missing = results.filter(r => r.price == null).length;
  if (missing > 0) {
    loadingEl.textContent = `${missing} card${missing !== 1 ? "s" : ""} without price data`;
  }
}

document.addEventListener("DOMContentLoaded", loadCollection);
