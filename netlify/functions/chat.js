// Pokemon card portfolio admin agent
// Runs server-side: verifies Netlify Identity auth, calls Claude API,
// executes card management tools against GitHub API.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
// Hardcoded to avoid env var misconfiguration
const GITHUB_REPO   = "joshuaefron5890-sys/Pokemon-Aidan";
const TCG_API       = "https://api.pokemontcg.io/v2";
const GH_FILE_URL   = `https://api.github.com/repos/${GITHUB_REPO}/contents/cards.js?ref=main`;

// ── cards.js file helpers ──────────────────────────────────

async function getCardsFile() {
  const headers = { Accept: "application/vnd.github.v3+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const res = await fetch(GH_FILE_URL, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub read failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.content) throw new Error(`GitHub response missing content field. Keys: ${Object.keys(data).join(", ")}`);

  const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  return { content, sha: data.sha };
}

async function putCardsFile(content, sha, message) {
  const res = await fetch(GH_FILE_URL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub write error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

function formatCard(card) {
  const lines = ["  {"];
  lines.push(`    query: "${card.query}",`);
  lines.push(`    cardId: "${card.cardId}",`);
  lines.push(`    setName: "${card.setName}",`);
  if (card.tcgUrl)         lines.push(`    tcgUrl: "${card.tcgUrl}",`);
  if (card.imageUrl)       lines.push(`    imageUrl: "${card.imageUrl}",`);
  if (card.fallbackPrice != null) lines.push(`    fallbackPrice: ${card.fallbackPrice},`);
  if (card.grade != null)  lines.push(`    grade: ${card.grade},`);
  lines.push("  },");
  return lines.join("\n");
}

// ── Tool implementations ───────────────────────────────────

async function tool_lookup_card({ query, cardId }) {
  if (cardId) {
    const res = await fetch(`${TCG_API}/cards/${encodeURIComponent(cardId)}`);
    if (!res.ok) return { error: `No card found with ID "${cardId}"` };
    const { data: c } = await res.json();
    return {
      id: c.id, name: c.name, number: c.number,
      set: { id: c.set?.id, name: c.set?.name, series: c.set?.series },
      rarity: c.rarity,
      hasImage: !!c.images?.large,
      tcgUrl: c.tcgplayer?.url,
      marketPrice:
        c.tcgplayer?.prices?.holofoil?.market ??
        c.tcgplayer?.prices?.normal?.market ??
        c.tcgplayer?.prices?.["1stEditionHolofoil"]?.market ??
        null,
    };
  }
  const q = encodeURIComponent(`name:"${query}"`);
  const res = await fetch(`${TCG_API}/cards?q=${q}&pageSize=6&orderBy=-set.releaseDate`);
  const { data } = await res.json();
  if (!data?.length) return { error: `No cards found for "${query}"` };
  return data.map(c => ({
    id: c.id, name: c.name, number: c.number,
    set: { name: c.set?.name, series: c.set?.series },
    rarity: c.rarity,
    tcgUrl: c.tcgplayer?.url,
    marketPrice:
      c.tcgplayer?.prices?.holofoil?.market ??
      c.tcgplayer?.prices?.normal?.market ?? null,
  }));
}

async function tool_get_collection() {
  const diagnostics = {
    githubTokenSet: !!GITHUB_TOKEN,
    githubRepo: GITHUB_REPO,
    url: GH_FILE_URL,
  };

  const { content } = await getCardsFile();
  const queries = [...content.matchAll(/query:\s*"([^"]+)"/g)].map(m => m[1]);
  const cardIds = [...content.matchAll(/cardId:\s*"([^"]+)"/g)].map(m => m[1]);

  if (queries.length === 0) {
    return {
      count: 0,
      cards: [],
      diagnostics,
      contentLength: content.length,
      hasWordQuery: content.includes("query"),
      hasWordCardId: content.includes("cardId"),
      first500: content.slice(0, 500),
    };
  }

  return {
    count: queries.length,
    cards: queries.map((q, i) => ({ query: q, cardId: cardIds[i] })),
  };
}

async function tool_add_card(card) {
  const { content, sha } = await getCardsFile();
  if (content.includes(`cardId: "${card.cardId}"`)) {
    return { error: `"${card.cardId}" is already in the collection.` };
  }
  const entry = formatCard(card);
  const newContent = content.replace(/(\n\];\s*)$/, `\n${entry}\n];`);
  await putCardsFile(newContent, sha, `Add ${card.query} via admin agent`);
  return { success: true, message: `Added "${card.query}" — the site will redeploy in about a minute.` };
}

async function tool_update_card({ cardId, updates }) {
  const { content, sha } = await getCardsFile();
  const lines = content.split("\n");

  // Find the line containing this cardId
  let pivot = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`cardId:`) && lines[i].includes(`"${cardId}"`)) {
      pivot = i; break;
    }
  }
  if (pivot === -1) return { error: `Card "${cardId}" not found.` };

  // Walk back/forward to find block boundaries
  let start = pivot;
  while (start > 0 && !lines[start].trim().startsWith("{")) start--;
  let end = pivot;
  while (end < lines.length - 1 && !lines[end].trim().match(/^\},?$/)) end++;

  let block = lines.slice(start, end + 1).join("\n");

  for (const [key, value] of Object.entries(updates)) {
    const valueStr = typeof value === "string" ? `"${value}"` : String(value);
    const existing = new RegExp(`(    ${key}:\\s*)([^,\\n]+)(,)`);
    if (existing.test(block)) {
      block = block.replace(existing, `$1${valueStr}$3`);
    } else {
      block = block.replace(/(  },?)$/, `    ${key}: ${valueStr},\n  },`);
    }
  }

  const newLines = [...lines.slice(0, start), block, ...lines.slice(end + 1)];
  await putCardsFile(newLines.join("\n"), sha, `Update ${cardId} via admin agent`);
  return { success: true, message: `Updated "${cardId}" (${Object.keys(updates).join(", ")}).` };
}

async function tool_remove_card({ cardId }) {
  const { content, sha } = await getCardsFile();
  const lines = content.split("\n");

  let pivot = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`cardId:`) && lines[i].includes(`"${cardId}"`)) {
      pivot = i; break;
    }
  }
  if (pivot === -1) return { error: `Card "${cardId}" not found.` };

  let start = pivot;
  while (start > 0 && !lines[start].trim().startsWith("{")) start--;
  let end = pivot;
  while (end < lines.length - 1 && !lines[end].trim().match(/^\},?$/)) end++;

  const newLines = [...lines.slice(0, start), ...lines.slice(end + 1)];
  await putCardsFile(newLines.join("\n"), sha, `Remove ${cardId} via admin agent`);
  return { success: true, message: `Removed "${cardId}" from the collection.` };
}

async function executeTool(name, input) {
  try {
    switch (name) {
      case "lookup_card":    return await tool_lookup_card(input);
      case "get_collection": return await tool_get_collection();
      case "add_card":       return await tool_add_card(input);
      case "update_card":    return await tool_update_card(input);
      case "remove_card":    return await tool_remove_card(input);
      default:               return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ── Tool definitions for Claude ────────────────────────────

const TOOLS = [
  {
    name: "lookup_card",
    description: "Search the Pokemon TCG API for a card by name or direct ID. Use this to verify card details and get pricing before adding.",
    input_schema: {
      type: "object",
      properties: {
        query:  { type: "string", description: 'Card name, e.g. "Charizard ex" or "Pikachu 025/102"' },
        cardId: { type: "string", description: 'Direct API card ID if known, e.g. "sv3pt5-6", "base1-4", "xyp-XY30"' },
      },
    },
  },
  {
    name: "get_collection",
    description: "Get the full list of cards currently in the collection.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_card",
    description: "Add a new card to the collection. Always look it up first to confirm the card ID and set name.",
    input_schema: {
      type: "object",
      properties: {
        query:         { type: "string",  description: 'Display name with number, e.g. "Charizard ex 006/165"' },
        cardId:        { type: "string",  description: 'Pokemon TCG API card ID, e.g. "sv3pt5-6"' },
        setName:       { type: "string",  description: 'Set/expansion name, e.g. "151"' },
        tcgUrl:        { type: "string",  description: "Full TCGPlayer product URL" },
        fallbackPrice: { type: "number",  description: "Manual price when the API has no pricing data" },
        imageUrl:      { type: "string",  description: "Local image filename when the API has no image, e.g. \"Charizard.jpg\"" },
        grade:         { type: "number",  description: "Numeric PSA/BGS grade for graded cards, e.g. 9" },
      },
      required: ["query", "cardId", "setName"],
    },
  },
  {
    name: "update_card",
    description: "Update one or more fields on an existing card.",
    input_schema: {
      type: "object",
      properties: {
        cardId:  { type: "string", description: "The card ID to update" },
        updates: {
          type: "object",
          description: "Fields to update",
          properties: {
            fallbackPrice: { type: "number" },
            imageUrl:      { type: "string" },
            grade:         { type: "number" },
            tcgUrl:        { type: "string" },
            setName:       { type: "string" },
            query:         { type: "string" },
          },
        },
      },
      required: ["cardId", "updates"],
    },
  },
  {
    name: "remove_card",
    description: "Remove a card from the collection by its card ID.",
    input_schema: {
      type: "object",
      properties: {
        cardId: { type: "string", description: "The card ID to remove, e.g. \"base1-4\"" },
      },
      required: ["cardId"],
    },
  },
];

const SYSTEM = `You are a friendly Pokemon card portfolio assistant for Aidan's Pokemon Binder (aidanpokemonbinder.netlify.app).

You help admins manage the card collection conversationally. The collection is stored in cards.js in GitHub and the site auto-deploys on every change.

Each card entry has:
- query: display name + set number, e.g. "Charizard ex 006/165"
- cardId: Pokemon TCG API ID, e.g. "sv3pt5-6"
- setName: expansion name, e.g. "151"
- tcgUrl: TCGPlayer URL (optional)
- fallbackPrice: manual price shown with ~ prefix when API has no data (optional)
- imageUrl: local filename for cards the API has no image for (optional)
- grade: numeric PSA/BGS grade shown as a gold badge (optional)

When adding a card:
1. Use lookup_card to confirm the ID, set name, pricing, and TCGPlayer URL
2. Tell the user what you found before committing
3. Use add_card — changes deploy automatically in ~1 minute

When a user uploads a card image, identify it from the image and look it up automatically.

Card ID patterns: sv1-1 (SV base), sv3pt5-1 (151), swsh1-1 (SWSH base), base1-1 (Base Set), xyp-XY30 (XY promo). Promo cards often need fallbackPrice and imageUrl.

Whenever you list cards from the collection (e.g. showing search results or the full collection), append a machine-readable block at the very end of your response in this exact format — the UI will render it as thumbnails:
<cards>[{"query":"Card Name 001/102","cardId":"base1-1"},{"query":"Other Card","cardId":"sv1-2"}]</cards>
Include up to 30 cards in the block. Do not explain the block to the user.

Be concise and confirm before making changes.`;

// ── Agentic loop ───────────────────────────────────────────

async function runAgent(messages) {
  let msgs = [...messages];

  for (let i = 0; i < 12; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM,
        tools: TOOLS,
        messages: msgs,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }

    const response = await res.json();

    if (response.stop_reason === "end_turn") {
      return response.content.find(b => b.type === "text")?.text ?? "";
    }

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter(b => b.type === "tool_use");
      msgs.push({ role: "assistant", content: response.content });

      const results = await Promise.all(
        toolUses.map(async tu => ({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(await executeTool(tu.name, tu.input)),
        }))
      );
      msgs.push({ role: "user", content: results });
      continue;
    }

    break;
  }

  return "Sorry, something went wrong. Please try again.";
}

// ── Handler ────────────────────────────────────────────────

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Netlify Identity auth check
  const user = context.clientContext?.user;
  if (!user) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized — please log in." }),
    };
  }

  try {
    const { messages } = JSON.parse(event.body);
    if (!Array.isArray(messages) || !messages.length) {
      return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "No messages provided." }) };
    }

    const reply = await runAgent(messages);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("Agent error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
