// POST /.netlify/functions/create-trade
// Body: { wantedCard, offeredCards: string[], message }

const { getSentTrades, putSentTrades, getReceivedTrades, putReceivedTrades } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { wantedCard, offeredCards, message } = JSON.parse(event.body);
    if (!wantedCard || !offeredCards?.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing wantedCard or offeredCards" }) };
    }

    const trade = {
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      createdAt: new Date().toISOString(),
      initiatorId: user.sub,
      initiatorEmail: user.email,
      initiatorName: user.user_metadata?.full_name || user.email.split("@")[0],
      wantedCard,
      offeredCards,
      message: message || "",
    };

    const [sent, received] = await Promise.all([
      getSentTrades(user.sub),
      getReceivedTrades(wantedCard.binderSlug),
    ]);

    sent.unshift(trade);
    received.unshift(trade);

    await Promise.all([
      putSentTrades(user.sub, sent),
      putReceivedTrades(wantedCard.binderSlug, received),
    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, trade }),
    };
  } catch (err) {
    console.error("create-trade error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
