// POST /.netlify/functions/create-offer
// Body: { card: { cardId, query, imageUrl, binderSlug, binderOwner }, price, message }

const { getSentOffers, putSentOffers, getReceivedOffers, putReceivedOffers } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { card, price, message } = JSON.parse(event.body);
    if (!card?.binderSlug || !price || Number(price) <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid fields" }) };
    }

    const offer = {
      id:             `offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status:         "pending",
      card,
      price:          Number(price),
      message:        (message || "").trim(),
      initiatorId:    user.sub,
      initiatorEmail: user.email,
      createdAt:      new Date().toISOString(),
    };

    const [sent, received] = await Promise.all([
      getSentOffers(user.sub),
      getReceivedOffers(card.binderSlug),
    ]);
    sent.unshift(offer);
    received.unshift(offer);
    await Promise.all([
      putSentOffers(user.sub, sent),
      putReceivedOffers(card.binderSlug, received),
    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, offerId: offer.id }),
    };
  } catch (err) {
    console.error("create-offer error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
