// POST /.netlify/functions/identify-card
// Body: { imageData: base64string, mediaType: "image/jpeg" }
// Uses Claude vision to identify the card name/number/set/language,
// then looks it up in pokemontcg.io (English) or TCGdex (Japanese/other).
// Returns { cards: [{cardId, query, setName, marketPrice, tcgUrl, imageUrl}] }

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TCG_API    = "https://api.pokemontcg.io/v2";
const TCGDEX_EN  = "https://api.tcgdex.net/v2/en/cards";
const TCGDEX_JA  = "https://api.tcgdex.net/v2/ja/cards";

// Returns [] on any failure. Tries multiple number formats and falls back to
// a name-only search filtered by number in JS.
async function tcgdexSearch(name, number, language) {
  const numClean   = number ? number.replace(/^0+/, "") || "0" : "";  // strip leading zeros
  const numPadded  = number ? number.padStart(3, "0") : "";           // ensure 3-digit padding

  // Candidate (URL, endpoint) pairs — tried in order, return on first hit
  const tries = [];

  // Primary endpoint: English (covers all sets with English names)
  if (number) {
    tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (numClean !== number)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numClean)}`);
    if (numPadded !== number && numPadded !== numClean)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numPadded)}`);
  }

  // If language is Japanese, also try the Japanese endpoint (covers JP-exclusive sets)
  const isJapanese = language && language.toLowerCase().includes("japan");
  if (isJapanese && number) {
    tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (numClean !== number)
      tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numClean)}`);
  }

  // Name-only fallbacks (post-filter by number in JS)
  tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}`);
  if (isJapanese)
    tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}`);

  for (const url of tries) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) continue;

      // For name-only results, prefer cards whose localId matches the detected number
      if (number && d.length > 1) {
        const targets = new Set([number, numClean, numPadded].filter(Boolean));
        const exact = d.filter(c => targets.has(String(c.localId)));
        if (exact.length) return exact.slice(0, 4);
      }

      return d.slice(0, 6);
    } catch { /* try next */ }
  }

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
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        system: `You are a Pokémon card identifier. Examine the card image carefully and return ONLY a JSON object with these fields:

- "name": the Pokémon's name in English (translate if the card is not in English)
- "number": the card number printed in the bottom corner — read it EXACTLY as printed, e.g. "089" from "089/080", or "204" from "204/191". Include only the number before the slash.
- "set": the set name in English if visible, otherwise omit
- "language": the card's language, e.g. "English", "Japanese", "Korean", "Chinese"

Example output: {"name": "Toxtricity", "number": "089", "set": "Inferno X", "language": "Japanese"}

If you cannot identify the card at all, return: {"error": "Could not identify card"}

Return ONLY the JSON — no explanation, no markdown.`,
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

    // Use only the part before "/" so "089/080" → "089"
    const numPart = (number || "").split("/")[0].trim();
    const isEnglish = !language || language.toLowerCase() === "english";

    // ── Non-English: try TCGdex (EN + JA endpoints), fall back to name-only entry ──
    if (!isEnglish) {
      const tcgCards = await tcgdexSearch(name, numPart, language).catch(() => []);
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
