// Create a new binder for an authenticated user
// POST { slug, owner, isPublic, cards, photo? }
// Requires Netlify Identity auth

const { getManifest, putManifest, putBinder, putPhoto, putLocation } = require("./_blobs");
const { getFile } = require("./_gh");

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
    const { slug, owner, isPublic, cards, photo, location } = JSON.parse(event.body);

    if (!slugValid(slug)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid slug. Use 3-30 lowercase letters, numbers, and hyphens." }) };
    }
    if (!owner || !owner.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Owner name is required." }) };
    }

    // Load Blobs manifest (new binders) + GitHub manifest (legacy) for duplicate checks
    const blobsManifest = await getManifest();
    let ghManifest = [];
    try {
      const file = await getFile("binders/manifest.json");
      if (file) ghManifest = JSON.parse(file.content);
    } catch { /* GitHub manifest optional */ }

    const allBinders = [...blobsManifest, ...ghManifest];

    if (allBinders.some(b => b.slug === slug)) {
      return { statusCode: 409, body: JSON.stringify({ error: `The URL "/binder/${slug}" is already taken. Try a different name.` }) };
    }
    if (allBinders.some(b => b.email === user.email)) {
      return { statusCode: 409, body: JSON.stringify({ error: "You already have a binder. Visit /admin to manage it." }) };
    }

    const now      = new Date().toISOString();
    const hasPhoto = typeof photo === "string" && photo.length > 0;

    if (hasPhoto) {
      await putPhoto(slug, photo);
    }

    const binder = {
      slug,
      owner:     owner.trim(),
      email:     user.email,
      public:    Boolean(isPublic),
      hasPhoto,
      createdAt: now,
      cards:     Array.isArray(cards) ? cards : [],
    };

    await putBinder(slug, binder);

    blobsManifest.push({ slug, owner: owner.trim(), email: user.email, public: Boolean(isPublic), hasPhoto, cardCount: binder.cards.length, createdAt: now });
    await putManifest(blobsManifest);

    if (location?.city && location?.state) {
      await putLocation(slug, { city: location.city, state: location.state });
    }

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
