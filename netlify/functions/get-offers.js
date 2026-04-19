// GET /.netlify/functions/get-offers?slug={binderSlug}
// Returns { sent: [...], received: [...] }

const { getSentOffers, getReceivedOffers } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  const { slug } = event.queryStringParameters || {};

  try {
    const [sent, received] = await Promise.all([
      getSentOffers(user.sub),
      slug ? getReceivedOffers(slug) : Promise.resolve([]),
    ]);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sent, received }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
