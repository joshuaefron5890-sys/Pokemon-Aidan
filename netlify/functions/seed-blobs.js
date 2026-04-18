// One-time migration: copies binder JSON files from GitHub to Netlify Blobs
// POST /.netlify/functions/seed-blobs  (requires SEED_SECRET env var to match X-Seed-Key header)

const { getFile } = require("./_gh");
const { putBinder, putManifest } = require("./_blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const secret = process.env.SEED_SECRET;
  if (!secret || event.headers["x-seed-key"] !== secret) {
    return { statusCode: 403, body: "Forbidden" };
  }

  try {
    const mf = await getFile("binders/manifest.json");
    const manifest = mf ? JSON.parse(mf.content) : [];

    const results = [];
    for (const entry of manifest) {
      const file = await getFile(`binders/${entry.slug}.json`);
      if (file) {
        await putBinder(entry.slug, JSON.parse(file.content));
        results.push({ slug: entry.slug, ok: true });
      } else {
        results.push({ slug: entry.slug, ok: false, reason: "not found in GitHub" });
      }
    }

    await putManifest(manifest);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ migrated: results.length, results }),
    };
  } catch (err) {
    console.error("seed-blobs error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
