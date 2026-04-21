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

    // Load trade and recipient binder together, verify ownership via binder.email
    const [receivedTrades, recipientBinder, manifest] = await Promise.all([
      getReceivedTrades(recipientSlug),
      getBinder(recipientSlug),
      getManifest(),
    ]);

    if (!recipientBinder) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Recipient binder not found" }) };
    }
    if (recipientBinder.email !== user.email) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "You don't own this binder" }) };
    }

    const trade = receivedTrades.find(t => t.id === tradeId);
    if (!trade) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Trade not found" }) };
    if (trade.status !== "accepted") {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Trade must be accepted before swapping" }) };
    }
    if (trade.swapExecuted) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Swap already executed" }) };
    }

    // Find initiator's binder slug — prefer value stored on the trade (new trades),
    // fall back to manifest email match (case-insensitive), then owner name match.
    let initiatorSlug = trade.initiatorSlug || null;
    if (!initiatorSlug) {
      const byEmail = manifest.find(b =>
        b.email && b.email.toLowerCase() === trade.initiatorEmail.toLowerCase()
      );
      if (byEmail) initiatorSlug = byEmail.slug;
    }
    if (!initiatorSlug && trade.initiatorName) {
      const byName = manifest.find(b =>
        b.owner && b.owner.toLowerCase() === trade.initiatorName.toLowerCase()
      );
      if (byName) initiatorSlug = byName.slug;
    }

    // Load initiator's binder; if not found do a one-sided swap (recipient only)
    const initiatorBinder = initiatorSlug ? await getBinder(initiatorSlug) : null;

    // ── Identify cards to move ──────────────────────────────
    // wantedCards: remove from recipient, add to initiator
    const wantedIds = new Set(trade.wantedCards.map(c => c.cardId).filter(Boolean));
    const wantedQs  = new Set(trade.wantedCards.map(c => c.query).filter(Boolean));

    const toInitiator = [];
    recipientBinder.cards = recipientBinder.cards.filter(c => {
      const match = (c.cardId && wantedIds.has(c.cardId)) || wantedQs.has(c.query);
      if (match) toInitiator.push(c);
      return !match;
    });

    // offeredCards: remove from initiator (if binder found), add to recipient
    const offeredSet = new Set(trade.offeredCards);
    const toRecipient = [];
    if (initiatorBinder) {
      initiatorBinder.cards = initiatorBinder.cards.filter(c => {
        if (offeredSet.has(c.query)) { toRecipient.push(c); return false; }
        return true;
      });
    } else {
      // Initiator's binder not found — synthesise minimal card entries from trade data
      trade.offeredCards.forEach(q => toRecipient.push({ query: q }));
    }

    // ── Add cards (skip exact duplicates) ──────────────────
    if (initiatorBinder) {
      const initiatorIds = new Set(initiatorBinder.cards.map(c => c.cardId).filter(Boolean));
      for (const card of toInitiator) {
        if (!card.cardId || !initiatorIds.has(card.cardId)) {
          initiatorBinder.cards.push(card);
          if (card.cardId) initiatorIds.add(card.cardId);
        }
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

    const writes = [
      putBinder(recipientSlug, recipientBinder),
      putReceivedTrades(recipientSlug, receivedTrades.map(markSwapped)),
      putSentTrades(trade.initiatorId, sentTrades.map(markSwapped)),
    ];
    if (initiatorBinder && initiatorSlug) {
      writes.push(putBinder(initiatorSlug, initiatorBinder));
    }
    await Promise.all(writes);

    // Update manifest card counts (non-fatal)
    try {
      await putManifest(manifest.map(b => {
        if (b.slug === recipientSlug) return { ...b, cardCount: recipientBinder.cards.length };
        if (initiatorBinder && b.slug === initiatorSlug) return { ...b, cardCount: initiatorBinder.cards.length };
        return b;
      }));
    } catch {}

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        addedToYou: toRecipient.length,
        sentFromYou: toInitiator.length,
        initiatorBinderUpdated: !!initiatorBinder,
      }),
    };
  } catch (err) {
    console.error("execute-trade-swap error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
