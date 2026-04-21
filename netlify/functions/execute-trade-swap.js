// POST /.netlify/functions/execute-trade-swap
// Body: { tradeId, recipientSlug }
// Swaps cards between both binders when a trade is accepted.
// Caller must be the owner of recipientSlug (the trade recipient).

const {
  getBinder, putBinder, getManifest, putManifest,
  getSentTrades, putSentTrades,
  getReceivedTrades, putReceivedTrades,
} = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const CORS = { "Content-Type": "application/json" };

  try {
    const { tradeId, recipientSlug } = JSON.parse(event.body || "{}");
    if (!tradeId || !recipientSlug) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing tradeId or recipientSlug" }) };
    }

    // Verify current user owns recipientSlug
    const manifest = await getManifest();
    const recipientEntry = manifest.find(b => b.slug === recipientSlug);
    if (!recipientEntry || recipientEntry.email !== user.email) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "You don't own this binder" }) };
    }

    // Load trade and validate
    const receivedTrades = await getReceivedTrades(recipientSlug);
    const trade = receivedTrades.find(t => t.id === tradeId);
    if (!trade) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Trade not found" }) };
    if (trade.status !== "accepted") {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Trade must be accepted before swapping" }) };
    }
    if (trade.swapExecuted) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Swap already executed" }) };
    }

    // Find initiator's binder slug via manifest
    const initiatorEntry = manifest.find(b => b.email === trade.initiatorEmail);
    if (!initiatorEntry) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Could not find the other trader's binder" }) };
    }
    const initiatorSlug = initiatorEntry.slug;

    // Load both binders
    const [recipientBinder, initiatorBinder] = await Promise.all([
      getBinder(recipientSlug),
      getBinder(initiatorSlug),
    ]);
    if (!recipientBinder || !initiatorBinder) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "One or both binders not found" }) };
    }

    // ── Identify cards to move ──────────────────────────────
    // wantedCards: leave recipient, go to initiator
    const wantedIds  = new Set(trade.wantedCards.map(c => c.cardId).filter(Boolean));
    const wantedQs   = new Set(trade.wantedCards.map(c => c.query).filter(Boolean));

    const toInitiator = [];
    recipientBinder.cards = recipientBinder.cards.filter(c => {
      const match = (c.cardId && wantedIds.has(c.cardId)) || wantedQs.has(c.query);
      if (match) toInitiator.push(c);
      return !match;
    });

    // offeredCards: leave initiator, go to recipient
    // offeredCards is stored as query strings; look up full card objects in initiator's binder
    const offeredSet = new Set(trade.offeredCards);
    const toRecipient = [];
    initiatorBinder.cards = initiatorBinder.cards.filter(c => {
      if (offeredSet.has(c.query)) { toRecipient.push(c); return false; }
      return true;
    });

    // ── Add cards (skip exact duplicates) ──────────────────
    const initiatorIds = new Set(initiatorBinder.cards.map(c => c.cardId).filter(Boolean));
    for (const card of toInitiator) {
      if (!card.cardId || !initiatorIds.has(card.cardId)) {
        initiatorBinder.cards.push(card);
        if (card.cardId) initiatorIds.add(card.cardId);
      }
    }

    const recipientIds = new Set(recipientBinder.cards.map(c => c.cardId).filter(Boolean));
    for (const card of toRecipient) {
      if (!card.cardId || !recipientIds.has(card.cardId)) {
        recipientBinder.cards.push(card);
        if (card.cardId) recipientIds.add(card.cardId);
      }
    }

    // ── Mark swap executed in both trade copies ─────────────
    const markSwapped = t => t.id === tradeId ? { ...t, swapExecuted: true } : t;
    const sentTrades  = await getSentTrades(trade.initiatorId);

    await Promise.all([
      putBinder(recipientSlug, recipientBinder),
      putBinder(initiatorSlug, initiatorBinder),
      putReceivedTrades(recipientSlug, receivedTrades.map(markSwapped)),
      putSentTrades(trade.initiatorId, sentTrades.map(markSwapped)),
    ]);

    // Update manifest card counts (non-fatal)
    try {
      await putManifest(manifest.map(b => {
        if (b.slug === recipientSlug) return { ...b, cardCount: recipientBinder.cards.length };
        if (b.slug === initiatorSlug) return { ...b, cardCount: initiatorBinder.cards.length };
        return b;
      }));
    } catch {}

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, addedToYou: toRecipient.length, sentFromYou: toInitiator.length }),
    };
  } catch (err) {
    console.error("execute-trade-swap error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
