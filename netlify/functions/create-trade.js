// POST /.netlify/functions/create-trade
// Body: { wantedCards: card[], offeredCards: string[], message }
// (also accepts legacy wantedCard: card — wrapped to array)

const { getSentTrades, putSentTrades, getReceivedTrades, putReceivedTrades } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const body = JSON.parse(event.body);
    // Support both wantedCards (array) and legacy wantedCard (single)
    const wantedCards = body.wantedCards || (body.wantedCard ? [body.wantedCard] : null);
    const { offeredCards, message } = body;
    if (!wantedCards?.length || !offeredCards?.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing wantedCards or offeredCards" }) };
    }

    const binderSlug = wantedCards[0].binderSlug;
    const trade = {
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      createdAt: new Date().toISOString(),
      initiatorId: user.sub,
      initiatorEmail: user.email,
      initiatorName: user.user_metadata?.full_name || user.email.split("@")[0],
      wantedCards,
      offeredCards,
      message: message || "",
    };

    const [sent, received] = await Promise.all([
      getSentTrades(user.sub),
      getReceivedTrades(binderSlug),
    ]);

    sent.unshift(trade);
    received.unshift(trade);

    await Promise.all([
      putSentTrades(user.sub, sent),
      putReceivedTrades(binderSlug, received),
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
