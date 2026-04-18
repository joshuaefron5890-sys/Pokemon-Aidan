// GET /.netlify/functions/get-trades?slug=<binderSlug>
// Returns { sent, received } for the authenticated user

const { getSentTrades, getReceivedTrades } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const binderSlug = event.queryStringParameters?.slug || null;

    const [sent, received] = await Promise.all([
      getSentTrades(user.sub),
      binderSlug ? getReceivedTrades(binderSlug) : Promise.resolve([]),
    ]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent, received }),
    };
  } catch (err) {
    console.error("get-trades error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
