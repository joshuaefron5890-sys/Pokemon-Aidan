// Update overrides for a card in a binder
// POST { slug, cardId?, query?, updates: { tcgUrl, imageUrl, fallbackPrice, grade,
//         nameOverride, setDisplayOverride, numberOverride, rarityOverride, cardId: newCardId } }
// Auth required — user must own the binder

const { getBinder, putBinder } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug, cardId, query, updates } = JSON.parse(event.body);
    if (!slug)    return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };
    if (!updates) return { statusCode: 400, body: JSON.stringify({ error: "Missing updates" }) };

    const binder = await getBinder(slug);
    if (!binder)                   return { statusCode: 404, body: JSON.stringify({ error: "Binder not found" }) };
    if (binder.email !== user.email) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

    const card = cardId
      ? binder.cards.find(c => c.cardId === cardId)
      : binder.cards.find(c => c.query  === query);

    if (!card) return { statusCode: 404, body: JSON.stringify({ error: "Card not found" }) };

    // Apply updates: null / empty string removes the field; anything else sets it
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === "") {
        delete card[key];
      } else {
        card[key] = value;
      }
    }

    await putBinder(slug, binder);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("update-card error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
