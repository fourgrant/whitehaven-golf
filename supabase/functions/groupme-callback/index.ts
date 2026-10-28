// Sheila — groupme-callback Edge Function
//
// GroupMe POSTs every message in the league chat here (the bot's Callback
// URL). Sheila acts on RSVP replies and ignores all other chatter. The reading
// rules live in _shared/rsvp-parse.ts (tested against real weeks of the chat):
//
//   in / I'm in / In + MM / In for Sunday     → RSVP for the next round (MM = Madman, ignored)
//   in + Jeremy / "+ Jeremy" on its own        → also RSVP a guest (or a roster player, if the name matches)
//   Dave and Spencer in                        → RSVP yourself and a buddy
//   Harry is in too / Ben H. now out           → RSVP (or drop) someone else
//   in as <roster name>                        → RSVP, and remember which player you are
//   in as new                                  → first-timer: add to the roster under their GroupMe name, then RSVP
//   out / I'm out. Working                     → drop your RSVP
//   who's in                                   → post the current list
//
// Sheila keeps quiet when things go right: no reply to a plain "in" or "out".
// She speaks up only when someone needs to act — an unknown name, RSVPs
// closed, the game filling up, the waitlist, or a spot opening — and the
// nightly evening_list post (groupme-post) shows everyone the running list.
// From 11 PM to 6 AM Central she only replies to the person who wrote; the
// waitlist "spot opened" tag is skipped (the next evening list shows them in).
//
// A GroupMe sender is matched to a player once (by name, or "in as ...") and
// the GroupMe user id is saved to players.groupme_user_id for next time.
//
// GroupMe sends no auth header, so this function is deployed without JWT
// verification and checks a shared secret in the URL instead:
//   supabase secrets set GROUPME_CALLBACK_SECRET=...
//   supabase functions deploy groupme-callback --no-verify-jwt
//   Callback URL: https://<ref>.supabase.co/functions/v1/groupme-callback?secret=...

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  adminClient, getOpenRound, getRsvps, postToGroup, rsvpsClosed, quietHours, fmtDate, msgRsvpList, Round,
  inList, waitList, promoteFromWaitlist, postPromoted, tagged,
} from "../_shared/groupme.ts";
import { parseRsvp, findPlayer, isSender, Parsed } from "../_shared/rsvp-parse.ts";

type Player = { id: string; name: string; groupme_user_id: string | null; active: boolean };

async function linkPlayer(db: SupabaseClient, player: Player, userId: string) {
  if (player.groupme_user_id === userId) return;
  // A GroupMe user maps to one player; "in as" can move the link.
  await db.from("players").update({ groupme_user_id: null }).eq("groupme_user_id", userId);
  await db.from("players").update({ groupme_user_id: userId }).eq("id", player.id);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = Deno.env.get("GROUPME_CALLBACK_SECRET");
  if (!secret || url.searchParams.get("secret") !== secret) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("ok");

  let msg: { text?: string; name?: string; user_id?: string; sender_type?: string; system?: boolean };
  try { msg = await req.json(); } catch { return new Response("ok"); }

  // Never react to Sheila herself, other bots, or system notices.
  if (msg.sender_type !== "user" || msg.system || !msg.text || !msg.user_id) return new Response("ok");

  const cmd = parseRsvp(msg.text);
  if (!cmd) return new Response("ok");

  const db = adminClient();
  try {
    await handle(db, msg as Required<typeof msg>, cmd);
  } catch (e) {
    console.error(e);
  }
  // Always 200 so GroupMe doesn't retry.
  return new Response("ok");
});

async function handle(db: SupabaseClient, msg: { name: string; user_id: string }, cmd: Parsed) {
  const round = await getOpenRound(db);
  if (!round) {
    await postToGroup(`No round is open for RSVPs yet — I'll post here when there is.`);
    return;
  }

  if (cmd.kind === "who") {
    await postToGroup(msgRsvpList(round, await getRsvps(db, round.id)));
    return;
  }

  if (rsvpsClosed(round)) {
    await postToGroup(`RSVPs for ${fmtDate(round.date)} closed at 9 AM — check with the commish.`);
    return;
  }

  const { data: players } = await db.from("players").select("id, name, groupme_user_id, active");
  const all = (players ?? []) as Player[];
  const active = all.filter(p => p.active);
  const linked = all.find(p => p.groupme_user_id === msg.user_id) ?? null;
  const unlinked = (list: Player[]) => list.filter(p => !p.groupme_user_id);
  const byName = linked ?? findPlayer(unlinked(active), msg.name) ?? findPlayer(unlinked(all), msg.name);

  // "Dave and Spencer in" names the sender; "Harry is in too" doesn't.
  const party = cmd.kind === "in" || cmd.kind === "out" ? cmd.party : [];
  const isSelf = (p: string) => isSender(p, msg.name) || (!!byName && isSender(p, byName.name));
  const others = party.filter(p => !isSelf(p));
  const includesSender = cmd.kind === "in_as" || ((cmd.kind === "in" || cmd.kind === "out") && others.length < party.length) ||
    ((cmd.kind === "in" || cmd.kind === "out") && !party.length);

  // Who is this?
  let player: Player | null = byName;
  let reply = "";
  if (cmd.kind === "in_as" && cmd.name === "new") {
    player = linked;
    if (!player) {
      player = await addPlayer(db, msg.name.trim());
      reply = `👋 Welcome, ${player.name}! You're on the roster and in for ${fmtDate(round.date)}.`;
    } else {
      reply = `✅ ${player.name}, you're in for ${fmtDate(round.date)}.`;
    }
  } else if (cmd.kind === "in_as") {
    player = findPlayer(active, cmd.name) ?? findPlayer(all, cmd.name);
    if (!player) {
      await postToGroup(`I couldn't find "${cmd.name}" on the roster. First time playing? Reply "in as new" and I'll add you as ${msg.name}.`);
      return;
    }
    reply = `✅ Got it — you're ${player.name}, and you're in for ${fmtDate(round.date)}.`;
  } else if (includesSender && !player) {
    // Saying "out" when we don't know you yet changes nothing — stay quiet.
    if (cmd.kind === "out") return;
    await postToGroup(
      `${msg.name}, I don't see you on the roster.\n` +
      `• Played with us before? Reply "in as <your roster name>", e.g. "in as Randy K."\n` +
      `• First time? Reply "in as new" and I'll add you as ${msg.name}.`);
    return;
  }
  if (player && includesSender) await linkPlayer(db, player, msg.user_id);
  const host = player?.name ?? msg.name;
  const roster = all.filter(p => p.id !== player?.id);

  // ----- OUT -----
  if (cmd.kind === "out") {
    const ids: string[] = [];
    if (includesSender && player) ids.push(player.id);
    for (const name of others) {
      const p = findPlayer(roster.filter(r => r.active), name) ?? findPlayer(roster, name);
      if (p) ids.push(p.id);
    }
    if (!ids.length) return;
    const { data: removed } = await db.from("rsvps").delete()
      .eq("round_id", round.id).in("player_id", ids).select("waitlisted");
    // A spot opened: move the next person up and tag them. Otherwise, quiet.
    // Overnight they're still moved up, just not tagged; the next evening list shows them in.
    if (removed?.some(r => !r.waitlisted)) {
      const promoted = await promoteFromWaitlist(db, round);
      if (!quietHours()) await postPromoted(round, promoted);
    }
    return;
  }

  // ----- IN -----
  const before = inList(await getRsvps(db, round.id)).length;
  const added: string[] = []; // rsvp ids that are new this message
  if (includesSender && player) {
    const id = await rsvp(db, round, player.id, player.name);
    if (id) added.push(id);
  }
  const extras = [...others, ...(cmd.kind === "in" || cmd.kind === "guest" ? cmd.guests : [])];
  for (const name of extras) {
    const id = await rsvpExtra(db, round, roster, name, host);
    if (id) added.push(id);
  }

  const rsvps = await getRsvps(db, round.id);
  const lines = reply ? [reply] : [];
  const waiting = waitList(rsvps);
  const newlyWaiting = waiting.filter(r => added.includes(r.id));
  if (newlyWaiting.length) {
    const { names, mentions } = tagged(newlyWaiting);
    const spots = newlyWaiting.map(r => `#${waiting.indexOf(r) + 1}`).join(", ");
    lines.push(`⏳ We're full at ${round.max_players} — ${names.join(", ")} on the waitlist (${spots}). I'll tag you if a spot opens.`);
    await postToGroup(lines.join("\n"), mentions);
    return;
  }
  const after = inList(rsvps).length;
  if (round.max_players != null && before < round.max_players && after >= round.max_players) {
    lines.push(`🔒 That's ${round.max_players} — we're full for ${fmtDate(round.date)}. Reply "in" to join the waitlist.`);
  }
  if (lines.length) await postToGroup(lines.join("\n"));
}

// Inserts an RSVP (the rsvps_waitlist trigger decides in vs. waitlist).
// Returns the new rsvp id, or null if they were already on the list.
async function rsvp(db: SupabaseClient, round: Round, playerId: string | null, name: string): Promise<string | null> {
  const { data, error } = await db.from("rsvps").insert({ round_id: round.id, player_id: playerId, name }).select("id").single();
  if (error?.code === "23505") return null;
  if (error) throw error;
  return data.id;
}

// A buddy or guest someone else RSVP'd. A roster name gets a normal RSVP;
// anyone else is saved with no player — "Jeremy Wickham (Will Goodwin's guest)"
// or "Colin B.'s dad" — and the commish adds them with + Add Guest.
async function rsvpExtra(db: SupabaseClient, round: Round, roster: Player[], raw: string, host: string): Promise<string | null> {
  if (!raw.startsWith("my ")) {
    const match = findPlayer(roster.filter(p => p.active), raw) ?? findPlayer(roster, raw);
    if (match) return rsvp(db, round, match.id, match.name);
  }
  const name = raw.startsWith("my ")
    ? `${host}'s ${raw.slice(3).replace(/inlaw$/, "-in-law")}`
    : `${raw.replace(/\b\p{L}/gu, c => c.toUpperCase())} (${host}'s guest)`;
  const { data: dupe } = await db.from("rsvps").select("id").eq("round_id", round.id).eq("name", name).maybeSingle();
  if (dupe) return null;
  return rsvp(db, round, null, name);
}

// Adds a first-timer the same way the RSVP page's "Not listed — add me" does.
// If the name is already taken (e.g. an inactive player), use that player.
async function addPlayer(db: SupabaseClient, name: string): Promise<Player> {
  const { data, error } = await db.from("players")
    .insert({ name, avg_score: 40, rounds_played: 0 })
    .select("id, name, groupme_user_id, active").single();
  if (!error) return data as Player;
  if (error.code !== "23505") throw error;
  const { data: existing, error: e2 } = await db.from("players")
    .select("id, name, groupme_user_id, active").eq("name", name).single();
  if (e2) throw e2;
  return existing as Player;
}
