// Serve profile photos — Netlify Blobs first, GitHub raw fallback for unmigrated slugs
// GET /.netlify/functions/get-photo?slug=<binder-slug>

const { getPhoto, putPhoto } = require("./_blobs");

const GITHUB_REPO = "joshuaefron5890-sys/Pokemon-Aidan";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) return { statusCode: 400, body: "Missing slug" };

  try {
    const buf = await getPhoto(slug);

    if (buf) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-cache" },
        isBase64Encoded: true,
        body: Buffer.from(buf).toString("base64"),
      };
    }

    // Fall back to GitHub repo photo (pre-Blobs migration)
    const ghUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/binders/photos/${slug}.jpg`;
    const res = await fetch(ghUrl);
    if (!res.ok) return { statusCode: 404, body: "Photo not found" };

    const arrayBuf = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    // Write-through: cache in Blobs so future fetches skip GitHub
    putPhoto(slug, base64).catch(() => {});
    return {
      statusCode: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600" },
      isBase64Encoded: true,
      body: base64,
    };
  } catch (err) {
    console.error("get-photo error:", err);
    return { statusCode: 500, body: err.message };
  }
};
