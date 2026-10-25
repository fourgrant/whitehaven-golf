#!/usr/bin/env node
/* ============================================================
   Sheila (Whitehaven Sunday League) — Round Reminder Script
   The day before a round, Sheila posts one reminder to the
   league GroupMe with who's in so far. With MODE=evening, she
   posts the RSVP list instead — only if it changed since the
   last list. The messages are built by the groupme-post edge
   function.
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

// ===== MAIN =====
async function main() {
  if (process.env.MODE === 'evening') {
    const res = await supabase('POST', '/functions/v1/groupme-post', { kind: 'evening_list' });
    if (res.status !== 200) {
      console.error('✗ Evening list failed:', JSON.stringify(res.body));
      process.exit(1);
    }
    console.log(res.body.skipped ? `Skipped: ${res.body.skipped}` : `✓ Posted list:\n${res.body.text}`);
    return;
  }

  // Tomorrow's date in YYYY-MM-DD
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
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
