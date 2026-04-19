// POST /.netlify/functions/update-offer
// Body: { offerId, action, binderSlug }
// Actions: withdraw (initiator), accept/reject (recipient), delete (initiator, withdrawn only)

const { getSentOffers, putSentOffers, getReceivedOffers, putReceivedOffers } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { offerId, action, binderSlug } = JSON.parse(event.body);
    if (!offerId || !action) return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };

    if (action === "withdraw" || action === "delete") {
      const sentOffers = await getSentOffers(user.sub);
      const offer = sentOffers.find(o => o.id === offerId);
      if (!offer) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

      if (action === "delete") {
        if (offer.status !== "withdrawn") {
          return { statusCode: 400, body: JSON.stringify({ error: "Can only delete withdrawn offers" }) };
        }
        await putSentOffers(user.sub, sentOffers.filter(o => o.id !== offerId));
      } else {
        offer.status = "withdrawn";
        const received = await getReceivedOffers(offer.card.binderSlug);
        const ro = received.find(o => o.id === offerId);
        if (ro) { ro.status = "withdrawn"; await putReceivedOffers(offer.card.binderSlug, received); }
        await putSentOffers(user.sub, sentOffers);
      }

    } else if (action === "accept" || action === "reject") {
      if (!binderSlug) return { statusCode: 400, body: JSON.stringify({ error: "Missing binderSlug" }) };
      const received = await getReceivedOffers(binderSlug);
      const ro = received.find(o => o.id === offerId);
      if (!ro) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

      ro.status = action === "accept" ? "accepted" : "rejected";
      await putReceivedOffers(binderSlug, received);

      // Mirror status update to sender's copy
      const initiatorSent = await getSentOffers(ro.initiatorId);
      const so = initiatorSent.find(o => o.id === offerId);
      if (so) { so.status = ro.status; await putSentOffers(ro.initiatorId, initiatorSent); }

    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("update-offer error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
