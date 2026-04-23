// List all cards marked available=true across all public binders
// GET /.netlify/functions/list-for-sale
// No auth required — mirrors list-binders.js by merging Blobs + GitHub manifests

const { getManifest, getBinder, getLocation } = require("./_blobs");
const { getFile } = require("./_gh");

const NO_CACHE = { "Cache-Control": "no-store, no-cache", "Content-Type": "application/json" };

exports.handler = async () => {
  try {
    const blobsManifest = await getManifest();

    let ghManifest = [];
    try {
      const file = await getFile("binders/manifest.json");
      if (file) ghManifest = JSON.parse(file.content);
    } catch { /* GitHub manifest optional */ }

    // Merge: Blobs takes priority over GitHub for the same slug
    const seen   = new Set(blobsManifest.map(b => b.slug));
    const merged = [...blobsManifest, ...ghManifest.filter(b => !seen.has(b.slug))];
    const publicBinders = merged.filter(b => b.public);

    const results = await Promise.all(
      publicBinders.map(async ({ slug, owner }) => {
        try {
          const [binder, loc] = await Promise.all([
            getBinder(slug),
            getLocation(slug).catch(() => null),
          ]);
          if (!binder) return [];
          return (binder.cards || [])
            .filter(c => c.available)
            .map(c => ({
              query:       c.query,
              cardId:      c.cardId     || null,
              name:        c.nameOverride || c.query,
              imageUrl:    c.imageUrl   || null,
              setName:     c.setDisplayOverride || c.setName || null,
              grade:       c.grade      || null,
              price:       c.fallbackPrice ?? null,
              tcgUrl:      c.tcgUrl     || null,
              binderSlug:  slug,
              binderOwner: binder.owner || owner,
              binderZip:   loc?.zip   || null,
              binderCity:  loc?.city  || null,
              binderState: loc?.state || null,
            }));
        } catch {
          return [];
        }
      })
    );

    const cards = results.flat();

    return {
      statusCode: 200,
      headers: NO_CACHE,
      body: JSON.stringify({ cards }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: NO_CACHE,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
