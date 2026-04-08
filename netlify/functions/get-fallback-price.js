// Fallback price lookup for cards where the primary API returns no price.
// Searches pokemontcg.io by name only (all printings) and returns the median
// market price across results. This gives a reasonable estimate for cards
// whose specific printing has no TCGPlayer price data.

const API_BASE = "https://api.pokemontcg.io/v2/cards";
const HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { name } = event.queryStringParameters || {};
  if (!name || name.trim().length < 2) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing name" }) };
  }

  try {
    const q = encodeURIComponent(`name:"${name.trim()}"`);
    const url = `${API_BASE}?q=${q}&pageSize=50&orderBy=-set.releaseDate`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`pokemontcg.io HTTP ${resp.status}`);
    const json = await resp.json();

    const prices = (json.data || [])
      .map(card => {
        const p = card?.tcgplayer?.prices || {};
        const priority = ["holofoil", "reverseHolofoil", "normal", "1stEditionHolofoil", "unlimited"];
        for (const type of priority) {
          if (p[type]?.market != null) return p[type].market;
        }
        for (const type of Object.keys(p)) {
          if (p[type]?.market != null) return p[type].market;
        }
        return null;
      })
      .filter(p => p != null)
      .sort((a, b) => a - b);

    if (prices.length === 0) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ price: null }) };
    }

    // Median price across all printings
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ price: Math.round(median * 100) / 100, count: prices.length }),
    };
  } catch (e) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
