// POST /.netlify/functions/set-binder-privacy
// Body: { slug, public: boolean }
// Updates the public flag on a binder. Only the owner may change their own binder.

const { getBinder, putBinder, getManifest, putManifest } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug, public: isPublic } = JSON.parse(event.body || "{}");
    if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };

    const binder = await getBinder(slug);
    if (!binder) return { statusCode: 404, body: JSON.stringify({ error: "Binder not found" }) };
    if (binder.email !== user.email) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };

    binder.public = !!isPublic;
    await putBinder(slug, binder);

    // Keep manifest in sync
    const manifest = await getManifest();
    const entry = manifest.find(b => b.slug === slug);
    if (entry) {
      entry.public = binder.public;
      await putManifest(manifest);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, public: binder.public }),
    };
  } catch (err) {
    console.error("set-binder-privacy error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
