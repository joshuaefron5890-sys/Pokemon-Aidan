// GET /.netlify/functions/get-my-binder
// Returns { slug, binderUrl } for the authenticated user's binder, or 404.

const { getManifest } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const manifest = await getManifest();
    const entry    = manifest.find(b => b.email === user.email);
    if (!entry) return { statusCode: 404, body: JSON.stringify({ error: "No binder found" }) };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: entry.slug, binderUrl: `/binder/${entry.slug}` }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
