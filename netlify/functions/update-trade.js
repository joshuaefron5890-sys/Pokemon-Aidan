// POST /.netlify/functions/update-trade
// Body: { tradeId, action: "withdraw"|"accept"|"reject"|"delete", binderSlug }

const { getSentTrades, putSentTrades, getReceivedTrades, putReceivedTrades } = require("./_blobs");

const ACTION_STATUS = { withdraw: "withdrawn", accept: "accepted", reject: "rejected" };

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { tradeId, action, binderSlug } = JSON.parse(event.body);
    if (!tradeId) return { statusCode: 400, body: JSON.stringify({ error: "Missing tradeId" }) };

    // ── Delete a withdrawn trade from the sent list ──────────
    if (action === "delete") {
      const sent  = await getSentTrades(user.sub);
      const trade = sent.find(t => t.id === tradeId);
      if (!trade) return { statusCode: 404, body: JSON.stringify({ error: "Trade not found" }) };
      if (trade.initiatorId !== user.sub) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
      if (trade.status !== "withdrawn") return { statusCode: 400, body: JSON.stringify({ error: "Only withdrawn trades can be deleted" }) };

      await putSentTrades(user.sub, sent.filter(t => t.id !== tradeId));
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }

    const newStatus = ACTION_STATUS[action];
    if (!newStatus) return { statusCode: 400, body: JSON.stringify({ error: "Invalid action" }) };

    if (action === "withdraw") {
      const sent  = await getSentTrades(user.sub);
      const trade = sent.find(t => t.id === tradeId);
      if (!trade) return { statusCode: 404, body: JSON.stringify({ error: "Trade not found" }) };
      if (trade.initiatorId !== user.sub) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

      trade.status = newStatus;
      const received = await getReceivedTrades(trade.wantedCard.binderSlug);
      const rTrade   = received.find(t => t.id === tradeId);
      if (rTrade) rTrade.status = newStatus;

      await Promise.all([
        putSentTrades(user.sub, sent),
        putReceivedTrades(trade.wantedCard.binderSlug, received),
      ]);
    } else {
      if (!binderSlug) return { statusCode: 400, body: JSON.stringify({ error: "Missing binderSlug" }) };
      const received = await getReceivedTrades(binderSlug);
      const trade    = received.find(t => t.id === tradeId);
      if (!trade) return { statusCode: 404, body: JSON.stringify({ error: "Trade not found" }) };

      trade.status = newStatus;
      const sent   = await getSentTrades(trade.initiatorId);
      const sTrade = sent.find(t => t.id === tradeId);
      if (sTrade) sTrade.status = newStatus;

      await Promise.all([
        putReceivedTrades(binderSlug, received),
        putSentTrades(trade.initiatorId, sent),
      ]);
    }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("update-trade error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
