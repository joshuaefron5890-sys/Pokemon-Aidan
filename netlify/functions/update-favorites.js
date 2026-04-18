// POST /.netlify/functions/update-favorites
// Body: { action: "add"|"remove", card: { cardId, query, binderSlug, binderOwner, name, imageUrl } }

const { getFavorites, putFavorites } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { action, card } = JSON.parse(event.body);
    if (!action || !card) return { statusCode: 400, body: JSON.stringify({ error: "Missing action or card" }) };

    const data = await getFavorites(user.sub);

    if (action === "add") {
      const exists = data.cards.some(c =>
        c.binderSlug === card.binderSlug &&
        (card.cardId ? c.cardId === card.cardId : c.query === card.query)
      );
      if (!exists) data.cards.push({ ...card, addedAt: new Date().toISOString() });
    } else if (action === "remove") {
      data.cards = data.cards.filter(c =>
        !(c.binderSlug === card.binderSlug &&
          (card.cardId ? c.cardId === card.cardId : c.query === card.query))
      );
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid action" }) };
    }

    await putFavorites(user.sub, data);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, count: data.cards.length }),
    };
  } catch (err) {
    console.error("update-favorites error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
