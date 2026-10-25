// Run: npx tsx test/rsvp-parse.test.ts
// Real messages from the league GroupMe (week of Oct 21, 2026) and what Sheila should do with each.
import { parseRsvp, findPlayer, isSender } from "../supabase/functions/_shared/rsvp-parse.ts";

const IN = (party: string[] = [], guests: string[] = []) => ({ kind: "in", party, guests });
const OUT = { kind: "out" };
const cases: [string, unknown][] = [
  // the week, in order
  ["I'm likely out this Sunday, but I want to let y'all know my band is playing this Friday at B-Side. We go on at 9.", null],
  ["My game Sunday. Who wants in?", null],
  ["In", IN()],
  ["In and MM", IN()],
  ["IN + MM", IN()],
  ["We really should play, in", IN()],
  ["In , if im welcomed back.", IN()],
  ["More than welcome, Andy , glad you are back", null],
  ["IN", IN()],
  ["In this week", IN()],
  ["I'm in.", IN()],
  ["In + MM. Also, we need 1 more to round out 2 4somes at Glen Eagle Saturday 11:20-30 tee. Any takers?", IN()],
  ["In Sunday.", IN()],
  ["Dave and Spencer in Sunday", IN(["dave", "spencer"])],
  ["In for Sunday", IN()],
  ["+ SM", { kind: "guest", guests: ["sm"] }],
  ["In Sun, maybe MM", IN()],
  ["I'm out. Working", OUT],
  ["1. Dick\n2. Billy\n3. Ricky\n4. Chip\n5. T$\nNext entry locks the game", null],
  ["JVH? Where yat?", null],
  ["Out this Sunday! No can play", OUT],
  ["24 is way better than 23 , someone help out the commish", null],
  ["Not worried about getting 24. Capping at 24", null],
  ["Keeping 3 scores is fun", null],
  ["Tik tok game locked", null],
  ["Pay me this week.", null],
  ["Venmo sent", null],
  ["Team 1\nT$ 37.3\nBenton 39\nSpencer 39.1", null],
  ["Tee time order was randomly drawn. If MM pushes players late we will adjust.", null],
  // other things people type
  ["in!", IN()], ["Innnn", IN()], ["in 👍", IN()], ["count me in", IN()], ["IN like Flynn", IN()],
  ["Yes, in", IN()], ["Sorry guys, I'm out", OUT], ["out of town", OUT], ["out", OUT],
  ["in + Spencer", IN([], ["spencer"])], ["In with my brother-in-law", null], ["me and joe b in", IN(["me", "joe b"])],
  ["in as Randy K.", { kind: "in_as", name: "randy k" }], ["in as new", { kind: "in_as", name: "new" }],
  ["who's in", { kind: "who" }], ["Whos in?", { kind: "who" }],
  // must stay quiet
  ["in?", null], ["Who's in for MM?", null], ["In the future let's tee off earlier", null],
  ["Are you in?", null], ["We should play in the morning", null], ["Out of curiosity who has the cart", null],
  ["Who wants in", null], ["you and me in?", null],
];

let fail = 0;
for (const [msg, want] of cases) {
  const got = parseRsvp(msg);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log(`✗ ${JSON.stringify(msg)}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(got)}`);
  }
}

// GroupMe senders from the same week against the real roster (unlinked players only).
const roster = `Andy|Andy M.|Arthur|Ben H.|Ben M.|Benton|Billie W.|Bryan H.|Burton|Cary|Chip W.|Chris Lareau|Colin B.|Corey|Dave Markham|David T.|Dick H.|Freddie|Harry O|Hugh C.|Iain|Jacob|Jay Sheffield|JC Youngblood|Joe Boone|John M.|John Markham|Jon H.|Jon Murdock|Jon Van Hoozer|Junior|Justin D|Justin G|Larry W.|Lee D.|Matt W|Mick|Nathan O.|Randy Jr|Randy K.|Rich P|Ricky S.|Robin F.|Sam Goodwin|Spencer T|Spier Sowell|Steve M|Stuart P.|Terrence (T$)|Terry W.|Tom M.|Trey S.|Wade|Wayne|Webb Playford|Wesley W|William W.|Zac`
  .split("|").map((name, i) => ({ id: String(i), name }));
const senders: [string, string | null][] = [
  ["Bryan Hartley", "Bryan H."], ["Dick Huffman", "Dick H."], ["Billie Worley", "Billie W."], ["Chip Wallace", "Chip W."],
  ["Ricky Rosé", null /* roster has Ricky S. — he'll be asked */], ["Terrence Bishop", "Terrence (T$)"],
  ["Benton Pratt", "Benton"], ["Arthur Goss", "Arthur"], ["Andy Mullis", "Andy M."], ["Colin Butler", "Colin B."],
  ["Iain Parks 2", "Iain"], ["John Markham", "John Markham"], ["Burton Milnor", "Burton"], ["William Wunderlich", "William W."],
  ["Larry Walker", "Larry W."], ["David Turner", "David T."], ["Nathan O'Kelly", "Nathan O."], ["Zac Ives", "Zac"],
  ["Andy King 2", "Andy"], ["Lee Downing", "Lee D."], ["Jon Van Hoozer", "Jon Van Hoozer"], ["Joe Boone", "Joe Boone"],
  ["Spencer", "Spencer T"], ["sm", null], ["joe b", "Joe Boone"],
];
for (const [s, want] of senders) {
  const got = findPlayer(roster, s)?.name ?? null;
  if (got !== want) { fail++; console.log(`✗ match ${s}: want ${want}, got ${got}`); }
}
for (const [part, sender, want] of [["dave", "David Turner", true], ["spencer", "David Turner", false], ["me", "X", true]] as const) {
  if (isSender(part, sender) !== want) { fail++; console.log(`✗ isSender ${part}/${sender}`); }
}

console.log(fail ? `${fail} failed` : `all ${cases.length + senders.length + 3} passed`);
process.exit(fail ? 1 : 0);
