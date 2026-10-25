// Sheila — groupme-callback Edge Function
//
// GroupMe POSTs every message in the league chat here (the bot's Callback
// URL). Sheila acts on RSVP replies and ignores all other chatter. The reading
// rules live in _shared/rsvp-parse.ts (tested against a real week of the chat):
//
//   in / I'm in / In + MM / In for Sunday     → RSVP for the next round (MM = Madman, ignored)
//   in + SM / "+ SM" on its own                → also RSVP a guest (or a roster player, if the name matches)
//   Dave and Spencer in                        → RSVP yourself and a buddy
//   in as <roster name>                        → RSVP, and remember which player you are
//   in as new                                  → first-timer: add to the roster under their GroupMe name, then RSVP
//   out / I'm out. Working                     → drop your RSVP
//   who's in                                   → post the current list
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
  adminClient, getOpenRound, getRsvpNames, postToGroup, rsvpsClosed, fmtDate, msgRsvpList, Round,
} from "../_shared/groupme.ts";
import { parseRsvp, findPlayer, isSender, Parsed } from "../_shared/rsvp-parse.ts";

type Player = { id: string; name: string; groupme_user_id: string | null; active: boolean };

async function linkPlayer(db: SupabaseClient, player: Player, userId: string) {
  if (player.groupme_user_id === userId) return;
  // A GroupMe user maps to one player; "in as" can move the link.
  await db.from("players").update({ groupme_user_id: null }).eq("groupme_user_id", userId);
  await db.from("players").update({ groupme_user_id: userId }).eq("id", player.id);
}

async function countIn(db: SupabaseClient, roundId: string): Promise<number> {
  const { count } = await db.from("rsvps").select("id", { count: "exact", head: true }).eq("round_id", roundId);
  return count ?? 0;
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
    await postToGroup(msgRsvpList(round, await getRsvpNames(db, round.id)));
    return;
  }

  // "Dave and Spencer in" from someone who isn't Dave: not ours to guess.
  let buddies: string[] = [];
  if (cmd.kind === "in" && cmd.party.length) {
    const self = cmd.party.filter(p => isSender(p, msg.name));
    if (self.length !== 1) return;
    buddies = cmd.party.filter(p => p !== self[0]);
  }

  if (rsvpsClosed(round)) {
    await postToGroup(`RSVPs for ${fmtDate(round.date)} closed at 9 AM — check with the commish.`);
    return;
  }

  // Who is this?
  const { data: players } = await db.from("players").select("id, name, groupme_user_id, active");
  const all = (players ?? []) as Player[];
  const active = all.filter(p => p.active);
  const linked = all.find(p => p.groupme_user_id === msg.user_id) ?? null;
  const unlinked = (list: Player[]) => list.filter(p => !p.groupme_user_id);
  let player: Player | null;
  let isNewPlayer = false;
  if (cmd.kind === "in_as" && cmd.name === "new") {
    player = linked;
    if (!player) {
      player = await addPlayer(db, msg.name.trim());
      isNewPlayer = true;
    }
  } else if (cmd.kind === "in_as") {
    player = findPlayer(active, cmd.name) ?? findPlayer(all, cmd.name);
    if (!player) {
      await postToGroup(`I couldn't find "${cmd.name}" on the roster. First time playing? Reply "in as new" and I'll add you as ${msg.name}.`);
      return;
    }
  } else {
    player = linked ?? findPlayer(unlinked(active), msg.name) ?? findPlayer(unlinked(all), msg.name);
    if (!player) {
      // Saying "out" when we don't know you yet changes nothing — stay quiet.
      if (cmd.kind === "out") return;
      await postToGroup(
        `${msg.name}, I don't see you on the roster.\n` +
        `• Played with us before? Reply "in as <your roster name>", e.g. "in as Randy K."\n` +
        `• First time? Reply "in as new" and I'll add you as ${msg.name}.`);
      return;
    }
  }
  await linkPlayer(db, player, msg.user_id);

  const when = fmtDate(round.date);
  if (cmd.kind === "out") {
    const { data: removed } = await db.from("rsvps").delete()
      .eq("round_id", round.id).eq("player_id", player.id).select("id");
    // Not on the list: nothing to confirm, so don't add noise to the chat.
    if (!removed?.length) return;
    await postToGroup(`👋 ${player.name} is out for ${when}. ${await countIn(db, round.id)} in.`);
    return;
  }

  // "+ SM" on its own adds a guest without re-RSVPing the sender.
  let selfLine = "";
  if (cmd.kind !== "guest") {
    const wasIn = !(await rsvp(db, round, player.id, player.name));
    selfLine = wasIn ? `${player.name}, you're already in.`
      : isNewPlayer ? `👋 Welcome, ${player.name}! You're on the roster and in.`
      : `✅ ${player.name} is in.`;
  }

  const extras = [...buddies, ...(cmd.kind === "in" || cmd.kind === "guest" ? cmd.guests : [])];
  const added: string[] = [];
  for (const name of extras) added.push(await rsvpExtra(db, round, all.filter(p => p.id !== player!.id), name, player.name));

  const n = await countIn(db, round.id);
  const parts = [selfLine, added.length ? `➕ ${added.join(", ")}.` : "", `${n} in for ${when}.`].filter(Boolean);
  await postToGroup(parts.join(" "));
}

// Inserts an RSVP; false if they were already in.
async function rsvp(db: SupabaseClient, round: Round, playerId: string, name: string): Promise<boolean> {
  const { error } = await db.from("rsvps").insert({ round_id: round.id, player_id: playerId, name });
  if (error && error.code !== "23505") throw error;
  return !error;
}

// A buddy or guest someone else RSVP'd. A roster name gets a normal RSVP;
// anyone else is saved as "<name> (<host>'s guest)" with no player, and the
// commish adds them with + Add Guest. Returns how to describe them in the reply.
async function rsvpExtra(db: SupabaseClient, round: Round, roster: Player[], raw: string, host: string): Promise<string> {
  const match = findPlayer(roster.filter(p => p.active), raw) ?? findPlayer(roster, raw);
  if (match) {
    await rsvp(db, round, match.id, match.name);
    return match.name;
  }
  const label = raw.length <= 3 ? raw.toUpperCase() : raw.replace(/\b\p{L}/gu, c => c.toUpperCase());
  const name = `${label} (${host}'s guest)`;
  const { data: dupe } = await db.from("rsvps").select("id").eq("round_id", round.id).eq("name", name).maybeSingle();
  if (!dupe) {
    const { error } = await db.from("rsvps").insert({ round_id: round.id, player_id: null, name });
    if (error) throw error;
  }
  return `${label} as ${host}'s guest`;
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
