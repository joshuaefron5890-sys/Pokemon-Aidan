const API_BASE = "https://api.pokemontcg.io/v2/cards";
const CACHE_KEY = "pokemon_portfolio_cache_v3"; // bumped to invalidate stale entries
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const FETCH_TIMEOUT_MS = 5000;             // 5 seconds per card
const PAGE_SIZE = 20;

// ── Normalize CARD_LIST entries ───────────────────────────────
// Entries can be strings or { query, id } objects

function normalizeEntry(entry) {
  if (typeof entry === "string") return { query: entry, id: null };
  return { query: entry.query, id: entry.id || null };
}

// ── Cache helpers ──────────────────────────────────────────

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

function getCached(key) {
  const cache = loadCache();
  const entry = cache[key];
  if (entry === undefined) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return undefined;
  return entry.card;
}

function setCached(key, card) {
  const cache = loadCache();
  cache[key] = { card, ts: Date.now() };
  saveCache(cache);
}

// ── API ────────────────────────────────────────────────────

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

async function fetchCardById(id) {
  const cacheKey = `id:${id}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const json = await apiFetch(`${API_BASE}/${encodeURIComponent(id)}`);
    const card = json.data || null;
    setCached(cacheKey, card);
    return card;
  } catch (e) {
    console.warn(`Failed to fetch card by ID "${id}":`, e);
    return null;
  }
}

async function fetchCardByQuery(query) {
  const cached = getCached(query);
  if (cached !== undefined) return cached;

  const [namePart, numberPart] = parseCardQuery(query);

  // Escape special chars for Lucene query syntax (apostrophes, colons, etc.)
  const escapedName = namePart.replace(/(['\-\+\&\|\!\(\)\{\}\[\]\^~\*\?\\:\/])/g, "\\$1");

  try {
    // First try: exact name + number
    const q1 = `name:"${escapedName}" number:"${numberPart}"`;
    const json1 = await apiFetch(`${API_BASE}?q=${encodeURIComponent(q1)}&pageSize=10`);
    if (json1.data && json1.data.length > 0) {
      const card = json1.data.find(c => c.name.toLowerCase() === namePart.toLowerCase())
        || json1.data[0];
      setCached(query, card);
      return card;
    }

    // Second try: name only (with escaping)
    const q2 = `name:"${escapedName}"`;
    const json2 = await apiFetch(`${API_BASE}?q=${encodeURIComponent(q2)}&pageSize=10`);
    if (json2.data && json2.data.length > 0) {
      const card = json2.data.find(c => c.name.toLowerCase() === namePart.toLowerCase())
        || json2.data[0];
      setCached(query, card);
      return card;
    }

    // Third try: wildcard name search (handles partial matches like "Ethan's Ho-Oh ex")
    const q3 = `name:"${escapedName}*"`;
    const json3 = await apiFetch(`${API_BASE}?q=${encodeURIComponent(q3)}&pageSize=10`);
    const card = (json3.data || []).find(c => c.name.toLowerCase() === namePart.toLowerCase())
      || json3.data?.[0]
      || null;
    setCached(query, card);
    return card;
  } catch (e) {
    console.warn(`Failed to fetch "${query}":`, e);
    return null;
  }
}

async function fetchCard(entry) {
  const { query, id } = normalizeEntry(entry);
  if (id) return fetchCardById(id);
  return fetchCardByQuery(query);
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
  wrapper.dataset.price = price ?? -1;

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

// ── Diagnostic Audit Table ────────────────────────────────

function buildAuditTable(results) {
  const section = document.getElementById("audit-section");
  if (!section) return;

  const tbody = section.querySelector("tbody");
  tbody.innerHTML = "";

  let allMatch = true;

  results.forEach(({ query, id, card, price }) => {
    const [expectedName, expectedNum] = parseCardQuery(query);
    const apiName = card?.name || "—";
    const apiSet = card?.set?.name || "—";
    const apiNum = card ? `${card.number}/${card.set?.printedTotal || card.set?.total || "?"}` : "—";
    const apiId = card?.id || "—";
    const imgSrc = card?.images?.small || "";

    // Check if the returned card number matches what was queried
    const returnedNum = card?.number || "";
    const match = returnedNum === expectedNum;
    if (!match) allMatch = false;

    const tr = document.createElement("tr");
    tr.className = match ? "audit-match" : "audit-mismatch";
    tr.innerHTML = `
      <td>${query}${id ? `<br><small>id: ${id}</small>` : ""}</td>
      <td>${expectedNum || "—"}</td>
      <td>${apiId}</td>
      <td>${apiName}<br><small>${apiSet} #${apiNum}</small></td>
      <td class="audit-status">${match ? "✓" : "⚠️"}</td>
      <td>${formatPrice(price)}</td>
      <td>${imgSrc ? `<img src="${imgSrc}" class="audit-img" />` : "—"}</td>
    `;
    tbody.appendChild(tr);
  });

  // Show the section
  section.style.display = "block";
  const heading = section.querySelector("h2");
  if (allMatch) {
    heading.textContent = "Audit: All cards matched ✓";
    heading.style.color = "#4ade80";
  } else {
    heading.textContent = "Audit: Mismatches found ⚠️";
    heading.style.color = "#f59e0b";
  }
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

  // Count how many are already cached
  const freshCount = CARD_LIST.filter(entry => {
    const { query, id } = normalizeEntry(entry);
    const key = id ? `id:${id}` : query;
    return getCached(key) === undefined;
  }).length;

  loadingEl.textContent = freshCount === 0
    ? "Loading from cache…"
    : freshCount === CARD_LIST.length
      ? "Fetching card data…"
      : `Fetching ${freshCount} new card${freshCount !== 1 ? "s" : ""}, rest from cache…`;

  // Show skeletons for first page while loading
  const skeletonCount = Math.min(PAGE_SIZE, CARD_LIST.length);
  for (let i = 0; i < skeletonCount; i++) grid.insertBefore(createSkeletonCard(), sentinel);

  // Fetch all in parallel
  let doneCount = 0;
  const results = await Promise.all(
    CARD_LIST.map(async entry => {
      const { query, id } = normalizeEntry(entry);
      const card = await fetchCard(entry);
      doneCount++;
      if (freshCount > 0) loadingEl.textContent = `Loading ${doneCount} / ${CARD_LIST.length}…`;
      return { query, id, card, price: getMarketPrice(card) };
    })
  );

  // Build audit table (for debugging)
  buildAuditTable(results);

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
