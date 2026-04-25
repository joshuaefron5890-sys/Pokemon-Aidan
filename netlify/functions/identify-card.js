// POST /.netlify/functions/identify-card
// Body: { imageData: base64string, mediaType: "image/jpeg" }
//
// Pipeline:
//  1. Google Vision Web Detection → looks for TCGPlayer URLs in matching pages
//     → if found: parse slug for name/number, search TCGdex/pokemontcg.io
//  2. If Vision finds no TCGPlayer URL: use web entities for name + OCR locale
//     for language + OCR text for card number → route to APIs
//  3. Fall back to Claude Sonnet if Vision is unavailable or returns nothing useful

const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
const GOOGLE_VISION_KEY = process.env.GOOGLE_VISION_API_KEY;
const TCG_API    = "https://api.pokemontcg.io/v2";
const TCGDEX_EN  = "https://api.tcgdex.net/v2/en/cards";
const TCGDEX_JA  = "https://api.tcgdex.net/v2/ja/cards";

const COUNTRY_MARKERS = new Set([
  "japan","japanese","korean","chinese","german","french",
  "italian","spanish","portuguese","thai",
]);

// ── Slug parser — mirrors add-card-modal.js parseSlugForCard ──────────────────
function parseSlug(slug) {
  if (!slug) return { name: "", number: "", isNonEnglish: false };
  let parts = slug.replace(/^pokemon-/, "").split("-").filter(Boolean);

  // Peel trailing digit groups: "toxtricity-089-080" → number="89", parts=[..., "toxtricity"]
  let number = "";
  while (parts.length && /^\d+$/.test(parts[parts.length - 1])) {
    if (!number) number = parseInt(parts[parts.length - 1], 10).toString();
    parts.pop();
  }

  if (!parts.length) return { name: "", number, isNonEnglish: false };

  const isNonEnglish = COUNTRY_MARKERS.has(parts[0].toLowerCase());
  const nameParts = isNonEnglish ? parts.slice(1) : parts;

  const suffixes = new Set(["ex","gx","v","vmax","vstar","mega","break","prime"]);
  const last = nameParts[nameParts.length - 1]?.toLowerCase();
  const name = (last && suffixes.has(last) && nameParts.length >= 2)
    ? nameParts.slice(-2).join(" ")
    : (nameParts[nameParts.length - 1] || "");

  return { name, number, isNonEnglish };
}

// ── TCGdex search (tries multiple number formats + JA endpoint) ───────────────
async function tcgdexSearch(name, number, language) {
  const numClean  = number ? number.replace(/^0+/, "") || "0" : "";
  const numPadded = number ? number.padStart(3, "0") : "";
  const tries = [];

  if (number) {
    tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (numClean !== number)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numClean)}`);
    if (numPadded !== number && numPadded !== numClean)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numPadded)}`);
  }

  const isJapanese = language && language.toLowerCase().includes("japan");
  if (isJapanese && number) {
    tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (numClean !== number)
      tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numClean)}`);
  }

  tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}`);
  if (isJapanese) tries.push(`${TCGDEX_JA}?name=${encodeURIComponent(name)}`);

  for (const url of tries) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) continue;
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

function formatTcgdex(cards, tcgUrl = "") {
  return cards.filter(c => c.id).map(c => ({
    cardId:      c.id,
    query:       `${c.name} ${c.localId || ""}`.trim(),
    setName:     c.set?.name || "",
    marketPrice: null,
    tcgUrl,
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

// ── Google Vision Web Detection ───────────────────────────────────────────────
async function visionDetect(imageData) {
  const res = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: imageData },
          features: [
            { type: "WEB_DETECTION",  maxResults: 10 },
            { type: "TEXT_DETECTION", maxResults: 1  },
          ],
        }],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Vision API ${res.status}`);
  }
  const { responses } = await res.json();
  return responses?.[0] || null;
}

// Pull a card number out of raw OCR text — looks for NNN/NNN or NN/NNN
function extractNumberFromOCR(text) {
  const m = text.match(/\b(\d{1,3})\/(\d{2,3})\b/);
  return m ? parseInt(m[1], 10).toString() : "";
}

// Map Vision OCR locale codes to our language strings
function localeToLanguage(locale) {
  if (!locale) return "English";
  const l = locale.split("-")[0].toLowerCase();
  const map = { ja: "Japanese", ko: "Korean", zh: "Chinese", de: "German", fr: "French", it: "Italian", es: "Spanish", pt: "Portuguese" };
  return map[l] || "English";
}

// ── Claude fallback ───────────────────────────────────────────────────────────
async function claudeIdentify(imageData, mediaType) {
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
      system: `You are a Pokémon card identifier. Examine the card image carefully.

STEP 1 — Determine language: Look at the TEXT printed on the card body (card name, HP label, attack names, flavor text). Japanese cards have kanji/hiragana/katakana characters. Korean cards use Hangul. English cards use only the Latin alphabet. Do NOT infer language from the Pokémon's name alone.

STEP 2 — Extract fields and return ONLY this JSON:
- "name": Pokémon name in English (translate from Japanese/Korean/etc. if needed)
- "number": digits before the slash in the bottom corner, e.g. "089" from "089/080"
- "set": set name if legible, otherwise omit
- "language": language of the printed text — "English", "Japanese", "Korean", "Chinese", etc.

Japanese card example: {"name": "Toxtricity", "number": "089", "language": "Japanese"}
English card example:  {"name": "Charizard", "number": "4", "set": "Base Set", "language": "English"}

If you cannot identify the card: {"error": "Could not identify card"}

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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude error ${res.status}`);
  }
  const claude = await res.json();
  const text   = claude.content.find(b => b.type === "text")?.text ?? "";
  const match  = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse Claude response");
  return JSON.parse(match[0]);
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const CORS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  try {
    const { imageData, mediaType = "image/jpeg" } = JSON.parse(event.body || "{}");
    if (!imageData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing imageData" }) };

    // ── Stage 1: Google Vision ────────────────────────────────────────────────
    if (GOOGLE_VISION_KEY) {
      const vision = await visionDetect(imageData).catch(err => {
        console.warn("Vision API failed:", err.message);
        return null;
      });

      if (vision) {
        const web   = vision.webDetection || {};
        const texts = vision.textAnnotations || [];
        const ocrText   = texts[0]?.description || "";
        const ocrLocale = texts[0]?.locale || "en";

        // ── 1a. TCGPlayer URL found in matching pages — best case ─────────────
        const pages = [
          ...(web.pagesWithMatchingImages || []),
          ...(web.fullMatchingImages || []).map(i => ({ url: i.url })),
        ];
        const tcgPage = pages.find(p =>
          /tcgplayer\.com\/product\/\d+\/[^?#\s]+/i.test(p.url)
        );

        if (tcgPage) {
          const urlMatch = tcgPage.url.match(/tcgplayer\.com\/product\/(\d+)\/([^?#\s]+)/i);
          const productId = urlMatch?.[1] || "";
          const slug      = urlMatch?.[2] || "";
          const tcgUrl    = `https://www.tcgplayer.com/product/${productId}/${slug}`;
          const { name, number, isNonEnglish } = parseSlug(slug);

          if (name) {
            const language = isNonEnglish ? "Japanese" : "English";

            if (isNonEnglish) {
              const tcgCards = await tcgdexSearch(name, number, language).catch(() => []);
              if (tcgCards.length) {
                return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatTcgdex(tcgCards, tcgUrl) }) };
              }
              // TCGdex miss — return usable entry with TCGPlayer URL so price/image can be fetched
              const displayName = name.replace(/\b\w/g, c => c.toUpperCase()) + (number ? ` ${number}` : "") + " (Japanese)";
              return { statusCode: 200, headers: CORS, body: JSON.stringify({
                cards: [{ cardId: "", query: displayName, setName: "Japanese", marketPrice: null, tcgUrl, imageUrl: "" }],
              }) };
            }

            // English card with TCGPlayer URL → search pokemontcg.io
            const numClean = number.replace(/^0+/, "") || number;
            let cards = [];
            for (const num of [...new Set([number, numClean])]) {
              const q = `name:"${name}" number:"${num}"`;
              const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
              if (r.ok) { const { data } = await r.json(); if (data?.length) { cards = data; break; } }
            }
            if (!cards.length) {
              const q = `name:"${name}"`;
              const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=6&orderBy=-set.releaseDate`);
              if (r.ok) { const { data } = await r.json(); if (data?.length) cards = data; }
            }
            if (cards.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatPokemonTcg(cards) }) };
          }
        }

        // ── 1b. No TCGPlayer URL — use web entities + OCR ────────────────────
        const SKIP = new Set(["pokémon","pokemon","trading card","trading card game","tcg","card","collectible card game"]);
        const topEntity = (web.webEntities || []).find(e =>
          e.description && !SKIP.has(e.description.toLowerCase()) && (e.score || 0) >= 0.5
        );
        const bestLabel = (web.bestGuessLabels?.[0]?.label || "")
          .replace(/\s*\(.*?\)/g, "")
          .replace(/pokémon|pokemon/gi, "")
          .trim();

        const name = topEntity?.description || bestLabel;
        const number = extractNumberFromOCR(ocrText);
        const language = localeToLanguage(ocrLocale);
        const isEnglish = language === "English";

        if (name) {
          console.log(`Vision entity path: name="${name}" number="${number}" language="${language}"`);

          if (!isEnglish) {
            const tcgCards = await tcgdexSearch(name, number, language).catch(() => []);
            if (tcgCards.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatTcgdex(tcgCards) }) };
            const query = `${name}${number ? ` ${number}` : ""} (${language})`;
            return { statusCode: 200, headers: CORS, body: JSON.stringify({
              cards: [{ cardId: "", query, setName: language, marketPrice: null, tcgUrl: "", imageUrl: "" }],
            }) };
          }

          // English — pokemontcg.io
          let cards = [];
          const numClean = number.replace(/^0+/, "") || number;
          if (number) {
            for (const num of [...new Set([number, numClean])]) {
              const q = `name:"${name}" number:"${num}"`;
              const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
              if (r.ok) { const { data } = await r.json(); if (data?.length) { cards = data; break; } }
            }
          }
          if (!cards.length) {
            const q = `name:"${name}"`;
            const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=6&orderBy=-set.releaseDate`);
            if (r.ok) { const { data } = await r.json(); if (data?.length) cards = data; }
          }
          if (cards.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatPokemonTcg(cards) }) };
        }
      }
    }

    // ── Stage 2: Claude fallback ──────────────────────────────────────────────
    console.log("Falling back to Claude for card identification");
    const { error, name, number, set, language } = await claudeIdentify(imageData, mediaType);
    if (error || !name) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: [] }) };

    const numPart   = (number || "").split("/")[0].trim();
    const isEnglish = !language || language.toLowerCase() === "english";

    if (!isEnglish) {
      const tcgCards = await tcgdexSearch(name, numPart, language).catch(() => []);
      if (tcgCards.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatTcgdex(tcgCards) }) };
      const query = `${name}${numPart ? ` ${numPart}` : ""} (${language})`;
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        cards: [{ cardId: "", query, setName: language, marketPrice: null, tcgUrl: "", imageUrl: "" }],
      }) };
    }

    let cards = [];
    const numClean = numPart.replace(/^0+/, "") || numPart;
    if (numPart) {
      for (const num of [...new Set([numPart, numClean])]) {
        const q = `name:"${name}" number:"${num}"`;
        const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
        if (r.ok) { const { data } = await r.json(); if (data?.length) { cards = data; break; } }
      }
    }
    if (!cards.length && set) {
      const q = `name:"${name}" set.name:"${set}"`;
      const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=4&orderBy=-set.releaseDate`);
      if (r.ok) { const { data } = await r.json(); if (data?.length) cards = data; }
    }
    if (!cards.length) {
      const q = `name:"${name}"`;
      const r = await fetch(`${TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=6&orderBy=-set.releaseDate`);
      if (r.ok) { const { data } = await r.json(); if (data?.length) cards = data; }
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatPokemonTcg(cards) }) };

  } catch (err) {
    console.error("identify-card error:", err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
