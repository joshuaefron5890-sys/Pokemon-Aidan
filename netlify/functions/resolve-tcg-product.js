// GET /.netlify/functions/resolve-tcg-product?productId=623606
// Fetches the TCGPlayer product page server-side and extracts the card name
// from the og:title or redirected URL slug — used for bare /product/{id} URLs
// that contain no descriptive slug.

const HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return { statusCode: 405 };

  const { productId } = event.queryStringParameters || {};
  if (!productId || !/^\d+$/.test(productId)) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Missing or invalid productId" }) };
  }

  try {
    const res = await fetch(`https://www.tcgplayer.com/product/${productId}`, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept":     "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) throw new Error(`TCGPlayer returned ${res.status}`);

    const finalUrl = res.url || "";

    // If TCGPlayer redirected to a URL that contains a slug, return it
    const slugMatch = finalUrl.match(/\/product\/\d+\/([^/?#]+)/);
    const slug = slugMatch?.[1] || "";

    const html = await res.text();

    // og:title (preferred — most specific)
    let title =
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
      "";

    // Strip trailing " | TCGplayer" and similar suffixes
    title = title.replace(/\s*[|–—].*$/, "").trim();

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ title, slug, finalUrl }),
    };
  } catch (err) {
    console.error("resolve-tcg-product error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
