const { setImageUrl } = require("./_blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Bad JSON" }; }
  const { cardId, imageUrl } = body;
  if (!cardId || !imageUrl || typeof cardId !== "string" || typeof imageUrl !== "string") {
    return { statusCode: 400, body: "Missing cardId or imageUrl" };
  }
  // Only cache stable external URLs, not local file overrides
  if (!imageUrl.startsWith("https://")) return { statusCode: 200, body: "skipped" };
  await setImageUrl(cardId, imageUrl);
  return { statusCode: 200, body: "ok" };
};
