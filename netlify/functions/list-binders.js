// List all public binders — used for the Shared Binders gallery
// No auth required

const { getFile } = require("./_gh");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  try {
    const file = await getFile("binders/manifest.json");
    const manifest = file ? JSON.parse(file.content) : [];

    const publicBinders = manifest
      .filter(b => b.public)
      .map(({ slug, owner, cardCount, createdAt }) => ({ slug, owner, cardCount, createdAt }));

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
