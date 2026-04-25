// POST /.netlify/functions/identify-card
// Body: { imageData: base64string, mediaType: "image/jpeg" }
// Uses Claude vision to identify the card name/number/set/language,
// then looks it up in pokemontcg.io (English) or TCGdex (Japanese/other).
// Returns { cards: [{cardId, query, setName, marketPrice, tcgUrl, imageUrl}] }

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TCG_API   = "https://api.pokemontcg.io/v2";
const TCGDEX    = "https://api.tcgdex.net/v2/en/cards";

async function tcgdexSearch(name, number) {
  if (number) {
    const r = await fetch(`${TCGDEX}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return d; }
  }
  const r = await fetch(`${TCGDEX}?name=${encodeURIComponent(name)}`);
  if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return d.slice(0, 6); }
  return [];
}

function formatTcgdex(cards) {
  return cards.filter(c => c.id).map(c => ({
    cardId:      c.id,
    query:       `${c.name} ${c.localId || ""}`.trim(),
    setName:     c.set?.name || "",
    marketPrice: null,
    tcgUrl:      "",
    imageUrl:    c.image ? `${c.image}/high.webp` : "",
  }));
}

function formatPokemonTcg(cards) {
  return cards.map(c => ({
    cardId:      c.id,
    query:       `${c.name} ${c.number}`,
    setName:     c.set?.name ?? "",
    marketPrice: c.tcgplayer?.prices?.holofoil?.market ?? c.tcgplayer?.prices?.normal?.market ?? null,
    tcgUrl:      c.tcgplayer?.url ?? "",
    imageUrl:    "",
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const CORS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  try {
    const { imageData, mediaType = "image/jpeg" } = JSON.parse(event.body || "{}");
    if (!imageData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing imageData" }) };

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
- The Pokémon name in English (even if the card is in another language)
- The card number (printed in the bottom corner, e.g. "089/080" or "204/191")
- The set name in English if readable, otherwise your best guess
- The card language (e.g. "English", "Japanese", "Korean", "Chinese")

Return ONLY a JSON object — no other text:
{"name": "Toxtricity", "number": "089", "set": "Inferno X", "language": "Japanese"}

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
    const text   = claude.content.find(b => b.type === "text")?.text ?? "";
    const match  = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Could not parse Claude response");

    const { error, name, number, set, language } = JSON.parse(match[0]);
    if (error || !name) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: [] }) };

    const numPart = (number || "").split("/")[0];
    const isEnglish = !language || language.toLowerCase() === "english";

    // ── Non-English: try TCGdex, fall back to name-only entry ──
    if (!isEnglish) {
      const tcgCards = await tcgdexSearch(name, numPart).catch(() => []);
      if (tcgCards.length) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatTcgdex(tcgCards) }) };
      }
      // TCGdex miss — return identifiable info so the user can confirm/edit
      const query = `${name}${numPart ? ` ${numPart}` : ""} (${language})`;
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        cards: [{ cardId: "", query, setName: language, marketPrice: null, tcgUrl: "", imageUrl: "" }],
      }) };
    }

    // ── English: search pokemontcg.io ──
    let cards = [];

    if (numPart) {
      const q = `name:"${name}" number:"${numPart}"`;
      const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
      const { data } = await r.json();
      if (data?.length) cards = data;
    }

    if (!cards.length && set) {
      const q = `name:"${name}" set.name:"${set}"`;
      const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
      const { data } = await r.json();
      if (data?.length) cards = data;
    }

    if (!cards.length) {
      const q = `name:"${name}"`;
      const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=6&orderBy=-set.releaseDate`);
      const { data } = await r.json();
      if (data?.length) cards = data;
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatPokemonTcg(cards) }) };

  } catch (err) {
    console.error("identify-card error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
