// POST /.netlify/functions/create-offer
// Body: { cards: card[], price, message }
// (also accepts legacy card: single — wrapped to array)

const { getSentOffers, putSentOffers, getReceivedOffers, putReceivedOffers } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const body = JSON.parse(event.body);
    // Support both cards (array) and legacy card (single)
    const cards = body.cards || (body.card ? [body.card] : null);
    const { price, message } = body;
    if (!cards?.length || !cards[0].binderSlug || !price || Number(price) <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid fields" }) };
    }

    const binderSlug = cards[0].binderSlug;
    const offer = {
      id:             `offer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status:         "pending",
      cards,
      price:          Number(price),
      message:        (message || "").trim(),
      initiatorId:    user.sub,
      initiatorEmail: user.email,
      initiatorName:  user.user_metadata?.full_name || user.email.split("@")[0],
      createdAt:      new Date().toISOString(),
    };

    const [sent, received] = await Promise.all([
      getSentOffers(user.sub),
      getReceivedOffers(binderSlug),
    ]);
    sent.unshift(offer);
    received.unshift(offer);
    await Promise.all([
      putSentOffers(user.sub, sent),
      putReceivedOffers(binderSlug, received),
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
