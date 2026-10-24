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

// Posts text as Sheila. Long messages are split on line breaks so nothing is
// cut off mid-name.
export async function postToGroup(text: string): Promise<void> {
  const botId = Deno.env.get("GROUPME_BOT_ID");
  if (!botId) throw new Error("GROUPME_BOT_ID is not set");

  for (const chunk of splitMessage(text)) {
    const res = await fetch("https://api.groupme.com/v3/bots/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot_id: botId, text: chunk }),
    });
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

export async function getRsvpNames(db: SupabaseClient, roundId: string): Promise<string[]> {
  const { data } = await db.from("rsvps").select("name").eq("round_id", roundId).order("created_at");
  return (data ?? []).map((r: { name: string }) => r.name);
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
    `⛳ RSVPs are open for ${fmtDate(round.date)} at ${round.course} — $${round.buyin_per_player} all-in.`,
    ``,
    `Reply "in" right here to RSVP (or "out" to drop). Or use the link:`,
    rsvpLink(round),
  ].join("\n");
}

export function msgRsvpList(round: Round, names: string[]): string {
  if (!names.length) {
    return `Nobody's in yet for ${fmtDate(round.date)}. Reply "in" to be the first.`;
  }
  return [
    `📋 In for ${fmtDate(round.date)} (${names.length}):`,
    ...names.map((n, i) => `${i + 1}. ${n}`),
    ``,
    `Reply "in" to join.`,
  ].join("\n");
}

export function msgReminder(round: Round, names: string[]): string {
  const lines = [`⛳ Tomorrow at ${round.course} — $${round.buyin_per_player} all-in.`];
  if (names.length) {
    lines.push(``, `${names.length} in so far:`, names.join(", "));
  } else {
    lines.push(``, `Nobody's RSVP'd yet.`);
  }
  lines.push(``, `Reply "in" or "out" by 9 AM tomorrow — that's when RSVPs close.`);
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
