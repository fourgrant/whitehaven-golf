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
//                        { kind: "evening_list" }  — the open round's list, only if it changed since the last list
//                        { kind: "promote", round_id, rsvp_id? } — move people up from the waitlist and tag them
// Response (200,  JSON): { ok: true, text: string } or { ok: true, skipped: reason }
//          (4xx/5xx JSON): { error: string }

import {
  adminClient, getRound, getOpenRound, getRsvps, postToGroup, rsvpsClosed, listSig, saveListSig,
  promoteFromWaitlist, postPromoted, msgRsvpOpen, msgRsvpList, msgReminder, msgTeams, msgResults,
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

  let kind: string, roundId: string, rsvpId: string | undefined;
  try {
    ({ kind, round_id: roundId, rsvp_id: rsvpId } = await req.json());
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const db = adminClient();
  try {
    // Nightly: post the list only when it has changed, so a quiet day stays quiet.
    if (kind === "evening_list") {
      const round = await getOpenRound(db);
      if (!round) return json({ ok: true, skipped: "no open round" });
      if (rsvpsClosed(round)) return json({ ok: true, skipped: "RSVPs closed" });
      const rsvps = await getRsvps(db, round.id);
      if (!rsvps.length) return json({ ok: true, skipped: "no RSVPs" });
      if (listSig(rsvps) === (round.rsvp_list_sig ?? "")) return json({ ok: true, skipped: "unchanged" });
      const text = msgRsvpList(round, rsvps);
      await postToGroup(text);
      await saveListSig(db, round, rsvps);
      return json({ ok: true, text });
    }

    if (!roundId) return json({ error: "round_id is required" }, 400);
    const round = await getRound(db, roundId);
    if (!round) return json({ error: "Round not found" }, 404);

    if (kind === "promote") {
      const promoted = await promoteFromWaitlist(db, round, rsvpId);
      if (!promoted.length) return json({ ok: true, skipped: "nobody to move up" });
      // Before 9 AM on round day the chat hears about it; after that the commish is handling it in person.
      if (!rsvpsClosed(round)) await postPromoted(round, promoted);
      return json({ ok: true, promoted: promoted.map(r => r.name) });
    }

    let text: string | null;
    switch (kind) {
      case "rsvp_open": text = msgRsvpOpen(round); break;
      case "rsvp_list": text = msgRsvpList(round, await getRsvps(db, round.id)); break;
      case "reminder":  text = msgReminder(round, await getRsvps(db, round.id)); break;
      case "teams":     text = await msgTeams(db, round); break;
      case "results":   text = await msgResults(db, round); break;
      default: return json({ error: `Unknown kind: ${kind}` }, 400);
    }
    if (!text) return json({ error: kind === "teams" ? "No teams assigned yet" : "No results saved for this round" }, 409);

    await postToGroup(text);
    if (kind === "rsvp_list" || kind === "reminder") await saveListSig(db, round, await getRsvps(db, round.id));
    return json({ ok: true, text });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 502);
  }
});
