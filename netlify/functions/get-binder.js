// Fetch binder data by slug
// Public binders: no auth needed
// Private binders: requires JWT with matching owner email

const { getFile } = require("./_gh");
const GITHUB_REPO = "joshuaefron5890-sys/Pokemon-Aidan";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate", "Content-Type": "application/json" };

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { slug } = event.queryStringParameters || {};
  if (!slug) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing slug" }) };
  }

  try {
    const file = await getFile(`binders/${slug}.json`);
    if (!file) {
      return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Binder not found" }) };
    }

    const binder = JSON.parse(file.content);
    const user   = context.clientContext?.user;
    const isOwner = user?.email === binder.email;

    if (!binder.public && !isOwner) {
      return {
        statusCode: 403,
        headers: NO_CACHE,
        body: JSON.stringify({ error: "private", owner: binder.owner }),
      };
    }

    const photoUrl = binder.hasPhoto
      ? `https://raw.githubusercontent.com/${GITHUB_REPO}/main/binders/photos/${binder.slug}.jpg`
      : null;

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
      }),
    };
  } catch (err) {
    console.error("get-binder error:", err);
    return {
      statusCode: 500,
      headers: NO_CACHE,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
