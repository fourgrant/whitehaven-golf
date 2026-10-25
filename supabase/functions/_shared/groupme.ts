// Sheila — shared GroupMe helpers for the groupme-post and groupme-callback
// Edge Functions.
//
// Sheila posts as a GroupMe bot: POST https://api.groupme.com/v3/bots/post
// with { bot_id, text }. No access token is needed, so the bot id is the
// secret — it lives only in the GROUPME_BOT_ID function secret.
//
// Every message is built here from the database. The browser only ever says
// "post the teams for round X", never the text itself, so the anon key can't
// be used to put arbitrary words in the league chat.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const SITE_URL = "https://whitehavensundayleague.com";
const TZ = "America/Chicago";
const MAX_LEN = 1000; // GroupMe's per-message text limit

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export type Mention = { userId: string; name: string };

// Posts text as Sheila. Long messages are split on line breaks so nothing is
// cut off mid-name. Mentions turn "@Name" in the text into a real GroupMe tag
// (so that player gets a notification); if GroupMe rejects them, post plain.
export async function postToGroup(text: string, mentions: Mention[] = []): Promise<void> {
  const botId = Deno.env.get("GROUPME_BOT_ID");
  if (!botId) throw new Error("GROUPME_BOT_ID is not set");

  for (const chunk of splitMessage(text)) {
    const tags = mentions
      .map(m => ({ ...m, at: chunk.indexOf("@" + m.name) }))
      .filter(m => m.at >= 0);
    const body: Record<string, unknown> = { bot_id: botId, text: chunk };
    if (tags.length) {
      body.attachments = [{
        type: "mentions",
        user_ids: tags.map(m => m.userId),
        loci: tags.map(m => [m.at, m.name.length + 1]),
      }];
    }
    let res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && tags.length) {
      res = await fetch("https://api.groupme.com/v3/bots/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: botId, text: chunk }),
      });
    }
    if (!res.ok) throw new Error(`GroupMe post failed: ${res.status} ${await res.text()}`);
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const chunks: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && (cur + "\n" + line).length > MAX_LEN) { chunks.push(cur); cur = line; }
    else cur = cur ? cur + "\n" + line : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ===== DATES =====
// Today in Central time as YYYY-MM-DD (the league plays in Memphis).
export function todayCentral(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// Now in Central time as "YYYY-MM-DD HH:MM:SS", so it compares as a string.
function nowCentral(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date());
}

export function fmtDate(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function fmtRel(n: number): string {
  return n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`;
}

function money(n: number): string {
  return "$" + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

// ===== ROUND LOOKUPS =====
export type Round = {
  id: string; date: string; course: string; buyin_per_player: number; status: string;
  team_scores: Record<string, number> | null; round_state: Record<string, any> | null;
  max_players: number | null; rsvp_list_sig: string | null;
};

export type Rsvp = {
  id: string; name: string; player_id: string | null; waitlisted: boolean; created_at: string;
  players: { groupme_user_id: string | null } | null;
};

export async function getRound(db: SupabaseClient, roundId: string): Promise<Round | null> {
  const { data } = await db.from("rounds").select("*").eq("id", roundId).maybeSingle();
  return data;
}

// The round people are RSVPing for: the next one that isn't finished.
export async function getOpenRound(db: SupabaseClient): Promise<Round | null> {
  const { data } = await db.from("rounds").select("*")
    .neq("status", "complete").gte("date", todayCentral())
    .order("date").limit(1);
  return data?.[0] ?? null;
}

// Everyone who RSVP'd, in the order they did.
export async function getRsvps(db: SupabaseClient, roundId: string): Promise<Rsvp[]> {
  const { data, error } = await db.from("rsvps")
    .select("id, name, player_id, waitlisted, created_at, players(groupme_user_id)")
    .eq("round_id", roundId).order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as Rsvp[];
}

// ===== CAP + WAITLIST =====
// The rsvps_waitlist trigger puts new RSVPs past rounds.max_players on the
// waitlist. When a spot opens, the earliest waitlisted player moves up.

export function inList(rsvps: Rsvp[]): Rsvp[] { return rsvps.filter(r => !r.waitlisted); }
export function waitList(rsvps: Rsvp[]): Rsvp[] { return rsvps.filter(r => r.waitlisted); }

// Moves people off the waitlist: one named RSVP (the commish's "Move in"), or
// as many as there are open spots. Returns who moved up.
export async function promoteFromWaitlist(db: SupabaseClient, round: Round, rsvpId?: string): Promise<Rsvp[]> {
  const rsvps = await getRsvps(db, round.id);
  let toPromote: Rsvp[];
  if (rsvpId) {
    toPromote = rsvps.filter(r => r.id === rsvpId && r.waitlisted);
  } else {
    const open = round.max_players == null ? Infinity : round.max_players - inList(rsvps).length;
    toPromote = open > 0 ? waitList(rsvps).slice(0, open) : [];
  }
  if (!toPromote.length) return [];
  const { error } = await db.from("rsvps").update({ waitlisted: false }).in("id", toPromote.map(r => r.id));
  if (error) throw error;
  return toPromote;
}

// "@Name" for players Sheila knows on GroupMe (so they get tagged), plain name otherwise.
export function tagged(rsvps: Rsvp[]): { names: string[]; mentions: Mention[] } {
  const mentions: Mention[] = [];
  const names = rsvps.map(r => {
    const userId = r.players?.groupme_user_id;
    if (!userId) return r.name;
    mentions.push({ userId, name: r.name });
    return "@" + r.name;
  });
  return { names, mentions };
}

export async function postPromoted(round: Round, promoted: Rsvp[]): Promise<void> {
  if (!promoted.length) return;
  const { names, mentions } = tagged(promoted);
  await postToGroup(`🎉 A spot opened up — ${names.join(", ")}, you're off the waitlist and in for ${fmtDate(round.date)}.`, mentions);
}

// Who's on the list right now; the evening post skips when this hasn't changed.
export function listSig(rsvps: Rsvp[]): string {
  return inList(rsvps).map(r => r.id).join(",") + "|" + waitList(rsvps).map(r => r.id).join(",");
}

export async function saveListSig(db: SupabaseClient, round: Round, rsvps: Rsvp[]): Promise<void> {
  await db.from("rounds").update({ rsvp_list_sig: listSig(rsvps) }).eq("id", round.id);
}

// RSVPs close at tee time, 9 AM Central on round day, matching rsvp.js. Keeping
// them open that morning lets late drop-outs say "out".
export const RSVP_CLOSE = "09:00:00";
export function rsvpsClosed(round: Round): boolean {
  return nowCentral() >= `${round.date} ${RSVP_CLOSE}`;
}

// ===== MESSAGES =====
export function rsvpLink(round: Round): string {
  return `${SITE_URL}/rsvp.html?round=${round.id}`;
}

export function msgRsvpOpen(round: Round): string {
  return [
    `⛳ RSVPs are open for ${fmtDate(round.date)} at ${round.course} — $${round.buyin_per_player} all-in.` +
      (round.max_players != null ? ` Capped at ${round.max_players}; after that it's a waitlist.` : ``),
    ``,
    `Reply "in" right here to RSVP (or "out" to drop). Or use the link:`,
    rsvpLink(round),
  ].join("\n");
}

function capLabel(round: Round, n: number): string {
  return round.max_players == null ? `${n}` : `${n}/${round.max_players}`;
}

function waitlistLines(rsvps: Rsvp[]): string[] {
  const w = waitList(rsvps);
  return w.length ? [``, `⏳ Waitlist: ` + w.map((r, i) => `${i + 1}. ${r.name}`).join(", ")] : [];
}

function isFull(round: Round, rsvps: Rsvp[]): boolean {
  return round.max_players != null && inList(rsvps).length >= round.max_players;
}

export function msgRsvpList(round: Round, rsvps: Rsvp[]): string {
  const ins = inList(rsvps);
  if (!ins.length) {
    return `Nobody's in yet for ${fmtDate(round.date)}. Reply "in" to be the first.`;
  }
  return [
    `📋 In for ${fmtDate(round.date)} (${capLabel(round, ins.length)}):`,
    ...ins.map((r, i) => `${i + 1}. ${r.name}`),
    ...waitlistLines(rsvps),
    ``,
    isFull(round, rsvps) ? `🔒 We're full. Reply "in" to join the waitlist.` : `Reply "in" to join.`,
  ].join("\n");
}

export function msgReminder(round: Round, rsvps: Rsvp[]): string {
  const ins = inList(rsvps);
  const lines = [`⛳ Tomorrow at ${round.course} — $${round.buyin_per_player} all-in.`];
  if (ins.length) {
    lines.push(``, `${capLabel(round, ins.length)} in so far:`, ins.map(r => r.name).join(", "));
    lines.push(...waitlistLines(rsvps));
  } else {
    lines.push(``, `Nobody's RSVP'd yet.`);
  }
  lines.push(``, isFull(round, rsvps)
    ? `We're full — reply "in" for the waitlist, or "out" by 9 AM tomorrow if you can't make it.`
    : `Reply "in" or "out" by 9 AM tomorrow — that's when RSVPs close.`);
  return lines.join("\n");
}

export async function msgTeams(db: SupabaseClient, round: Round): Promise<string | null> {
  const { data } = await db.from("round_players")
    .select("team, players(name)").eq("round_id", round.id).not("team", "is", null);
  const teams: Record<string, string[]> = {};
  for (const rp of data ?? []) {
    if (!rp.team) continue;
    (teams[rp.team] ??= []).push((rp as any).players?.name ?? "?");
  }
  const letters = Object.keys(teams).sort();
  if (!letters.length) return null;
  return [
    `🏌️ Teams for ${fmtDate(round.date)}`,
    ...letters.map(t => `\nTeam ${t}\n` + teams[t].join("\n")),
  ].join("\n");
}

export async function msgResults(db: SupabaseClient, round: Round): Promise<string | null> {
  const [{ data: rps }, { data: results }] = await Promise.all([
    db.from("round_players").select("id, player_id, team, holes_won, players(name)").eq("round_id", round.id),
    db.from("round_results").select("player_id, team_winnings, skin_winnings, cth_winnings, total_winnings").eq("round_id", round.id),
  ]);
  if (!rps?.length || !results?.length) return null;

  const nameByPlayer: Record<string, string> = {};
  const nameByRp: Record<string, string> = {};
  for (const rp of rps as any[]) {
    nameByPlayer[rp.player_id] = rp.players?.name ?? "?";
    nameByRp[rp.id] = rp.players?.name ?? "?";
  }
  const resByPlayer: Record<string, any> = {};
  for (const r of results) resByPlayer[r.player_id] = r;

  const lines = [`🏆 Results — ${fmtDate(round.date)} at ${round.course}`];

  // Winning team(s): any team whose players took team winnings.
  const winTeams = [...new Set((rps as any[])
    .filter(rp => (resByPlayer[rp.player_id]?.team_winnings ?? 0) > 0).map(rp => rp.team))].sort();
  for (const t of winTeams) {
    const members = (rps as any[]).filter(rp => rp.team === t);
    const each = resByPlayer[members[0].player_id]?.team_winnings ?? 0;
    const score = round.team_scores?.[t];
    lines.push(``, `Team ${t} wins${typeof score === "number" ? ` at ${fmtRel(score)}` : ""} — ${money(each)} each`);
    lines.push(members.map(rp => nameByPlayer[rp.player_id]).join(", "));
  }

  const skins = (rps as any[]).filter(rp => rp.holes_won > 0);
  if (skins.length) {
    lines.push(``, `🎯 Skins: ` + skins.map(rp =>
      `${nameByPlayer[rp.player_id]}${rp.holes_won > 1 ? ` ×${rp.holes_won}` : ""} (${money(resByPlayer[rp.player_id]?.skin_winnings ?? 0)})`
    ).join(", "));
  }

  const cth = round.round_state?.cthWinners ?? {};
  const cthParts = [["2", cth.hole2], ["5", cth.hole5]]
    .filter(([, id]) => id && nameByRp[id]).map(([h, id]) => `#${h} ${nameByRp[id]}`);
  if (cthParts.length) lines.push(`📍 Closest to the hole: ${cthParts.join(", ")}`);

  lines.push(``, `Full card: ${SITE_URL}/?round=${round.id}`);
  return lines.join("\n");
}
