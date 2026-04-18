// List all public binders — used for the Shared Binders gallery
// No auth required

const { getManifest } = require("./_blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  try {
    const manifest = await getManifest();

    const publicBinders = manifest
      .filter(b => b.public)
      .map(({ slug, owner, cardCount, createdAt, hasPhoto }) => ({
        slug, owner, cardCount, createdAt,
        photoUrl: hasPhoto ? `/.netlify/functions/get-photo?slug=${slug}` : null,
      }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(publicBinders),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
