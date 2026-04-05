// Create a new binder for an authenticated user
// POST { slug, owner, isPublic, cards }
// Requires Netlify Identity auth

const { getFile, putFile } = require("./_gh");
const MANIFEST = "binders/manifest.json";

function slugValid(slug) {
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug);
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized — please sign in first." }),
    };
  }

  try {
    const { slug, owner, isPublic, cards } = JSON.parse(event.body);

    if (!slugValid(slug)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid slug. Use 3-30 lowercase letters, numbers, and hyphens." }) };
    }
    if (!owner || !owner.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Owner name is required." }) };
    }

    // Read manifest (create empty if missing)
    const manifestFile = await getFile(MANIFEST);
    const manifest = manifestFile ? JSON.parse(manifestFile.content) : [];

    // Check uniqueness
    if (manifest.some(b => b.slug === slug)) {
      return { statusCode: 409, body: JSON.stringify({ error: `The URL "/binder/${slug}" is already taken. Try a different name.` }) };
    }
    if (manifest.some(b => b.email === user.email)) {
      return { statusCode: 409, body: JSON.stringify({ error: "You already have a binder. Visit /admin to manage it." }) };
    }

    const now = new Date().toISOString();
    const binder = {
      slug,
      owner:     owner.trim(),
      email:     user.email,
      public:    Boolean(isPublic),
      createdAt: now,
      cards:     Array.isArray(cards) ? cards : [],
    };

    // Write binder JSON
    await putFile(`binders/${slug}.json`, JSON.stringify(binder, null, 2), null, `Create binder for ${owner.trim()}`);

    // Update manifest
    manifest.push({ slug, owner: owner.trim(), email: user.email, public: Boolean(isPublic), cardCount: binder.cards.length, createdAt: now });
    await putFile(MANIFEST, JSON.stringify(manifest, null, 2), manifestFile?.sha ?? null, `Add ${slug} to manifest`);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, owner: owner.trim(), url: `/binder/${slug}` }),
    };
  } catch (err) {
    console.error("create-binder error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
