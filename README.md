# ⛳ Whitehaven Golf League

A web app for a casual 9-hole shambles golf league. Tracks teams, scores, skins, CTH bets, and payouts.

**Stack:** Vanilla HTML/JS + Supabase + GitHub Pages
**URL:** `[your-username].github.io/whitehaven-golf`

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
3. Click **Run** — this creates all tables, RLS policies, and seeds the 50 players

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

Share it with your group! Players can view Stats and History without logging in. The commish uses the password to manage rounds.

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

1. **Round tab** — Set date, course, buy-in ($12), CTH bet ($2), team size
2. **Teams tab** — Check in today's players, auto-balance or manually assign teams
3. **Scores tab** — Enter each player's 9-hole stroke total
4. Select hole winners (skins) and CTH winner(s)
5. Review payout summary → track Paid In / Paid Out
6. **Finalize Round** → saves everything to Supabase, updates player averages

### Player view (always public)

- **Stats tab** — Leaderboard sorted by scoring average, click any player for history
- **History tab** — All completed rounds with full results

### Payout math

```
Total pot        = players × buy-in
CTH pool         = players × CTH bet
Team win pool    = total pot × 75%
Skin pool        = total pot × 25%

Per winning player = team win pool / # winning players
Per skin           = skin pool / # skins claimed
Per CTH winner     = CTH pool / # CTH winners
```

---

## Project structure

```
/
├── index.html          ← App shell (5 pages, 2 modals)
├── app.js              ← All logic (~700 lines)
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
