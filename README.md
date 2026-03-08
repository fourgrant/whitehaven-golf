# ⛳ Whitehaven Golf League

A web app for a casual 9-hole shambles golf league. Tracks teams, scores, skins, CTH bets, payouts, and season superlatives.

**Stack:** Vanilla HTML/JS + Supabase + GitHub Pages

---

## Setup (8 steps)

### 1. Fork / clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/whitehaven-golf.git
cd whitehaven-golf
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project → name it `whitehaven-golf`
2. Once created, go to **Project Settings → API**
3. Copy your **Project URL** and **anon/public** key

### 3. Run the database schema

1. In Supabase, go to the **SQL Editor**
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Click **Run** — this creates all tables, RLS policies, and seeds the player roster

### 4. Add GitHub Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, add three secrets:

| Secret name | Value |
|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJ...` (your anon key) |
| `COMMISH_PASSWORD` | A password only the commish knows |

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

Players can view Stats and History without logging in. The commish uses the password to manage rounds.

### 8. Local development (optional)

Copy `config.example.js` to `config.js` and fill in your values:

```bash
cp config.example.js config.js
# Edit config.js with your real Supabase keys and commish password
```

Then open `index.html` in a browser (or use a local server like `python3 -m http.server 8000`).

---

## How it works

### Commish flow (weekly)

1. **Round tab** — Set date, course, buy-in ($12 default)
2. **Teams tab** — Check in today's players, auto-balance or manually assign teams
3. **Scores tab** — Enter each player's 9-hole stroke total + team's shamble score
4. Select hole winners (skins) and CTP winners (holes 2 & 5)
5. Review payout summary → track Paid In / Paid Out
6. **Finalize Round** → saves everything to Supabase, updates player averages

### Player view (always public)

- **Stats tab** — Season superlatives + leaderboard sorted by scoring average
- **History tab** — All completed rounds with full results

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

- Each player's average is based on their **last 10 finalized rounds**.
- Players with fewer than 10 app rounds have their average **blended** with their historical baseline avg (loaded from the spreadsheet at setup) until 10 app rounds are on record.
- After 10 app rounds, only in-app scores count.
- The leaderboard requires **5+ rounds** to rank a player. Players with fewer than 5 rounds appear in a separate "needs 5+ rounds" section.

### Season superlatives (Stats page)

Resets every January 1. Tracks:
- 🏌️ **Best Round** — lowest individual 9-hole score
- 💰 **Most Winnings** — cumulative payout total
- 🦴 **Most Skins** — total holes won via skins
- 📍 **Most CTPs** — total closest-to-pin wins

---

## Project structure

```
/
├── index.html          ← App shell (7 pages, 2 modals)
├── app.js              ← All logic (~1500 lines)
├── style.css           ← All styles (Playfair + DM Mono + DM Sans)
├── config.js           ← Supabase keys — GITIGNORED, injected at build
├── config.example.js   ← Template for local dev
├── README.md
├── supabase/
│   └── schema.sql      ← Tables, RLS policies, seed data
└── .github/
    └── workflows/
        └── deploy.yml  ← GitHub Actions: inject config → deploy gh-pages
```

## Database schema (summary)

| Table | Key columns |
|---|---|
| `players` | name, avg_score, rounds_played, active, base_avg, base_rounds |
| `rounds` | date, course, buyin_per_player, cth_per_player, status |
| `round_players` | round_id, player_id, team, score, holes_won, cth_winner, cth_count |
| `round_results` | round_id, player_id, team_winnings, skin_winnings, cth_winnings, total_winnings |

All tables use Row Level Security with public read + write (commish auth is client-side — appropriate for a private friend-group app).
