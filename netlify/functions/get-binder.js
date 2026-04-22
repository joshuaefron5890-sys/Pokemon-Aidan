// Fetch binder data by slug
// Public binders: no auth needed
// Private binders: requires JWT with matching owner email
// Falls back to GitHub if not yet migrated to Blobs

const { getBinder, putBinder, getLocation } = require("./_blobs");
const { getFile } = require("./_gh");

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate", "Content-Type": "application/json" };

async function loadBinder(slug) {
  // Try Blobs first
  let binder = await getBinder(slug);
  if (binder) return binder;

  // Fall back to GitHub (pre-migration data), then auto-migrate
  const file = await getFile(`binders/${slug}.json`);
  if (!file) return null;
  binder = JSON.parse(file.content);
  // Migrate to Blobs silently so next read is fast
  putBinder(slug, binder).catch(() => {});
  return binder;
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) {
    return { statusCode: 400, headers: NO_CACHE, body: JSON.stringify({ error: "Missing slug" }) };
  }

  try {
    const binder = await loadBinder(slug);
    if (!binder) {
      return { statusCode: 404, headers: NO_CACHE, body: JSON.stringify({ error: "Binder not found" }) };
    }

    const user    = context.clientContext?.user;
    const isOwner = !!user?.email && user.email.toLowerCase() === binder.email?.toLowerCase();

    if (!binder.public && !isOwner) {
      return {
        statusCode: 403,
        headers: NO_CACHE,
        body: JSON.stringify({ error: "private", owner: binder.owner }),
      };
    }

    const photoUrl = binder.hasPhoto
      ? `/.netlify/functions/get-photo?slug=${binder.slug}`
      : null;

    const location = await getLocation(binder.slug);

    return {
      statusCode: 200,
      headers: NO_CACHE,
      body: JSON.stringify({
        slug:      binder.slug,
        owner:     binder.owner,
        public:    binder.public,
        createdAt: binder.createdAt,
        cards:     binder.cards,
        photoUrl,
        isOwner,
        location,
      }),
    };
  } catch (err) {
    console.error("get-binder error:", err);
    return { statusCode: 500, headers: NO_CACHE, body: JSON.stringify({ error: err.message }) };
  }
};
