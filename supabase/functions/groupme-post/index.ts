// Sheila — groupme-post Edge Function
//
// Posts a league announcement to the GroupMe chat as Sheila. The caller names
// the kind of message and the round; the text is built server-side from the
// database (see _shared/groupme.ts).
//
// Deploy with:
//   supabase secrets set GROUPME_BOT_ID=...
//   supabase functions deploy groupme-post
//
// Request  (POST, JSON): { kind: "rsvp_open"|"rsvp_list"|"reminder"|"teams"|"results", round_id: uuid }
// Response (200,  JSON): { ok: true, text: string }
//          (4xx/5xx JSON): { error: string }

import {
  adminClient, getRound, getRsvpNames, postToGroup,
  msgRsvpOpen, msgRsvpList, msgReminder, msgTeams, msgResults,
} from "../_shared/groupme.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let kind: string, roundId: string;
  try {
    ({ kind, round_id: roundId } = await req.json());
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!roundId) return json({ error: "round_id is required" }, 400);

  const db = adminClient();
  const round = await getRound(db, roundId);
  if (!round) return json({ error: "Round not found" }, 404);

  let text: string | null;
  switch (kind) {
    case "rsvp_open": text = msgRsvpOpen(round); break;
    case "rsvp_list": text = msgRsvpList(round, await getRsvpNames(db, round.id)); break;
    case "reminder":  text = msgReminder(round, await getRsvpNames(db, round.id)); break;
    case "teams":     text = await msgTeams(db, round); break;
    case "results":   text = await msgResults(db, round); break;
    default: return json({ error: `Unknown kind: ${kind}` }, 400);
  }
  if (!text) return json({ error: kind === "teams" ? "No teams assigned yet" : "No results saved for this round" }, 409);

  try {
    await postToGroup(text);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 502);
  }
  return json({ ok: true, text });
});
