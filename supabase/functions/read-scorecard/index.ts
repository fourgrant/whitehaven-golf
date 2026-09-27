// Sheila — read-scorecard Edge Function
//
// Takes a photo of one Whitehaven scorecard and returns what is written on it
// as structured JSON: each player's name, their nine hole scores, the total in
// the "Out" column, and the handwritten team running row at the bottom.
//
// The browser never sees the Anthropic key. Deploy with:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy read-scorecard
//
// Request  (POST, JSON): { image: { media_type: "image/jpeg", data: "<base64>" }, roster: ["Randy K.", ...] }
// Response (200,  JSON): { card: ScorecardRead, model: string }
//   ScorecardRead = {
//     players: [{ name_as_written, holes: [9 × int|null], total_written: int|null, confidence: "high"|"medium"|"low" }],
//     team_row:  { values: [9 × int|null], final_written: int|null } | null,
//     legibility: "good"|"fair"|"poor",
//     notes: string
//   }

import Anthropic from "npm:@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Structured-output schema: the API guarantees the reply validates against it.
const SCORECARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["players", "team_row", "legibility", "notes"],
  properties: {
    players: {
      type: "array",
      description: "One entry per handwritten player row, top to bottom. Skip PAR and the team running row.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name_as_written", "holes", "total_written", "confidence"],
        properties: {
          name_as_written: { type: "string", description: "The name exactly as handwritten, e.g. 'T$', 'Stu', 'Bent'." },
          holes: {
            type: "array",
            description: "Exactly 9 entries for holes 1-9 in order. null when the cell is blank or unreadable.",
            items: { type: ["integer", "null"] },
          },
          total_written: { type: ["integer", "null"], description: "The number handwritten in the Out column, or null if blank." },
          confidence: { type: "string", enum: ["high", "medium", "low"], description: "low when any digit was a guess (overwrites, smudges, cut off)." },
        },
      },
    },
    team_row: {
      type: ["object", "null"],
      description: "The handwritten row of +/- values below the players (often labelled Team, TOT, or unlabelled). null if the card has none.",
      additionalProperties: false,
      required: ["values", "final_written"],
      properties: {
        values: {
          type: "array",
          description: "Exactly 9 entries aligned to holes 1-9 as written (a running total relative to par). null for blank cells.",
          items: { type: ["integer", "null"] },
        },
        final_written: { type: ["integer", "null"], description: "The last value written in the row, i.e. the team's final score relative to par." },
      },
    },
    legibility: { type: "string", enum: ["good", "fair", "poor"] },
    notes: { type: "string", description: "One or two short sentences about anything ambiguous: overwritten digits, cut-off columns, names you were unsure of. Empty string if nothing." },
  },
};

function systemPrompt(roster: string[]): string {
  return `You read handwritten golf scorecards from The Links at Whitehaven for a Sunday league app.

The card layout, top to bottom:
- Printed header rows: HOLE (1-9, Out), BLACK, GOLD, BLUE, WHITE yardages, HANDICAP. Ignore these.
- Handwritten player rows. Each has a name on the left, one score per hole in the nine columns, and the 9-hole total in the Out column. There are usually three player rows above the printed PAR row and one or two below it.
- The printed PAR row: 5 3 4 5 3 4 4 4 4 = 36. Do not report it as a player.
- Usually one handwritten row of +/- numbers at the very bottom (sometimes labelled Team, TOT, or nothing). That is the team's running score relative to par. Report it as team_row, aligned to the hole columns as written. Cells are often skipped when the running total did not change, so leave those null. Some cards also have a per-hole +/- row (labelled HOLE); ignore that one and report only the cumulative row.

Rules:
- Report exactly what is written. Do not correct arithmetic, and do not fill blank cells from the total. The app cross-checks the math itself.
- Circles and boxes around a number are birdie/bogey marks. Ignore them and read the digit inside.
- When a digit was written over another, report the final (darker, on-top) digit and lower your confidence.
- A checkmark or dash next to a name is not part of the name.
- Names are first names or nicknames. Copy them as written; the app does the matching. For reference, the league roster is: ${roster.join(", ")}.
- Reading a scorecard should not take long. Look once, carefully, and answer.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on this function" }, 500);

  let body: { image?: { media_type?: string; data?: string }; roster?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const image = body.image;
  if (!image?.data || !image.media_type || !ALLOWED_TYPES.has(image.media_type)) {
    return json({ error: "image must be { media_type: image/jpeg|png|webp|gif, data: base64 }" }, 400);
  }
  if (image.data.length > 6_000_000) return json({ error: "Image too large; resize before uploading" }, 413);
  const roster = Array.isArray(body.roster) ? body.roster.filter((n) => typeof n === "string").slice(0, 200) : [];

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // A refused request is re-run server-side on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: SCORECARD_SCHEMA },
      },
      system: systemPrompt(roster),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.media_type as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: image.data,
              },
            },
            { type: "text", text: "Read this scorecard." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return json({ error: "The model declined to read this image", stop_details: response.stop_details ?? null }, 422);
    }
    if (response.stop_reason === "max_tokens") {
      return json({ error: "Response was cut off; try a clearer photo" }, 502);
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    let card;
    try {
      card = JSON.parse(text);
    } catch {
      return json({ error: "Model returned non-JSON output", raw: text.slice(0, 2000) }, 502);
    }

    return json({ card, model: response.model, usage: response.usage });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "Rate limited by the Claude API; try again in a moment" }, 429);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY was rejected" }, 500);
    if (err instanceof Anthropic.APIConnectionError) return json({ error: "Could not reach the Claude API" }, 502);
    if (err instanceof Anthropic.APIError) return json({ error: `Claude API error ${err.status}: ${err.message}` }, 502);
    return json({ error: (err as Error)?.message ?? "Unknown error" }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
