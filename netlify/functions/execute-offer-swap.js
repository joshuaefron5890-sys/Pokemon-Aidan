// POST /.netlify/functions/execute-offer-swap
// Body: { offerId, recipientSlug }
// Removes the sold cards from the seller's binder when a cash offer is accepted.
// Caller must be the owner of recipientSlug.

const {
  getBinder, putBinder, getManifest, putManifest,
  getSentOffers, putSentOffers,
  getReceivedOffers, putReceivedOffers,
} = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const CORS = { "Content-Type": "application/json" };

  try {
    const { offerId, recipientSlug } = JSON.parse(event.body || "{}");
    if (!offerId || !recipientSlug) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing offerId or recipientSlug" }) };
    }

    // Load binder and offers together; verify ownership via binder.email
    const [binder, receivedOffers, manifest] = await Promise.all([
      getBinder(recipientSlug),
      getReceivedOffers(recipientSlug),
      getManifest(),
    ]);

    if (!binder) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Binder not found" }) };
    if (binder.email !== user.email) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "You don't own this binder" }) };
    }

    // Load offer and validate
    const offer = receivedOffers.find(o => o.id === offerId);
    if (!offer) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Offer not found" }) };
    if (offer.status !== "accepted") {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Offer must be accepted first" }) };
    }
    if (offer.swapExecuted) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Already executed" }) };
    }

    const cards   = offer.cards || (offer.card ? [offer.card] : []);
    const cardIds = new Set(cards.map(c => c.cardId).filter(Boolean));
    const queries = new Set(cards.map(c => c.query).filter(Boolean));

    const before = binder.cards.length;
    binder.cards = binder.cards.filter(c =>
      !(c.cardId && cardIds.has(c.cardId)) && !queries.has(c.query)
    );
    const removed = before - binder.cards.length;

    // Mark swap executed in both offer copies
    const markSwapped = o => o.id === offerId ? { ...o, swapExecuted: true } : o;
    const sentOffers  = await getSentOffers(offer.initiatorId);

    await Promise.all([
      putBinder(recipientSlug, binder),
      putReceivedOffers(recipientSlug, receivedOffers.map(markSwapped)),
      putSentOffers(offer.initiatorId, sentOffers.map(markSwapped)),
    ]);

    // Update manifest card count (non-fatal)
    try {
      await putManifest(manifest.map(b =>
        b.slug === recipientSlug ? { ...b, cardCount: binder.cards.length } : b
      ));
    } catch {}

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, removed }),
    };
  } catch (err) {
    console.error("execute-offer-swap error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
