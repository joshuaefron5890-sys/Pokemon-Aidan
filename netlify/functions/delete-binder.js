// Delete a binder by slug — restricted to the site owner
// POST { slug }

const { getBinder, deleteBinder, getManifest, putManifest } = require("./_blobs");

const ADMIN_EMAIL = "joshuaefron5890@gmail.com";

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user || user.email !== ADMIN_EMAIL) {
    return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
  }

  try {
    const { slug } = JSON.parse(event.body);
    if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };

    // Delete the blob if it exists (ignore if already gone)
    await deleteBinder(slug).catch(() => {});

    // Always purge from manifest regardless of whether blob existed
    const manifest = await getManifest();
    const updated  = manifest.filter(b => b.slug !== slug);
    await putManifest(updated);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, deleted: slug }),
    };
  } catch (err) {
    console.error("delete-binder error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
