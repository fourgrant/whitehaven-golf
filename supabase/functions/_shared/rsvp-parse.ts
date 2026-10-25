// Sheila — reads RSVP replies from the league GroupMe.
//
// Pure functions (no Deno or Supabase calls) so they can be tested directly:
//   npx tsx test/rsvp-parse.test.ts
//
// What people actually type, from real weeks of the league chat:
//   "In", "IN", "I'm in.", "In this week", "In Sunday.", "In for Sunday"
//   "IN + MM", "In and MM", "In Sun, maybe MM"     MM = Madman, the early 9; ignored
//   "In , if im welcomed back.", "I'm in if I can be in first group…", "I am in and will cya Saturday"
//   "We really should play, in"                    "in" as the last clause
//   "In + Jeremy Wickham", "In with my brother-in-law"   bringing a guest
//   "Dave and Spencer in Sunday"                   RSVPing yourself and a buddy
//   "Andy Mullis is also in", "Harry is in too.", "My dad Bill Butler is in"   RSVPing someone else
//   "I'm out. Working", "Out of town this week and next.", "Ben Holloway now out for tomorrow"
// and what must be ignored:
//   "My game Sunday. Who wants in?", "In?", "Keep them in the fair.", "Dave had birdie in our group",
//   numbered lists, "I'm likely out this Sunday, but…", "+ SM" (almost always a fat-fingered MM)

export type Parsed =
  // party: names before "in" ("dave and spencer in", "harry is in") — may or may not include the sender
  | { kind: "in"; party: string[]; guests: string[] }
  | { kind: "in_as"; name: string }
  | { kind: "out"; party: string[] }
  | { kind: "guest"; guests: string[] }               // "+ Jeremy" on its own
  | { kind: "who" };

// Words that can follow "in"/"out" without changing the meaning.
const FILLER = new Set(`
  this that week weekend sunday sun sundays tomorrow today for the game round again too also as well
  yes yep yup yeah ya sir yessir please pls guys gents fellas boys yall y'all all man bro and next
  lets let's go like flynn baby buddy count me definitely def sure now
`.trim().split(/\s+/));
const OUT_FILLER = new Set(`
  of town sick working work sorry cant can't can no not play playing family travel traveling
  unfortunately time i'm im
`.trim().split(/\s+/));
// Words that mean a phrase isn't a list of names ("who wants in", "keep them in the fair").
const NOT_NAMES = new Set(`
  who what when where why how is are was were you we they he she it i'm im they're he's she's we're
  should could would can wants want play playing get got be been anyone someone everyone y'all yall
  the a an to of in out at on from by about them us him her his our your their that this there here
  keep put let lets had has have birdie group first second
`.trim().split(/\s+/));
// "my dad", "my brother-in-law Steve"
const RELATIONS = new Set(`
  dad father pops son brother bro uncle cousin nephew buddy friend boss neighbor
  fatherinlaw brotherinlaw soninlaw fil bil
`.trim().split(/\s+/));
// Between a name and "in": "Harry is in", "Andy Mullis is also in", "Ben Holloway now out"
const LINKS = new Set(["is", "are", "now", "also", "both", "too"]);

const CLAUSE_END = /[\n.,!?;:]/;

function clean(raw: string): string {
  return raw.toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/-in-law\b/g, "inlaw")
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

// "spencer", "joe b", "me", "my dad", "my dad bill butler" → name parts;
// null if it doesn't look like a list of names. One- and two-letter names are
// dropped: "+ SM" is a typo for MM far more often than a guest's initials.
function splitNames(s: string): string[] | null {
  const parts = s.split(/\s*(?:\band\b|&|\+|,|\bwith\b|\bplus\b)\s*/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: string[] = [];
  for (const p of parts) {
    let w = words(p);
    if (w.length === 1 && (w[0] === "me" || w[0] === "i")) { out.push(w[0]); continue; }
    if (w[0] === "my") {
      if (!RELATIONS.has(w[1])) return null;
      if (w.length === 2) { out.push(`my ${w[1]}`); continue; }
      w = w.slice(2); // "my dad bill butler" → "bill butler"
    }
    if (w.length > 2 || w.some(x => NOT_NAMES.has(x) || FILLER.has(x) || /^\d/.test(x))) return null;
    if (w.join("").replace(/[^\p{L}]/gu, "").length < 3) continue;
    out.push(w.join(" "));
  }
  return out;
}

// One clause → in/out, or null. Allows "i'm"/"count me" before and filler after.
function parseClause(clause: string): Parsed | null {
  const m = clause.match(/^(.*?)\b(?:(?:i'?m|im|i am|count me)\s+)?(in+|out)\b(.*)$/);
  if (!m) return null;
  const [, pre, word, post] = m;
  const isIn = word.startsWith("in");

  // Names before in/out: "dave and spencer", "andy mullis is also", "harry's"
  let party: string[] = [];
  const preW = words(pre);
  if (preW.length) {
    if (preW[preW.length - 1].endsWith("'s")) preW[preW.length - 1] = preW[preW.length - 1].slice(0, -2);
    while (preW.length && LINKS.has(preW[preW.length - 1])) preW.pop();
    const names = splitNames(preW.join(" "));
    if (!names?.length) return null;
    party = names;
  }

  let guests: string[] = [];
  const rest = post.trim();
  const plus = rest.match(/^(\+|&|and|with|plus)\s*(?:1\s+)?(.+)$/);
  const restOk = (r: string) => {
    const ok = isIn ? FILLER : new Set([...FILLER, ...OUT_FILLER]);
    return words(r).every(w => ok.has(w));
  };
  if (isIn && plus) {
    const names = splitNames(plus[2]);
    if (names) guests = names.filter(n => n !== "me" && n !== "i");
    // "I am in and will cya Saturday" — whatever follows "and" is chatter.
    else if (plus[1] !== "and" && !restOk(rest)) return null;
  } else if (isIn && /^if\b/.test(rest)) {
    // "I'm in if I can be in the first group" — still in.
  } else if (rest && !restOk(rest)) {
    return null;
  }
  return isIn ? { kind: "in", party, guests } : { kind: "out", party };
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

  // "+ Jeremy", "+1 Spencer" on their own.
  const plusOnly = text.match(/^\+\s*(?:1\s+)?([^\n.,!?;:]+)[\s.!]*$/);
  if (plusOnly) {
    const names = splitNames(plusOnly[1])?.filter(n => n !== "me" && n !== "i");
    return names?.length ? { kind: "guest", guests: names } : null;
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
    const p = parseClause(first.text);
    if (p) return p;
  }
  // Or the last: "We really should play, in". Strict — just in/out, nothing else.
  const last = clauses[clauses.length - 1];
  if (clauses.length > 1 && last.end !== "?" && /^(?:i'?m |im |count me )?(?:in+|out)$/.test(last.text)) {
    return parseClause(last.text);
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
