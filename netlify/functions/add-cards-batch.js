// POST /.netlify/functions/add-cards-batch
// Body: { slug, cards: [{cardId, query, setName, tcgUrl, fallbackPrice, grade}] }
// Adds all cards in a single read-modify-write. Auth required — user must own the binder.

const { getBinder, putBinder, getManifest, putManifest } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const HEADERS = { "Content-Type": "application/json" };

  try {
    const { slug, cards } = JSON.parse(event.body || "{}");
    if (!slug)               return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing slug" }) };
    if (!Array.isArray(cards) || !cards.length)
                             return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing cards" }) };

    let binder = await getBinder(slug);
    if (!binder) {
      binder = { email: user.email, slug, public: true, cards: [] };
    }
    if (binder.email !== user.email) return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: "Forbidden" }) };

    const added = [];
    const skipped = [];

    for (const c of cards) {
      if (!c.cardId && !c.query) continue;
      const key = c.cardId || c.query;
      const existing = c.cardId
        ? binder.cards.find(e => e.cardId === c.cardId)
        : binder.cards.find(e => !e.cardId && e.query === c.query);
      if (existing) {
        existing.qty = (existing.qty || 1) + 1;
        added.push(key);
        continue;
      }
      const entry = { query: c.query || c.cardId };
      if (c.cardId)                       entry.cardId        = c.cardId;
      if (c.setName)                      entry.setName       = c.setName;
      if (c.tcgUrl)                       entry.tcgUrl        = c.tcgUrl;
      if (c.imageUrl)                     entry.imageUrl      = c.imageUrl;
      if (c.grade)                        entry.grade         = c.grade;
      if (c.available)                    entry.available     = true;
      // Accept either fallbackPrice (manual edit) or marketPrice (scraped from TCGPlayer)
      const storedPrice = c.fallbackPrice ?? c.marketPrice;
      if (storedPrice != null)            entry.fallbackPrice = storedPrice;
      binder.cards.push(entry);
      added.push(key);
    }

    await putBinder(slug, binder);

    // Update card count in manifest
    try {
      const manifest = await getManifest();
      const entry = manifest.find(b => b.slug === slug);
      if (entry) { entry.cardCount = binder.cards.length; await putManifest(manifest); }
    } catch {}

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, added: added.length, skipped: skipped.length }),
    };
  } catch (err) {
    console.error("add-cards-batch error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
