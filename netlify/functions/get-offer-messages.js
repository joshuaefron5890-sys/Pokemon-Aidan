// GET /.netlify/functions/get-offer-messages?offerId=...&mySlug=...
// Auth required — caller must be a party to the offer

const { getSentOffers, getReceivedOffers, getOfferMessages } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const { offerId, mySlug } = event.queryStringParameters || {};
  if (!offerId) return { statusCode: 400, body: JSON.stringify({ error: "Missing offerId" }) };

  try {
    const sentOffers = await getSentOffers(user.sub);
    let offer = sentOffers.find(o => o.id === offerId);
    if (!offer && mySlug) {
      const received = await getReceivedOffers(mySlug);
      offer = received.find(o => o.id === offerId);
    }
    if (!offer) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

    const messages = await getOfferMessages(offerId);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    };
  } catch (err) {
    console.error("get-offer-messages error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
