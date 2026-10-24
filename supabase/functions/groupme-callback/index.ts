// Sheila — groupme-callback Edge Function
//
// GroupMe POSTs every message in the league chat here (the bot's Callback
// URL). Sheila only acts on a few exact replies and ignores all other chatter:
//
//   in / i'm in / count me in      → RSVP for the next round
//   in as <roster name>            → RSVP, and remember which player you are
//   in as new                      → first-timer: add to the roster under their GroupMe name, then RSVP
//   out / i'm out / count me out   → drop your RSVP
//   who's in                       → post the current list
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
  adminClient, getOpenRound, getRsvpNames, postToGroup, rsvpsClosed, fmtDate, msgRsvpList,
} from "../_shared/groupme.ts";

type Player = { id: string; name: string; groupme_user_id: string | null };

const IN_RE  = /^(in|i'?m in|count me in)$/;
const OUT_RE = /^(out|i'?m out|count me out)$/;
const WHO_RE = /^who'?s in$/;
const IN_AS_RE = /^(?:in|i'?m in|count me in) as (.+)$/;

// Lowercase, straighten quotes, drop trailing punctuation/emoji.
function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}'\s]+$/u, "").replace(/\s+/g, " ").trim();
}

function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

// Does a roster name like "Randy K." plausibly belong to a GroupMe name like
// "Randy Kirkland"? First names must match; if both have a second token, one
// must be a prefix of the other ("k" ↔ "kirkland").
function namesMatch(roster: string, other: string): boolean {
  const a = nameTokens(roster), b = nameTokens(other);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a[1].startsWith(b[1]) || b[1].startsWith(a[1]);
}

// Exact match (ignoring case and punctuation) wins; otherwise accept only a single fuzzy match.
function findPlayer(players: Player[], name: string): Player | null {
  const key = nameTokens(name).join(" ");
  const exact = players.filter(p => nameTokens(p.name).join(" ") === key);
  if (exact.length === 1) return exact[0];
  const fuzzy = players.filter(p => namesMatch(p.name, name));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

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

  const text = normalize(msg.text);
  // "in?" is someone asking, not RSVPing.
  const asked = /\?\s*$/.test(msg.text);
  const inAs = asked ? null : text.match(IN_AS_RE);
  const isIn = !asked && (IN_RE.test(text) || !!inAs);
  const isOut = !asked && OUT_RE.test(text);
  const isWho = WHO_RE.test(text);
  if (!isIn && !isOut && !isWho) return new Response("ok");

  const db = adminClient();
  try {
    await handle(db, msg as Required<typeof msg>, { isIn, isOut, isWho, inAsName: inAs?.[1] ?? null });
  } catch (e) {
    console.error(e);
  }
  // Always 200 so GroupMe doesn't retry.
  return new Response("ok");
});

async function handle(
  db: SupabaseClient,
  msg: { name: string; user_id: string },
  cmd: { isIn: boolean; isOut: boolean; isWho: boolean; inAsName: string | null },
) {
  const round = await getOpenRound(db);
  if (!round) {
    await postToGroup(`No round is open for RSVPs yet — I'll post here when there is.`);
    return;
  }

  if (cmd.isWho) {
    await postToGroup(msgRsvpList(round, await getRsvpNames(db, round.id)));
    return;
  }

  if (rsvpsClosed(round)) {
    await postToGroup(`RSVPs for ${fmtDate(round.date)} are closed — check with the commish.`);
    return;
  }

  // Who is this?
  const { data: players } = await db.from("players").select("id, name, groupme_user_id").eq("active", true);
  const roster = (players ?? []) as Player[];
  const linked = roster.find(p => p.groupme_user_id === msg.user_id) ?? null;
  let player: Player | null;
  let isNewPlayer = false;
  if (cmd.inAsName === "new") {
    player = linked;
    if (!player) {
      player = await addPlayer(db, msg.name.trim());
      isNewPlayer = true;
    }
  } else if (cmd.inAsName) {
    player = findPlayer(roster, cmd.inAsName);
    if (!player) {
      await postToGroup(`I couldn't find "${cmd.inAsName}" on the roster. First time playing? Reply "in as new" and I'll add you as ${msg.name}.`);
      return;
    }
  } else {
    player = linked ?? findPlayer(roster.filter(p => !p.groupme_user_id), msg.name);
    if (!player) {
      await postToGroup(
        `${msg.name}, I don't see you on the roster.\n` +
        `• Played with us before? Reply "in as <your roster name>", e.g. "in as Randy K."\n` +
        `• First time? Reply "in as new" and I'll add you as ${msg.name}.`);
      return;
    }
  }
  await linkPlayer(db, player, msg.user_id);

  const when = fmtDate(round.date);
  if (cmd.isOut) {
    const { data: removed } = await db.from("rsvps").delete()
      .eq("round_id", round.id).eq("player_id", player.id).select("id");
    const n = await countIn(db, round.id);
    await postToGroup(removed?.length
      ? `👋 ${player.name} is out for ${when}. ${n} in.`
      : `${player.name}, you weren't on the list for ${when}. ${n} in.`);
    return;
  }

  const { error } = await db.from("rsvps").insert({ round_id: round.id, player_id: player.id, name: player.name });
  const n = await countIn(db, round.id);
  if (error && error.code !== "23505") throw error;
  await postToGroup(
    error ? `${player.name}, you're already in for ${when}. ${n} in.`
    : isNewPlayer ? `👋 Welcome, ${player.name}! You're on the roster and in for ${when}. ${n} in.`
    : `✅ ${player.name} is in for ${when}. ${n} in.`);
}

// Adds a first-timer the same way the RSVP page's "Not listed — add me" does.
// If the name is already taken (e.g. an inactive player), use that player.
async function addPlayer(db: SupabaseClient, name: string): Promise<Player> {
  const { data, error } = await db.from("players")
    .insert({ name, avg_score: 40, rounds_played: 0 })
    .select("id, name, groupme_user_id").single();
  if (!error) return data as Player;
  if (error.code !== "23505") throw error;
  const { data: existing, error: e2 } = await db.from("players")
    .select("id, name, groupme_user_id").eq("name", name).single();
  if (e2) throw e2;
  return existing as Player;
}
