// Pre-auth AI card-identification wizard for binder creation
// No authentication required — read-only, calls Pokemon TCG API only

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const TCG_API       = "https://api.pokemontcg.io/v2";

async function lookupCard({ query, cardId }) {
  try {
    if (cardId) {
      const res = await fetch(`${TCG_API}/cards/${encodeURIComponent(cardId)}`);
      if (!res.ok) return { error: `No card found with ID "${cardId}"` };
      const { data: c } = await res.json();
      return {
        id: c.id, name: c.name, number: c.number,
        set: { name: c.set?.name, series: c.set?.series },
        rarity: c.rarity,
        tcgUrl: c.tcgplayer?.url,
        marketPrice:
          c.tcgplayer?.prices?.holofoil?.market ??
          c.tcgplayer?.prices?.normal?.market ??
          c.tcgplayer?.prices?.reverseHolofoil?.market ??
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
        c.tcgplayer?.prices?.normal?.market ??
        null,
    }));
  } catch (e) {
    return { error: e.message };
  }
}

const TOOLS = [
  {
    name: "lookup_card",
    description: "Search the Pokemon TCG API for a card by name or ID to confirm it exists and get pricing.",
    input_schema: {
      type: "object",
      properties: {
        query:  { type: "string", description: "Card name, e.g. \"Charizard ex\" or \"Pikachu 025/102\"" },
        cardId: { type: "string", description: "Direct API card ID if known, e.g. \"sv3pt5-6\"" },
      },
    },
  },
];

const SYSTEM = `You are helping someone add cards to their new Pokémon binder. Your only job is to identify and confirm cards they describe.

When the user mentions a card:
1. Use lookup_card to find it
2. Confirm: name, set, card number, and market price
3. Once confirmed, include this tag at the end of your message:
   <card-confirmed>{"query":"Charizard ex 006/165","cardId":"sv3pt5-6","setName":"151","fallbackPrice":25.99}</card-confirmed>
   (use null for fallbackPrice if market price is available from the API)

If multiple matches exist, ask which one they mean.

After confirming a card, ask if they have more to add or if they're ready to create their binder.
Keep responses short and friendly. Never explain the <card-confirmed> tag to the user.`;

async function runAgent(messages) {
  let msgs = [...messages];

  for (let i = 0; i < 8; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-6",
        max_tokens: 512,
        system:     SYSTEM,
        tools:      TOOLS,
        messages:   msgs,
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
        toolUses.map(async tu => {
          const result = tu.name === "lookup_card"
            ? await lookupCard(tu.input)
            : { error: `Unknown tool: ${tu.name}` };
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
        })
      );
      msgs.push({ role: "user", content: results });
      continue;
    }
    break;
  }
  return "Sorry, something went wrong. Please try again.";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };

  try {
    const { messages } = JSON.parse(event.body);
    if (!Array.isArray(messages) || !messages.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "No messages" }) };
    }

    const reply = await runAgent(messages);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("create-wizard error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
