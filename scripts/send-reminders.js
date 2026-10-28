#!/usr/bin/env node
/* ============================================================
   Sheila (Whitehaven Sunday League) — Round Reminder Script
   The day before a round, Sheila posts one reminder to the
   league GroupMe with who's in so far. With MODE=evening, she
   posts the RSVP list instead — only if it changed since the
   last list. The messages are built by the groupme-post edge
   function. Nothing is posted in quiet hours (11 PM–6 AM
   Central) — GitHub sometimes runs a scheduled job hours late.
   Pure Node — no npm deps (uses built-in https).
   ============================================================ */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ===== HTTP HELPERS =====
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function supabase(method, path, body) {
  const url = new URL(SUPABASE_URL);
  return request({
    hostname: url.hostname,
    path,
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  }, body);
}

// ===== CENTRAL TIME =====
// The league runs on Central time whatever zone the runner is in.
const TZ = 'America/Chicago';
const QUIET_START = 23, QUIET_END = 6; // keep in step with _shared/groupme.ts

function centralParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = t => parts.find(p => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

// ===== MAIN =====
async function main() {
  const now = centralParts();
  if (now.hour >= QUIET_START || now.hour < QUIET_END) {
    console.log(`Quiet hours (${now.hour}:00 Central) — not posting.`);
    return;
  }

  if (process.env.MODE === 'evening') {
    const res = await supabase('POST', '/functions/v1/groupme-post', { kind: 'evening_list' });
    if (res.status !== 200) {
      console.error('✗ Evening list failed:', JSON.stringify(res.body));
      process.exit(1);
    }
    console.log(res.body.skipped ? `Skipped: ${res.body.skipped}` : `✓ Posted list:\n${res.body.text}`);
    return;
  }

  // Tomorrow's date in Central time, YYYY-MM-DD
  const tomorrow = new Date(now.date + 'T12:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  console.log(`Looking for rounds on ${tomorrowStr}…`);

  const roundsRes = await supabase('GET', `/rest/v1/rounds?date=eq.${tomorrowStr}&status=neq.complete&select=id,course`);
  if (roundsRes.status !== 200) {
    console.error('Error fetching rounds:', roundsRes.body);
    process.exit(1);
  }

  const rounds = roundsRes.body;
  if (!rounds.length) {
    console.log('No rounds tomorrow — nothing to send.');
    return;
  }

  let failures = 0;
  for (const round of rounds) {
    const res = await supabase('POST', '/functions/v1/groupme-post', { kind: 'reminder', round_id: round.id });
    if (res.status === 200) {
      console.log(`✓ Posted reminder for ${round.course} (${round.id}):\n${res.body.text}`);
    } else {
      console.error(`✗ Reminder failed for round ${round.id}:`, JSON.stringify(res.body));
      failures++;
    }
  }

  console.log('Done.');
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
