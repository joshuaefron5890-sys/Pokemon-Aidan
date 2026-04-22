// Per-binder AI card management chat
// Auth required — user must own the binder
// POST { slug, messages }

const { getBinder, putBinder, getManifest, putManifest } = require("./_blobs");
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TCG_API       = "https://api.pokemontcg.io/v2";

// ── Binder helpers ─────────────────────────────────────────

async function readBinder(slug) {
  const binder = await getBinder(slug);
  if (!binder) throw new Error(`Binder "${slug}" not found.`);
  return binder;
}

async function writeBinder(slug, binder) {
  await putBinder(slug, binder);
  // Non-fatal: update card count in manifest
  try {
    const manifest = await getManifest();
    const entry = manifest.find(b => b.slug === slug);
    if (entry) {
      entry.cardCount = binder.cards.length;
      await putManifest(manifest);
    }
  } catch { /* ignore */ }
}

// ── Tool implementations ───────────────────────────────────

function cardSummary(c) {
  return {
    id: c.id, name: c.name, number: c.number,
    set: { name: c.set?.name, series: c.set?.series },
    rarity: c.rarity, tcgUrl: c.tcgplayer?.url,
    marketPrice: c.tcgplayer?.prices?.holofoil?.market ?? c.tcgplayer?.prices?.normal?.market ?? null,
  };
}

async function tool_lookup_card({ query, number, cardId }) {
  try {
    if (cardId) {
      const res = await fetch(`${TCG_API}/cards/${encodeURIComponent(cardId)}`);
      if (!res.ok) return { error: `No card found with ID "${cardId}"` };
      const { data: c } = await res.json();
      return cardSummary(c);
    }

    // Parse trailing number out of query if not passed separately — e.g. "Mesprit 204" → name="Mesprit", num="204"
    let name = query;
    let numPart = number ? number.split("/")[0].trim() : null;
    if (!numPart) {
      const m = query.match(/^(.+?)\s+(\d+(?:\/\d+)?)$/);
      if (m) { name = m[1].trim(); numPart = m[2].split("/")[0]; }
    }

    // Try name + number first for an exact match
    if (numPart) {
      const q1 = encodeURIComponent(`name:"${name}" number:"${numPart}"`);
      const res1 = await fetch(`${TCG_API}/cards?q=${q1}&pageSize=6&orderBy=-set.releaseDate`);
      const { data: d1 } = await res1.json();
      if (d1?.length) return d1.map(cardSummary);
    }

    // Fall back to name-only
    const q = encodeURIComponent(`name:"${name}"`);
    const res = await fetch(`${TCG_API}/cards?q=${q}&pageSize=6&orderBy=-set.releaseDate`);
    const { data } = await res.json();
    if (!data?.length) return { error: `No cards found for "${query}"` };
    return data.map(cardSummary);
  } catch (e) { return { error: e.message }; }
}

async function tool_get_collection(slug) {
  const binder = await readBinder(slug);
  if (!binder.cards.length) return { count: 0, cards: [] };
  return {
    count: binder.cards.length,
    cards: binder.cards.map(c => ({ query: c.query, cardId: c.cardId })),
  };
}

async function tool_add_card(slug, card) {
  const binder = await readBinder(slug);
  if (binder.cards.some(c => c.cardId === card.cardId)) {
    return { error: `"${card.cardId}" is already in the binder.` };
  }
  binder.cards.push(card);
  await writeBinder(slug, binder);
  return { success: true, message: `Added "${card.query}". The binder will update in ~1 minute.` };
}

async function tool_update_card(slug, { cardId, updates }) {
  const binder = await readBinder(slug);
  const card = binder.cards.find(c => c.cardId === cardId);
  if (!card) return { error: `Card "${cardId}" not found.` };
  Object.assign(card, updates);
  await writeBinder(slug, binder);
  return { success: true, message: `Updated "${cardId}" (${Object.keys(updates).join(", ")}).` };
}

async function tool_remove_card(slug, { cardId }) {
  const binder = await readBinder(slug);
  const before = binder.cards.length;
  binder.cards = binder.cards.filter(c => c.cardId !== cardId);
  if (binder.cards.length === before) return { error: `Card "${cardId}" not found.` };
  await writeBinder(slug, binder);
  return { success: true, message: `Removed "${cardId}".` };
}

async function executeTool(name, input, slug) {
  try {
    switch (name) {
      case "lookup_card":    return await tool_lookup_card(input);
      case "get_collection": return await tool_get_collection(slug);
      case "add_card":       return await tool_add_card(slug, input);
      case "update_card":    return await tool_update_card(slug, input);
      case "remove_card":    return await tool_remove_card(slug, input);
      default:               return { error: `Unknown tool: ${name}` };
    }
  } catch (e) { return { error: e.message }; }
}

// ── Tool schemas ───────────────────────────────────────────

const TOOLS = [
  {
    name: "lookup_card",
    description: "Search the Pokemon TCG API for a card by name or ID.",
    input_schema: {
      type: "object",
      properties: {
        query:  { type: "string", description: "Card name only, e.g. \"Charizard ex\" or \"Mesprit\". Do not include the card number here." },
        number: { type: "string", description: "Card number within its set, e.g. \"204\" or \"006/165\". Pass separately from the name." },
        cardId: { type: "string", description: "Direct API card ID, e.g. \"sv3pt5-6\"" },
      },
    },
  },
  {
    name: "get_collection",
    description: "Get all cards currently in this binder.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_card",
    description: "Add a card to the binder. Always look it up first to confirm the ID.",
    input_schema: {
      type: "object",
      properties: {
        query:         { type: "string",  description: "Display name with number, e.g. \"Charizard ex 006/165\"" },
        cardId:        { type: "string",  description: "Pokemon TCG API card ID, e.g. \"sv3pt5-6\"" },
        setName:       { type: "string",  description: "Expansion name, e.g. \"151\"" },
        tcgUrl:        { type: "string",  description: "TCGPlayer product URL" },
        fallbackPrice: { type: "number",  description: "Manual price when API has no pricing" },
        imageUrl:      { type: "string",  description: "Local image filename override" },
        grade:         { type: "number",  description: "PSA/BGS numeric grade" },
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
        cardId:  { type: "string" },
        updates: { type: "object", description: "Fields to update" },
      },
      required: ["cardId", "updates"],
    },
  },
  {
    name: "remove_card",
    description: "Remove a card from the binder by its card ID.",
    input_schema: {
      type: "object",
      properties: { cardId: { type: "string" } },
      required: ["cardId"],
    },
  },
];

// ── Agent loop ─────────────────────────────────────────────

async function runAgent(messages, slug, owner) {
  let msgs = [...messages];
  const system = `You are a Pokémon card assistant for ${owner}'s binder.

Help them manage their card collection. When adding a card, look it up first to confirm the ID and pricing, then use add_card.

When listing cards from get_collection, append a machine-readable block at the very end of your response:
<cards>[{"query":"Card Name 001/102","cardId":"base1-1"}]</cards>
Include up to 30 cards. Never explain this block.

Be concise. Changes take effect immediately.`;

  for (let i = 0; i < 12; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024, system, tools: TOOLS, messages: msgs }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Claude error ${res.status}`);
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
          content: JSON.stringify(await executeTool(tu.name, tu.input, slug)),
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
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  const user = context.clientContext?.user;
  if (!user) {
    return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const { slug, messages } = JSON.parse(event.body);
    if (!slug)                                       return { statusCode: 400, body: JSON.stringify({ error: "Missing slug" }) };
    if (!Array.isArray(messages) || !messages.length) return { statusCode: 400, body: JSON.stringify({ error: "No messages" }) };

    const binder = await readBinder(slug);
    if (binder.email?.toLowerCase() !== user.email?.toLowerCase()) {
      return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Forbidden" }) };
    }

    const reply = await runAgent(messages, slug, binder.owner);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("binder-chat error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
