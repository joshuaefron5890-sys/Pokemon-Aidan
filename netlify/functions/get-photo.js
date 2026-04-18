// Serve profile photos stored in Netlify Blobs
// GET /.netlify/functions/get-photo?slug=<binder-slug>

const { getPhoto } = require("./_blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) return { statusCode: 400, body: "Missing slug" };

  try {
    const buf = await getPhoto(slug);
    if (!buf) return { statusCode: 404, body: "Photo not found" };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
      isBase64Encoded: true,
      body: Buffer.from(buf).toString("base64"),
    };
  } catch (err) {
    console.error("get-photo error:", err);
    return { statusCode: 500, body: err.message };
  }
};
