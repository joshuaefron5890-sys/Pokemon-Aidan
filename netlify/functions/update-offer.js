// POST /.netlify/functions/update-offer
// Body: { offerId, action, binderSlug }
// Actions: withdraw (initiator), accept/reject (recipient), delete (initiator, withdrawn only), dismiss (accepted/rejected)

const { getSentOffers, putSentOffers, getReceivedOffers, putReceivedOffers } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { offerId, action, binderSlug } = JSON.parse(event.body);
    if (!offerId || !action) return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };

    if (action === "dismiss") {
      const DISMISSABLE = ["accepted", "rejected"];
      if (binderSlug) {
        // Recipient dismissing from their received list
        const received = await getReceivedOffers(binderSlug);
        const offer = received.find(o => o.id === offerId);
        if (!offer) return { statusCode: 404, body: JSON.stringify({ error: "Offer not found" }) };
        if (!DISMISSABLE.includes(offer.status)) return { statusCode: 400, body: JSON.stringify({ error: "Only accepted or rejected offers can be dismissed" }) };
        await putReceivedOffers(binderSlug, received.filter(o => o.id !== offerId));
      } else {
        // Initiator dismissing from their sent list
        const sent = await getSentOffers(user.sub);
        const offer = sent.find(o => o.id === offerId);
        if (!offer) return { statusCode: 404, body: JSON.stringify({ error: "Offer not found" }) };
        if (offer.initiatorId !== user.sub) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
        if (!DISMISSABLE.includes(offer.status)) return { statusCode: 400, body: JSON.stringify({ error: "Only accepted or rejected offers can be dismissed" }) };
        await putSentOffers(user.sub, sent.filter(o => o.id !== offerId));
      }
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }

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
