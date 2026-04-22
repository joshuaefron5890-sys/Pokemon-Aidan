// List all cards marked available=true across all public binders
// GET /.netlify/functions/list-for-sale
// No auth required

const { getManifest, getBinder } = require("./_blobs");

const NO_CACHE = { "Cache-Control": "no-store, no-cache", "Content-Type": "application/json" };

exports.handler = async () => {
  try {
    const manifest = await getManifest();
    const publicBinders = manifest.filter(b => b.public);

    const results = await Promise.all(
      publicBinders.map(async ({ slug, owner }) => {
        try {
          const binder = await getBinder(slug);
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
              binderOwner: owner,
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
