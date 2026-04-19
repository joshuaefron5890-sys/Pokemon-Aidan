// POST /.netlify/functions/send-trade-message
// Body: { tradeId, mySlug, text }
// Auth required — caller must be a party to the trade

const { getSentTrades, getReceivedTrades, getTradeMessages, putTradeMessages } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { tradeId, mySlug, text } = JSON.parse(event.body);
    if (!tradeId || !text?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing tradeId or text" }) };
    }

    // Verify user is a party to this trade
    const sentTrades = await getSentTrades(user.sub);
    let trade = sentTrades.find(t => t.id === tradeId);
    if (!trade && mySlug) {
      const receivedTrades = await getReceivedTrades(mySlug);
      trade = receivedTrades.find(t => t.id === tradeId);
    }
    if (!trade) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
    if (!["pending", "accepted"].includes(trade.status)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Cannot message on a closed trade" }) };
    }

    const messages = await getTradeMessages(tradeId);
    messages.push({
      senderId:    user.sub,
      senderEmail: user.email,
      text:        text.trim(),
      timestamp:   new Date().toISOString(),
    });
    await putTradeMessages(tradeId, messages);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("send-trade-message error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
