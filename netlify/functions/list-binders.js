// List all public binders — used for the Shared Binders gallery
// No auth required

const { getFile } = require("./_gh");
const GITHUB_REPO = "joshuaefron5890-sys/Pokemon-Aidan";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  try {
    const file = await getFile("binders/manifest.json");
    const manifest = file ? JSON.parse(file.content) : [];

    const publicBinders = manifest
      .filter(b => b.public)
      .map(({ slug, owner, cardCount, createdAt, hasPhoto }) => ({
        slug, owner, cardCount, createdAt,
        photoUrl: hasPhoto
          ? `https://raw.githubusercontent.com/${GITHUB_REPO}/main/binders/photos/${slug}.jpg`
          : null,
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
