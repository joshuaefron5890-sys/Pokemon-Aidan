// GET /.netlify/functions/get-trade-messages?tradeId=...&mySlug=...
// Auth required — caller must be a party to the trade

const { getSentTrades, getReceivedTrades, getTradeMessages } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const { tradeId, mySlug } = event.queryStringParameters || {};
  if (!tradeId) return { statusCode: 400, body: JSON.stringify({ error: "Missing tradeId" }) };

  try {
    // Verify user is a party to this trade
    const sentTrades = await getSentTrades(user.sub);
    let trade = sentTrades.find(t => t.id === tradeId);
    if (!trade && mySlug) {
      const receivedTrades = await getReceivedTrades(mySlug);
      trade = receivedTrades.find(t => t.id === tradeId);
    }
    if (!trade) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

    const messages = await getTradeMessages(tradeId);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    };
  } catch (err) {
    console.error("get-trade-messages error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
