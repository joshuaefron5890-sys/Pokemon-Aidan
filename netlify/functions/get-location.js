// Public: returns { city, state } for a binder slug, or {} if not set
// GET /.netlify/functions/get-location?slug=<binder-slug>

const { getLocation } = require("./_blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) return { statusCode: 400, body: "Missing slug" };

  try {
    const loc = await getLocation(slug);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify(loc || {}),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
