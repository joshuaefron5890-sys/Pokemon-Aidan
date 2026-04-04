const API_BASE = "https://api.pokemontcg.io/v2/cards";

async function fetchCard(query) {
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
    if (json.data && json.data.length > 0) {
      // Pick best match: prefer exact name match
      const exact = json.data.find(
        c => c.name.toLowerCase() === namePart.toLowerCase()
      );
      return exact || json.data[0];
    }
    return null;
  } catch (e) {
    clearTimeout(timeout);
    console.warn(`Failed to fetch "${query}":`, e);
    return null;
  }
}

function parseCardQuery(query) {
  // "Drayton 232/191" -> ["Drayton", "232"]
  // "Charizard ex 199/165" -> ["Charizard ex", "199"]
  const match = query.trim().match(/^(.+?)\s+(\d+(?:\/\d+)?)$/);
  if (match) {
    const name = match[1].trim();
    const numberFull = match[2]; // e.g. "232/191" or "232"
    const number = numberFull.split("/")[0]; // just the card number
    return [name, number];
  }
  return [query.trim(), ""];
}

function getMarketPrice(card) {
  if (!card.tcgplayer || !card.tcgplayer.prices) return null;
  const prices = card.tcgplayer.prices;
  // Priority order for price types
  const types = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "unlimited"];
  for (const type of types) {
    if (prices[type] && prices[type].market != null) {
      return prices[type].market;
    }
  }
  // Fallback: first available market price
  for (const type of Object.keys(prices)) {
    if (prices[type] && prices[type].market != null) {
      return prices[type].market;
    }
  }
  return null;
}

function getTcgPlayerUrl(card, query) {
  if (card && card.tcgplayer && card.tcgplayer.url) {
    return card.tcgplayer.url;
  }
  // Fallback: build a search URL
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

function createCardElement(query, card, price) {
  const wrapper = document.createElement("div");
  wrapper.className = `card-item ${getRarityClass(card)}`;

  const tcgUrl = getTcgPlayerUrl(card, query);
  const imgSrc = card ? card.images.large || card.images.small : "";
  const cardName = card ? card.name : query;
  const setName = card ? (card.set ? card.set.name : "") : "";
  const cardNumber = card ? `${card.number}/${card.set?.printedTotal || card.set?.total || "?"}` : query.split(" ").pop();
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

async function loadCollection() {
  const grid = document.getElementById("card-grid");
  const totalEl = document.getElementById("total-value");
  const countEl = document.getElementById("card-count");
  const loadingEl = document.getElementById("loading-status");

  // Show skeletons
  grid.innerHTML = "";
  CARD_LIST.forEach(() => grid.appendChild(createSkeletonCard()));

  loadingEl.textContent = `Loading collection…`;
  countEl.textContent = CARD_LIST.length;

  // Fetch all cards in parallel (each has an 8s timeout)
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

  // Calculate total
  const total = results.reduce((sum, r) => sum + (r.price || 0), 0);
  totalEl.textContent = formatPrice(total);
  loadingEl.textContent = "";

  // Render cards
  grid.innerHTML = "";
  results.forEach(({ query, card, price }) => {
    grid.appendChild(createCardElement(query, card, price));
  });

  // Show how many prices we couldn't find
  const missing = results.filter(r => r.price == null).length;
  if (missing > 0) {
    loadingEl.textContent = `${missing} card${missing !== 1 ? "s" : ""} without price data`;
  }
}

document.addEventListener("DOMContentLoaded", loadCollection);
