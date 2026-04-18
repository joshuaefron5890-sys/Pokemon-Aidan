// POST /.netlify/functions/remove-photo
// Deletes the profile photo for the authenticated user's binder

const { deletePhoto, getBinder, putBinder } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug } = JSON.parse(event.body);
    if (!slug) return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };

    if (slug !== "aidan") {
      const binder = await getBinder(slug);
      if (!binder) return { statusCode: 404, body: JSON.stringify({ error: "Binder not found" }) };
      if (binder.email !== user.email) return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
      binder.hasPhoto = false;
      await putBinder(slug, binder);
    }

    await deletePhoto(slug);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("remove-photo error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
