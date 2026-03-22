# ⛳ Whitehaven Golf League

A web app for a casual 9-hole shambles golf league. Tracks teams, scores, skins, CTH bets, payouts, RSVPs, and season leaderboards.

**Stack:** Vanilla HTML/JS + Supabase + GitHub Pages — no build step, no framework.

---

## Commish Quick Start

> This section is for the person running the round each week. See [Setup](#setup) below if you're standing up the app for the first time.

### Before the round — send the RSVP link

1. Log in as commish (password prompt on the home screen)
2. Go to the **Round** tab
3. Set the date, course, and buy-in → click **Save Round**
4. A green **RSVP Link** card appears — click **Copy Link** and paste it into the group chat
5. Players open the link, pick their name from the dropdown, and submit
   - First-timers enter email + phone (saved for next time)
   - If you have Resend configured, players automatically get a reminder email the day before

### Day of the round — check in players and make teams

1. Go to the **Teams** tab
2. You'll see an **RSVPs** card at the top — click **Import RSVPs** to check in everyone who RSVPd, or click **Copy List** to paste the names into the group chat
3. Manually check in any walk-ups by tapping their name in the player list
4. Set the number of teams (2–6) and click **Auto-Balance** — the app sorts players by scoring average and snakes the draft
5. Drag players between teams to make manual adjustments if needed
6. Confirm buy-ins paid by tapping **Paid In** next to each player

### During the round — enter scores

1. Go to the **Scores** tab
2. Enter each player's individual 9-hole stroke total in their row — scores auto-save as you type (no Save button needed)
3. Enter each **team's combined shamble score** in the Team Score boxes at the top
4. Tap the hole number under **Skins** to mark hole winners (ties = no winner)
5. Tap **Hole 2** / **Hole 5** under **CTP** to mark closest-to-pin winners
6. The **Payout Summary** updates live — review who owes / is owed

**Tiebreaker:** If two teams are tied, a tiebreaker card appears. Enter hole 9 scores for each tied team — lowest wins. If still tied, hole 8 appears, then 7, and so on.

### Finishing up — finalize and pay out

1. Review the Payout Summary — mark **Paid Out** as you distribute cash
2. Click **Finalize Round** when everyone is settled
   - Saves all results to the database
   - Updates each player's scoring average
   - Round appears in History immediately

---

## Setup

### 1. Fork / clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/whitehaven-golf.git
cd whitehaven-golf
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project → name it `whitehaven-golf`
2. Once created, go to **Project Settings → API**
3. Copy your **Project URL**, **anon/public** key, and **service_role** key

### 3. Run the database schema

1. In Supabase, go to the **SQL Editor**
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Click **Run** — this creates all tables, RLS policies, and seeds the player roster

### 4. Add GitHub Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value | Required for |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | App + reminders |
| `SUPABASE_ANON_KEY` | `eyJ...` (anon key) | App |
| `COMMISH_PASSWORD` | A password only the commish knows | App |
| `SUPABASE_SERVICE_KEY` | `eyJ...` (service_role key) | Email reminders |
| `RESEND_API_KEY` | From [resend.com](https://resend.com) | Email reminders |
| `FROM_EMAIL` | `reminders@yourdomain.com` | Email reminders |

> The last three secrets are only needed if you want automated email reminders. The app works without them.

### 5. Push to `main`

GitHub Actions will automatically inject the config and deploy to the `gh-pages` branch.

```bash
git push origin main
```

### 6. Enable GitHub Pages

1. Repo → **Settings → Pages**
2. **Source:** Deploy from a branch → Branch: `gh-pages` → folder: `/ (root)`
3. Save

### 7. Share the URL

Your app will be live at `https://[your-username].github.io/whitehaven-golf`

Players can view Stats and History without logging in. Commish login is password-gated.

### 8. Local development (optional)

Copy `config.example.js` to `config.js` and fill in your values:

```bash
cp config.example.js config.js
# Edit config.js with your real Supabase keys and commish password
```

Then open `index.html` in a browser or use a local server:

```bash
python3 -m http.server 8000
```

---

## How it works

### Tabs

| Tab | Who can see it | What it does |
|---|---|---|
| Round | Commish only | Create/edit the active round; get the RSVP link |
| Teams | Commish only | Check in players, auto-balance teams, import RSVPs |
| Scores | Everyone (commish edits) | Enter scores, mark skins/CTPs, live payout summary |
| Players | Commish only | Manage the roster; edit contact info (email/phone) |
| Stats | Everyone | 2026 Leaderboard + scoring average rankings |
| History | Everyone | All completed rounds; deep-linkable per round |

### RSVP system

- Commish creates a round → shares `rsvp.html?round=<uuid>` with the group
- Players submit their name, email, and phone (contact info is saved and pre-filled on future RSVPs)
- RSVP link automatically closes after midnight the night before the round
- If Resend is configured, each RSVP receives an automated reminder email the day before
- Commish sees all RSVPs in the Teams tab and can import them all as checked-in with one click

### Auto-save

Individual player scores and team shamble scores auto-save to Supabase as they are entered (800ms debounce). Skins, CTPs, and tiebreaker data also save automatically. You can safely close and reopen the app mid-round without losing data.

### Tiebreaker

If two or more teams finish with the same shamble score, a tiebreaker card appears on the Scores tab. Enter each tied team's score on hole 9 — lowest score wins. If still tied, hole 8 appears, then 7, and so on. The resolved winner is shown inline, and the tiebreaker result appears in the round's History card.

### Payout math

```
Buy-in per player   = $12 (all-in)
CTH pool            = $2/player ($1 per par-3 hole — holes 2 & 5)
Main pool           = $10/player

If skins were won:
  Team win pool     = main pool × 75%
  Skin pool         = main pool × 25%
If no skins:
  Team win pool     = main pool × 100%

Per winning player  = team win pool ÷ # winning players
Per skin            = skin pool ÷ # total skins claimed
Per CTP winner      = $1 × total players (from CTH pool, per hole)
```

### Scoring averages

- Each player's average is based on their **last 10 finalized rounds**
- Players with fewer than 10 app rounds have their average **blended** with their historical baseline average (from the spreadsheet at setup) until 10 app rounds are on record
- After 10 app rounds, only in-app scores count
- The leaderboard requires **5+ rounds** to rank a player; fewer than 5 rounds shows a separate "needs 5+ rounds" section

### 2026 Leaderboard (Stats page)

Resets every January 1. Shows podium-style tiles (1st place prominently, 2nd/3rd below) for:

- 🏌️ **Best Round** — lowest individual 9-hole score
- 💰 **Most Winnings** — cumulative payout total
- 🏆 **Most Wins** — rounds where a player was on the winning team
- 🦴 **Most Skins** — total holes won via skins
- 📍 **Most CTPs** — total closest-to-pin wins

The Stats page also shows a callout to the most recently completed round with the winning team and a direct link to the full results in History.

### History deep links

Every round in the History tab has a 🔗 share button. Clicking it copies a URL like:

```
https://yoursite.github.io/whitehaven-golf/?round=<uuid>
```

Opening that URL takes you directly to the History tab with that round expanded.

---

## Project structure

```
/
├── index.html              ← App shell (6 tabs, 2 modals)
├── app.js                  ← All logic (~1600 lines)
├── style.css               ← All styles (Playfair Display / DM Mono / DM Sans)
├── rsvp.html               ← Standalone RSVP page (shareable link)
├── rsvp.js                 ← RSVP page logic
├── config.js               ← Supabase keys — GITIGNORED, injected at build
├── config.example.js       ← Template for local dev
├── README.md
├── scripts/
│   └── send-reminders.js   ← Node script: sends day-before reminder emails
├── supabase/
│   └── schema.sql          ← Tables, RLS policies, seed data
└── .github/
    └── workflows/
        ├── deploy.yml      ← Inject config → deploy gh-pages
        └── reminders.yml   ← Daily cron (6PM UTC) → send-reminders.js
```

## Database schema

| Table | Key columns |
|---|---|
| `players` | name, avg_score, rounds_played, active, email, phone, base_avg, base_rounds |
| `rounds` | date, course, buyin_per_player, cth_per_player, status, team_scores (jsonb), round_state (jsonb) |
| `round_players` | round_id, player_id, team, score, holes_won, cth_winner, cth_count, paid_in, paid_out |
| `round_results` | round_id, player_id, team_winnings, skin_winnings, cth_winnings, total_winnings |
| `rsvps` | round_id, player_id, name, email, phone |

All tables use Row Level Security with public read + write (commish auth is client-side — appropriate for a private friend-group app).
