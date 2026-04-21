// POST /.netlify/functions/identify-card
// Body: { imageData: base64string, mediaType: "image/jpeg" }
// Makes a single Claude vision call to identify a Pokémon card.
// Returns { cards: [{cardId, query, setName, marketPrice, tcgUrl}] }
// Fast path — no tool loop, no TCG API — just Claude's vision.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TCG_API = "https://api.pokemontcg.io/v2";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const CORS = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  try {
    const { imageData, mediaType = "image/jpeg" } = JSON.parse(event.body || "{}");
    if (!imageData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing imageData" }) };

    // Ask Claude to identify the card from the image
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: `You are a Pokémon card identifier. Given an image of a Pokémon card, identify:
- The Pokémon name
- The card number (printed in the bottom corner, e.g. "204/191" or "066/198")
- The set name (printed near the bottom, e.g. "Surging Sparks")

Return ONLY a JSON object with these fields, no other text:
{"name": "Mesprit", "number": "204", "set": "Surging Sparks"}

If you cannot identify the card, return: {"error": "Could not identify card"}`,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
            { type: "text", text: "Identify this Pokémon card." },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Claude error ${res.status}`);
    }

    const claude = await res.json();
    const text = claude.content.find(b => b.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse Claude response");

    const identified = JSON.parse(jsonMatch[0]);
    if (identified.error) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: [] }) };

    // Look up the card in TCG API using name + number
    const { name, number, set } = identified;
    let cards = [];

    // Try name + number first
    if (number) {
      const numPart = number.split("/")[0];
      const q = `name:"${name}" number:"${numPart}"`;
      const tcgRes = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
      const { data } = await tcgRes.json();
      if (data?.length) cards = data;
    }

    // Fall back to name + set name
    if (!cards.length && set) {
      const q = `name:"${name}" set.name:"${set}"`;
      const tcgRes = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
      const { data } = await tcgRes.json();
      if (data?.length) cards = data;
    }

    // Fall back to name only
    if (!cards.length) {
      const q = `name:"${name}"`;
      const tcgRes = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=6&orderBy=-set.releaseDate`);
      const { data } = await tcgRes.json();
      if (data?.length) cards = data;
    }

    const result = cards.map(c => ({
      cardId:      c.id,
      query:       `${c.name} ${c.number}`,
      setName:     c.set?.name ?? "",
      marketPrice: c.tcgplayer?.prices?.holofoil?.market ?? c.tcgplayer?.prices?.normal?.market ?? null,
      tcgUrl:      c.tcgplayer?.url ?? "",
    }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: result }) };
  } catch (err) {
    console.error("identify-card error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
