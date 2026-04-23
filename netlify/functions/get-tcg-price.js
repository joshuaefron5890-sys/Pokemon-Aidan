// GET /.netlify/functions/get-tcg-price?url=https://www.tcgplayer.com/product/477057/...
// Extracts product ID from a TCGPlayer URL and returns Near Mint market price
// Uses TCGPlayer's marketplace API (same endpoint their site uses)

const HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { url } = event.queryStringParameters || {};
  if (!url) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing url" }) };

  const match = url.match(/tcgplayer\.com\/product\/(\d+)/i);
  if (!match) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "No product ID found in URL" }) };

  const productId = match[1];

  try {
    const apiUrl = `https://mpapi.tcgplayer.com/v2/product/${productId}/totallistings?condition=Near+Mint&listingType=standard&limit=50`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
        "Referer":    "https://www.tcgplayer.com/",
        "Origin":     "https://www.tcgplayer.com",
        "Accept":     "application/json",
      },
    });

    if (!res.ok) throw new Error(`TCGPlayer API returned ${res.status}`);

    const data = await res.json();
    const prices = (data.results || [])
      .map(r => r.price)
      .filter(p => typeof p === "number" && p > 0)
      .sort((a, b) => a - b);

    if (!prices.length) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ price: null, productId, listingCount: 0 }) };
    }

    // Use the 15th-percentile price — filters out suspiciously cheap outliers
    // while still reflecting what a buyer would realistically pay
    const idx = Math.max(0, Math.floor(prices.length * 0.15));
    const price = Math.round(prices[idx] * 100) / 100;

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ price, productId, listingCount: prices.length, lowestNM: prices[0] }),
    };
  } catch (err) {
    console.error("get-tcg-price error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
