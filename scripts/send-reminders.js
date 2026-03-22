#!/usr/bin/env node
/* ============================================================
   Whitehaven Golf League — Email Reminder Script
   Sends 24-hour reminders to RSVPd players.
   Pure Node — no npm deps (uses built-in https).
   ============================================================ */

const https = require('https');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL      = process.env.FROM_EMAIL || 'noreply@whitehavensundayleague.com';

if (!SUPABASE_URL || !SUPABASE_KEY || !RESEND_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY');
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

function supabaseGet(path) {
  const url = new URL(SUPABASE_URL);
  return request({
    hostname: url.hostname,
    path: `/rest/v1/${path}`,
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
}

function sendEmail(to, subject, html) {
  const body = { from: FROM_EMAIL, to, subject, html };
  return request({
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(JSON.stringify(body)),
    },
  }, body);
}

// ===== MAIN =====
async function main() {
  // Tomorrow's date in YYYY-MM-DD
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  console.log(`Looking for rounds on ${tomorrowStr}…`);

  // Fetch rounds scheduled for tomorrow
  const roundsRes = await supabaseGet(`rounds?date=eq.${tomorrowStr}&status=neq.complete&select=id,date,course,buyin_per_player`);
  if (roundsRes.status !== 200) {
    console.error('Error fetching rounds:', roundsRes.body);
    process.exit(1);
  }

  const rounds = roundsRes.body;
  if (!rounds.length) {
    console.log('No rounds tomorrow — nothing to send.');
    return;
  }

  let totalFailures = 0;

  for (const round of rounds) {
    console.log(`Processing round ${round.id} at ${round.course} on ${round.date}`);

    const rsvpsRes = await supabaseGet(`rsvps?round_id=eq.${round.id}&select=name,email`);
    if (rsvpsRes.status !== 200) {
      console.error('Error fetching RSVPs:', rsvpsRes.body);
      continue;
    }

    const rsvps = rsvpsRes.body;
    console.log(`  ${rsvps.length} RSVPs found`);

    const dateDisplay = new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });

    let failures = 0;
    for (const rsvp of rsvps) {
      const html = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <div style="background:#1a3a2a;color:#e8c97a;font-size:20px;font-weight:900;padding:16px 24px;border-radius:8px 8px 0 0;border-bottom:3px solid #c9a84c;">
            ⛳ Whitehaven Golf League
          </div>
          <div style="background:#f5f0e8;padding:24px;border-radius:0 0 8px 8px;border:1px solid #d8d0c0;border-top:none;">
            <p style="font-size:16px;margin:0 0 16px;">Hey ${rsvp.name},</p>
            <p style="font-size:14px;color:#6b6b5a;margin:0 0 16px;">Just a reminder — you're RSVPd for tomorrow's round:</p>
            <div style="background:white;border:1px solid #d8d0c0;border-radius:8px;padding:16px;margin-bottom:16px;">
              <div style="font-size:18px;font-weight:700;margin-bottom:4px;">${round.course}</div>
              <div style="font-family:monospace;font-size:13px;color:#6b6b5a;">${dateDisplay} · $${round.buyin_per_player} buy-in</div>
            </div>
            <p style="font-size:14px;color:#6b6b5a;margin:0;">See you tomorrow! 🏌️</p>
          </div>
        </div>
      `;

      const result = await sendEmail(rsvp.email, `Reminder: Golf tomorrow at ${round.course}`, html);
      if (result.status === 200 || result.status === 201) {
        console.log(`  ✓ Sent to ${rsvp.email}`);
      } else {
        console.error(`  ✗ Failed for ${rsvp.email}:`, JSON.stringify(result.body));
        failures++;
        totalFailures++;
      }
    }

    if (failures > 0) {
      console.error(`  ${failures} email(s) failed for round ${round.id}`);
    }
  }

  console.log('Done.');
  if (totalFailures > 0) process.exit(1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
