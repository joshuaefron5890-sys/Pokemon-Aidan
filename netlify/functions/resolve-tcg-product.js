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

    // og:image — card image hosted on TCGPlayer CDN
    const imageUrl =
      html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)?.[1] ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i)?.[1] ||
      "";

    // Price — try JSON-LD structured data first, then og:price meta tag
    let price = null;
    const ldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
    if (ldMatch) {
      for (const block of ldMatch) {
        try {
          const json = JSON.parse(block.replace(/<\/?script[^>]*>/gi, ""));
          const offers = json.offers || (Array.isArray(json) && json.find(j => j.offers)?.offers);
          const offerPrice = Array.isArray(offers) ? offers[0]?.price : offers?.price;
          if (offerPrice != null) { price = parseFloat(offerPrice) || null; break; }
        } catch {}
      }
    }
    if (price == null) {
      const ogPrice =
        html.match(/<meta[^>]+property="og:price:amount"[^>]+content="([^"]+)"/i)?.[1] ||
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:price:amount"/i)?.[1];
      if (ogPrice) price = parseFloat(ogPrice) || null;
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ title, slug, finalUrl, imageUrl, price }),
    };
  } catch (err) {
    console.error("resolve-tcg-product error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
