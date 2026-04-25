// POST /.netlify/functions/identify-card
// Body: { imageData: base64string, mediaType: "image/jpeg" }
//
// Pipeline (parallel):
//  Vision WEB_DETECTION  → TCGPlayer URL (best case) + language + number from OCR
//  Claude Sonnet         → accurate English name (translates trainer cards like
//                          "ヒビキのマグカルゴ" → "Ethan's Magcargo") + number + language
//
// Merge: Claude's name (most accurate), Vision's TCGPlayer URL (bonus), best
// available number, then route to TCGdex (Japanese) or pokemontcg.io (English).

const ANTHROPIC_KEY     = process.env.ANTHROPIC_API_KEY;
const GOOGLE_VISION_KEY = process.env.GOOGLE_VISION_API_KEY;
const TCG_API    = "https://api.pokemontcg.io/v2";
const TCGDEX_EN  = "https://api.tcgdex.net/v2/en/cards";
const TCGDEX_JA  = "https://api.tcgdex.net/v2/ja/cards";

const COUNTRY_MARKERS = new Set([
  "japan","japanese","korean","chinese","german","french",
  "italian","spanish","portuguese","thai",
]);

// ── Slug parser ───────────────────────────────────────────────────────────────
function parseSlug(slug) {
  if (!slug) return { name: "", number: "", isNonEnglish: false };
  let parts = slug.replace(/^pokemon-/, "").split("-").filter(Boolean);
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

// ── TCGdex search ─────────────────────────────────────────────────────────────
async function tcgdexSearch(name, number, language) {
  const numClean  = number ? number.replace(/^0+/, "") || "0" : "";
  const numPadded = number ? number.padStart(3, "0") : "";
  const isJapanese = language && language.toLowerCase().includes("japan");
  const tries = [];

  if (number) {
    tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`);
    if (numClean !== number)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numClean)}`);
    if (numPadded !== number && numPadded !== numClean)
      tries.push(`${TCGDEX_EN}?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(numPadded)}`);
  }
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

function extractNumberFromOCR(text) {
  const m = text.match(/\b(\d{1,3})\/(\d{2,3})\b/);
  return m ? parseInt(m[1], 10).toString() : "";
}

function localeToLanguage(locale) {
  if (!locale) return "";
  const l = locale.split("-")[0].toLowerCase();
  const map = { ja:"Japanese", ko:"Korean", zh:"Chinese", de:"German", fr:"French", it:"Italian", es:"Spanish", pt:"Portuguese" };
  return map[l] || "";
}

// ── Claude — primary name/language extraction ─────────────────────────────────
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
- "name": full card name in English, including trainer prefix if present (e.g. "Ethan's Magcargo", "Misty's Psyduck"). Translate from Japanese/Korean if needed.
- "number": digits before the slash in the bottom corner, e.g. "197" from "197/193"
- "set": set name if legible, otherwise omit
- "language": language of the printed text — "English", "Japanese", "Korean", "Chinese", etc.

Japanese trainer card example: {"name": "Ethan's Magcargo", "number": "197", "language": "Japanese"}
English card example: {"name": "Charizard", "number": "4", "set": "Base Set", "language": "English"}

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
  const data  = await res.json();
  const text  = data.content.find(b => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
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

    // ── Run Vision + Claude in parallel ───────────────────────────────────────
    const [visionSettled, claudeSettled] = await Promise.allSettled([
      GOOGLE_VISION_KEY ? visionDetect(imageData) : Promise.resolve(null),
      claudeIdentify(imageData, mediaType),
    ]);

    // ── Extract Vision results ─────────────────────────────────────────────────
    let tcgPlayerUrl = "";
    let visionNumber = "";
    let visionLanguage = "";

    if (visionSettled.status === "fulfilled" && visionSettled.value) {
      const vision = visionSettled.value;
      const web    = vision.webDetection || {};
      const texts  = vision.textAnnotations || [];
      const ocrText   = texts[0]?.description || "";
      const ocrLocale = texts[0]?.locale || "";

      // TCGPlayer URL from matching pages
      const pages = web.pagesWithMatchingImages || [];
      const tcgPage = pages.find(p => /tcgplayer\.com\/product\/\d+\/[^?#\s]+/i.test(p.url));
      if (tcgPage) {
        const m = tcgPage.url.match(/tcgplayer\.com\/product\/(\d+)\/([^?#\s]+)/i);
        if (m) tcgPlayerUrl = `https://www.tcgplayer.com/product/${m[1]}/${m[2]}`;
      }

      // Language + number from OCR (reliable supplement to Claude)
      visionLanguage = localeToLanguage(ocrLocale);
      visionNumber   = extractNumberFromOCR(ocrText);
    } else if (visionSettled.status === "rejected") {
      console.warn("Vision API failed:", visionSettled.reason?.message);
    }

    // ── Extract Claude results — primary source for name ──────────────────────
    let claudeName = "", claudeNumber = "", claudeLanguage = "", claudeSet = "";
    if (claudeSettled.status === "fulfilled" && !claudeSettled.value?.error) {
      const c = claudeSettled.value;
      claudeName     = c.name || "";
      claudeNumber   = (c.number || "").split("/")[0].trim();
      claudeLanguage = c.language || "";
      claudeSet      = c.set || "";
    } else if (claudeSettled.status === "rejected") {
      console.error("Claude failed:", claudeSettled.reason?.message);
    }

    // ── Merge: Claude for name, best available for everything else ────────────
    const name     = claudeName; // Claude is most accurate for trainer card names
    const number   = claudeNumber || visionNumber;
    const language = claudeLanguage || visionLanguage || "English";
    const set      = claudeSet;

    if (!name) return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: [] }) };

    const numClean  = number.replace(/^0+/, "") || number;
    const isEnglish = language.toLowerCase() === "english";

    // ── Non-English → TCGdex ──────────────────────────────────────────────────
    if (!isEnglish) {
      const tcgCards = await tcgdexSearch(name, number, language).catch(() => []);
      if (tcgCards.length) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ cards: formatTcgdex(tcgCards, tcgPlayerUrl) }) };
      }
      // TCGdex miss (card too new or not indexed) — return useful fallback entry
      const query = `${name}${number ? ` ${number}` : ""} (${language})`;
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        cards: [{ cardId: "", query, setName: language, marketPrice: null, tcgUrl: tcgPlayerUrl, imageUrl: "" }],
      }) };
    }

    // ── English → pokemontcg.io ───────────────────────────────────────────────
    let cards = [];

    if (number) {
      for (const num of [...new Set([number, numClean])]) {
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
