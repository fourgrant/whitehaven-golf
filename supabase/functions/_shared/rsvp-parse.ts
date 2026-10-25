// Sheila — reads RSVP replies from the league GroupMe.
//
// Pure functions (no Deno or Supabase calls) so they can be tested directly:
//   npx tsx test/rsvp-parse.test.ts
//
// What people actually type, from a real week of the league chat:
//   "In", "IN", "I'm in.", "In this week", "In Sunday.", "In for Sunday"
//   "IN + MM", "In and MM", "In Sun, maybe MM"     MM = Madman, the early 9; ignored
//   "In , if im welcomed back."                    anything after a comma/period is chatter
//   "We really should play, in"                    "in" as the last clause
//   "In" then "+ SM"                               bringing a guest
//   "Dave and Spencer in Sunday"                   RSVPing yourself and a buddy
//   "I'm out. Working", "Out this Sunday! No can play"
// and what must be ignored:
//   "My game Sunday. Who wants in?", "In?", numbered lists, "I'm likely out this Sunday, but…"

export type Parsed =
  | { kind: "in"; party: string[]; guests: string[] } // party: names before "in" ("dave and spencer in")
  | { kind: "in_as"; name: string }
  | { kind: "out" }
  | { kind: "guest"; guests: string[] }               // "+ SM" on its own
  | { kind: "who" };

// Words that can follow "in"/"out" without changing the meaning.
const FILLER = new Set(`
  this that week weekend sunday sun sundays tomorrow today for the game round again too also as well
  yes yep yup yeah ya sir yessir please pls guys gents fellas boys yall y'all all man bro
  lets let's go like flynn baby buddy count me definitely def for sure
`.trim().split(/\s+/));
const OUT_FILLER = new Set(`
  of town sick working work sorry cant can't can no not play playing family travel traveling
  unfortunately next time i'm im this week
`.trim().split(/\s+/));
// Words that mean "pre" isn't a list of names ("who wants in", "we should play in").
const NOT_NAMES = new Set(`
  who what when where why how is are was were you we they he she it i i'm im should could would
  will can wants want play playing get got be been all anyone someone y'all yall the a an to of in out
`.trim().split(/\s+/));

const CLAUSE_END = /[\n.,!?;:]/;

function clean(raw: string): string {
  return raw.toLowerCase()
    .replace(/[‘’]/g, "'")
    // MM / Madman is the early nine; "in + mm", "in and mm", "maybe mm" all just mean "in".
    .replace(/\s*(?:\+|&|\band\b|,)?\s*(?:\bmaybe\s+)?\b(?:mad\s?m[ae]n|mm)\b/g, "")
    // Emoji and symbols become spaces; keep letters, digits, ' + & and clause punctuation.
    .replace(/[^\p{L}\p{N}'+&\n.,!?;:$\s]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

// "spencer", "spencer t", "sm" → name parts; null if it doesn't look like a list of names.
function splitNames(s: string): string[] | null {
  const parts = s.split(/\s*(?:\band\b|&|\+|,|\bwith\b|\bplus\b)\s*/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const w = words(p);
    if (w.length > 2 || w.some(x => NOT_NAMES.has(x) && x !== "me")) return null;
  }
  return parts;
}

// One clause → in/out, or null. Allows "i'm"/"count me" before and filler after.
function parseClause(clause: string, allowParty: boolean): Parsed | null {
  const m = clause.match(/^(.*?)\b(?:(?:i'?m|im|i am|count me)\s+)?(in+|out)\b(.*)$/);
  if (!m) return null;
  const [, pre, word, post] = m;
  const isIn = word.startsWith("in");

  let party: string[] = [];
  if (pre.trim()) {
    // Only "dave and spencer in" style — two or more names, one of them the sender.
    const names = allowParty && isIn ? splitNames(pre) : null;
    if (!names || names.length < 2) return null;
    party = names;
  }

  let guests: string[] = [];
  const rest = post.trim();
  const plus = rest.match(/^(?:\+|&|and|with|plus)\s*(?:1\s+)?(.+)$/);
  if (isIn && plus) {
    const names = splitNames(plus[1]);
    if (!names) return null;
    guests = names;
  } else if (rest) {
    const ok = isIn ? FILLER : new Set([...FILLER, ...OUT_FILLER]);
    if (!words(rest).every(w => ok.has(w))) return null;
  }
  return isIn ? { kind: "in", party, guests } : { kind: "out" };
}

export function parseRsvp(raw: string): Parsed | null {
  if (!raw?.trim()) return null;

  // "in as Randy K." — read the whole first line so the name keeps its period.
  const firstLine = raw.split("\n")[0].toLowerCase().replace(/[‘’]/g, "'").trim();
  const inAs = firstLine.match(/^(?:in|i'?m in|count me in) as (.+?)[\s.!]*$/);
  if (inAs && !firstLine.endsWith("?")) return { kind: "in_as", name: inAs[1].trim() };

  const text = clean(raw);
  if (!text) return null;

  if (/^who'?s in\b[\s?!.]*$/.test(text)) return { kind: "who" };

  // "+ SM", "+1 Spencer" on their own.
  const plusOnly = text.match(/^\+\s*(?:1\s+)?([^\n.,!?;:]+)[\s.!]*$/);
  if (plusOnly) {
    const names = splitNames(plusOnly[1]);
    return names ? { kind: "guest", guests: names } : null;
  }

  // Split into clauses, remembering what ended each one.
  const clauses: { text: string; end: string }[] = [];
  let cur = "";
  for (const ch of text) {
    if (CLAUSE_END.test(ch)) {
      if (cur.trim()) clauses.push({ text: cur.trim(), end: ch });
      else if (clauses.length && ch === "?") clauses[clauses.length - 1].end = "?";
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) clauses.push({ text: cur.trim(), end: "" });
  if (!clauses.length) return null;

  // Usually the first clause: "In , if im welcomed back."
  const first = clauses[0];
  if (first.end !== "?") {
    const p = parseClause(first.text, true);
    if (p) return p;
  }
  // Or the last: "We really should play, in". Strict — just in/out, nothing else.
  const last = clauses[clauses.length - 1];
  if (clauses.length > 1 && last.end !== "?") {
    const p = parseClause(last.text, false);
    if (p && (p.kind === "out" || (!p.party.length && !p.guests.length)) && /^(?:i'?m |im |count me )?(?:in+|out)$/.test(last.text)) return p;
  }
  return null;
}

// ===== NAME MATCHING =====
// GroupMe display names ("Andy Mullis", "Iain Parks 2", "Nathan O'Kelly") vs
// roster names ("Andy M.", "Iain", "Nathan O.", "Terrence (T$)").

const NICKNAMES: string[][] = [
  ["joe", "joseph", "joey"], ["dave", "david", "davey"], ["bill", "william", "will", "billy", "billie"],
  ["mike", "michael"], ["rob", "robert", "bob", "bobby", "robby", "robbie"], ["dick", "richard", "rich", "rick", "ricky"],
  ["jim", "james", "jimmy"], ["tom", "thomas", "tommy"], ["chris", "christopher"], ["dan", "daniel", "danny"],
  ["andy", "andrew", "drew"], ["tony", "anthony"], ["matt", "matthew"], ["steve", "steven", "stephen"],
  ["ben", "benjamin"], ["sam", "samuel"], ["nate", "nathan"], ["zac", "zach", "zack", "zachary"],
  ["larry", "lawrence"], ["terry", "terrence", "terence"], ["jon", "john", "johnny", "jonathan"],
];

export function nameTokens(s: string): string[] {
  return s.toLowerCase()
    .replace(/\([^)]*\)/g, " ")          // "Terrence (T$)" → "terrence"
    .replace(/[^\p{L}\p{N}\s]/gu, "")    // "O'Kelly" → "okelly", "K." → "k"
    .split(/\s+/).filter(w => w && !/^\d+$/.test(w)); // "Iain Parks 2" → iain parks
}

// Same first name, or nicknames of each other ("joe" / "joseph").
function firstMatch(a: string, b: string): boolean {
  return a === b || NICKNAMES.some(g => g.includes(a) && g.includes(b));
}

function lastMatch(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

export type Named = { id: string; name: string };

// Best single roster match for a name, or null when there's none or it's a toss-up.
//   1. exact ("Joe Boone")
//   2. first + last agree ("Andy Mullis" → "Andy M.")
//   3. nickname + last agree ("Joseph Jones" → "Joe Jones")
//   4. first name only, when one side has no last name ("Benton Pratt" → "Benton")
export function findPlayer<T extends Named>(players: T[], name: string): T | null {
  const b = nameTokens(name);
  if (!b.length) return null;
  const key = b.join(" ");
  const tiers: T[][] = [[], [], [], []];
  for (const p of players) {
    const a = nameTokens(p.name);
    if (!a.length) continue;
    const both = a.length > 1 && b.length > 1 && lastMatch(a[1], b[1]);
    if (a.join(" ") === key) tiers[0].push(p);
    else if (both && a[0] === b[0]) tiers[1].push(p);
    else if (both && firstMatch(a[0], b[0])) tiers[2].push(p);
    else if ((a.length === 1 || b.length === 1) && a[0] === b[0]) tiers[3].push(p);
  }
  for (const t of tiers) {
    if (t.length === 1) return t[0];
    if (t.length > 1) return null;
  }
  return null;
}

// Does "dave" / "me" in "dave and spencer in" refer to the sender "David Turner"?
export function isSender(part: string, senderName: string): boolean {
  const p = nameTokens(part), s = nameTokens(senderName);
  if (part.trim() === "me" || part.trim() === "i") return true;
  if (!p.length || !s.length) return false;
  if (!firstMatch(p[0], s[0])) return false;
  return p.length === 1 || s.length === 1 || lastMatch(p[1], s[1]);
}
