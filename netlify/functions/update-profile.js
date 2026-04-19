// POST /.netlify/functions/update-profile
// Merges the request body into the user's profile data

const { getProfileData, putProfileData, putLocation } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const { slug, ...update } = JSON.parse(event.body);
    const existing = await getProfileData(user.sub);
    await putProfileData(user.sub, { ...existing, ...update });
    // Persist location publicly by slug so binder pages can display it
    if (slug && update.location?.city) {
      const { city, state } = update.location;
      await putLocation(slug, { city, state });
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("update-profile error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
