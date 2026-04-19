// Public endpoint — returns the cards array stored in a binder blob.
// Used by static binder pages (e.g. AidanEfron.html) to pick up cards
// added or edited via the admin UI without requiring auth.
// GET /.netlify/functions/get-card-overrides?slug=aidan

const { getBinder } = require("./_blobs");

const NO_CACHE = { "Cache-Control": "no-store, no-cache", "Content-Type": "application/json" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) return { statusCode: 400, headers: NO_CACHE, body: JSON.stringify({ error: "Missing slug" }) };

  try {
    const binder = await getBinder(slug);
    const cards  = binder?.cards || [];
    return { statusCode: 200, headers: NO_CACHE, body: JSON.stringify({ cards }) };
  } catch (err) {
    console.error("get-card-overrides error:", err);
    return { statusCode: 500, headers: NO_CACHE, body: JSON.stringify({ error: err.message }) };
  }
};
