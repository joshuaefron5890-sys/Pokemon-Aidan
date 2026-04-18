// Update profile photo for a binder owner
// POST { slug, photo } — photo is base64 JPEG
// Auth required — user must own the binder

const { getBinder, putBinder, putPhoto } = require("./_blobs");
const { getFile } = require("./_gh");

async function loadBinder(slug) {
  let b = await getBinder(slug);
  if (b) return b;
  const file = await getFile(`binders/${slug}.json`);
  return file ? JSON.parse(file.content) : null;
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug, photo } = JSON.parse(event.body);
    if (!slug || !photo) return { statusCode: 400, body: JSON.stringify({ error: "Missing slug or photo" }) };

    if (slug === "aidan") {
      // Site owner photo — stored in Blobs directly, no binder record needed
      await putPhoto("aidan", photo);
    } else {
      const binder = await loadBinder(slug);
      if (!binder) return { statusCode: 404, body: JSON.stringify({ error: "Binder not found" }) };
      if (binder.email !== user.email) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
      await putPhoto(slug, photo);
      binder.hasPhoto = true;
      await putBinder(slug, binder);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("update-photo error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
