// List all public binders — used for the Shared Binders gallery
// Merges Blobs manifest (new binders) + GitHub manifest (legacy binders)
// No auth required

const { getManifest, getLocation } = require("./_blobs");
const { getFile }     = require("./_gh");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  try {
    const blobsManifest = await getManifest();

    let ghManifest = [];
    try {
      const file = await getFile("binders/manifest.json");
      if (file) ghManifest = JSON.parse(file.content);
    } catch { /* GitHub manifest optional */ }

    // Merge: Blobs takes priority; GitHub fills in unmigrated binders
    const seen = new Set(blobsManifest.map(b => b.slug));
    const merged = [...blobsManifest, ...ghManifest.filter(b => !seen.has(b.slug))];

    const publicBinders = await Promise.all(
      merged
        .filter(b => b.public)
        .map(async ({ slug, owner, cardCount, createdAt, hasPhoto }) => ({
          slug, owner, cardCount, createdAt,
          photoUrl:  hasPhoto ? `/.netlify/functions/get-photo?slug=${slug}` : null,
          location:  await getLocation(slug),
        }))
    );

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
