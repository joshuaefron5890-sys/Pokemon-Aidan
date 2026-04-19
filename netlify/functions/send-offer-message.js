// POST /.netlify/functions/send-offer-message
// Body: { offerId, mySlug, text }
// Auth required — caller must be a party to the offer

const { getSentOffers, getReceivedOffers, getOfferMessages, putOfferMessages } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { offerId, mySlug, text } = JSON.parse(event.body);
    if (!offerId || !text?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing offerId or text" }) };
    }

    const sentOffers = await getSentOffers(user.sub);
    let offer = sentOffers.find(o => o.id === offerId);
    if (!offer && mySlug) {
      const received = await getReceivedOffers(mySlug);
      offer = received.find(o => o.id === offerId);
    }
    if (!offer) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
    if (!["pending", "accepted"].includes(offer.status)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Cannot message on a closed offer" }) };
    }

    const messages = await getOfferMessages(offerId);
    messages.push({
      senderId:    user.sub,
      senderEmail: user.email,
      text:        text.trim(),
      timestamp:   new Date().toISOString(),
    });
    await putOfferMessages(offerId, messages);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("send-offer-message error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
