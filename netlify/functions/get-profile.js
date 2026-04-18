// GET /.netlify/functions/get-profile
// Returns the authenticated user's profile data (location, etc.)

const { getProfileData } = require("./_blobs");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };

  try {
    const data = await getProfileData(user.sub);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("get-profile error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
