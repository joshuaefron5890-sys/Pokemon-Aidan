// Remove a card from a Blobs binder
// POST { slug, cardId?, query? } — cardId preferred; falls back to first query match
// Auth required — user must own the binder

const { getBinder, putBinder, getManifest, putManifest } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug, cardId, query } = JSON.parse(event.body);
    if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };

    const binder = await getBinder(slug);
    if (!binder) return { statusCode: 404, body: JSON.stringify({ error: "Binder not found" }) };
    if (binder.email !== user.email) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

    const before = binder.cards.length;
    if (cardId) {
      binder.cards = binder.cards.filter(c => c.cardId !== cardId);
    } else if (query) {
      const idx = binder.cards.findIndex(c => c.query === query);
      if (idx >= 0) binder.cards.splice(idx, 1);
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Provide cardId or query" }) };
    }

    await putBinder(slug, binder);

    const manifest = await getManifest();
    const entry = manifest.find(b => b.slug === slug);
    if (entry) { entry.cardCount = binder.cards.length; await putManifest(manifest); }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, removed: before - binder.cards.length }),
    };
  } catch (err) {
    console.error("remove-card error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
