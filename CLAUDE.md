# Whitehaven Golf League — Claude Guide

## Deployment

- After making changes, always commit, push, and deploy without waiting to be asked. Confirm the deployment is live by checking the production URL.
- At the end of any feature change, bug fix, or user-facing tweak, update both the **Commish Guide** (`#page-howto` in `index.html`) and the **Release Notes** (`#page-releases` in `index.html`). Add a new versioned entry at the top of the release notes — newest first — and revise the relevant Step in the guide so the docs stay in sync with the app.

## Debugging

- When debugging image or asset display issues, always check: 
	1) URL encoding (spaces, special chars)
	2) CDN/Vercel caching of 404s
	3) aspect ratio constraints. 
Never assume a fix worked without verifying the live URL.

## External APIs

- When working with external APIs (Qgiv, Mailchimp, Twilio, etc.), always verify the exact request format (form-encoded vs JSON), correct base URLs/subdomains, and required credentials before making the first call.

## Session Start

- When resuming work from a previous session, read recent git log and open TODO/backlog files to understand what's unfinished before asking the user.

## Stack

Vanilla HTML/JS + Supabase JS v2 (CDN) + GitHub Pages. No build step, no framework, no bundler.

## Key Files

- `index.html` — app shell (6 tabs, 2 modals)
- `app.js` — all logic; Supabase integration, all page renders
- `style.css` — design system (Playfair Display / DM Mono / DM Sans)
- `rsvp.html` / `rsvp.js` — standalone RSVP page
- `config.js` — **gitignored**; injected by GitHub Actions from secrets; copy `config.example.js` for local dev
- `supabase/schema.sql` — tables, RLS policies, seed data
- `.github/workflows/deploy.yml` — injects config.js, deploys to `gh-pages` branch
- `.github/workflows/reminders.yml` — daily cron sends reminder emails via `scripts/send-reminders.js`

## Design System

- Colors: `--green: #1a3a2a`, `--gold: #c9a84c`, `--cream: #f5f0e8`
- Fonts: Playfair Display (headings), DM Mono (numbers/labels), DM Sans (body)

## App Architecture

**6 tabs:**
| Tab | Access | Purpose |
|---|---|---|
| Round | Commish | Create/edit active round, get RSVP link |
| Teams | Commish | Check in players, auto-balance teams, import RSVPs |
| Scores | Everyone (commish edits) | Enter scores, mark skins/CTPs, live payout summary |
| Players | Commish | Manage roster, edit contact info |
| Stats | Public | 2026 Leaderboard + scoring average rankings |
| History | Public | All finalized rounds, deep-linkable |

**Auth:** Commish password → `sessionStorage.whg_commish = true`; `body` gets `.is-commish` class.

**State:** Active round ID in `localStorage.whg_round_id`. On load, if no cached id, the app auto-discovers the most recent non-complete round so the active draft is shared across all commish devices. Setup-phase check-ins and team letters auto-save to `round_players` immediately; `saveTeams()` only flips status to `in_progress`. Falls back to `SEED_PLAYERS` (hardcoded) when Supabase is not configured.

## Payout Math ($12 all-in)

```
cthPool      = n × $2  (split: hole 2 / hole 5 @ $1 each)
mainPool     = n × $10
hasSkins  →  skinPool = mainPool × 0.25, teamWinPool = mainPool × 0.75
no skins  →  teamWinPool = mainPool × 1.0
perWin       = teamWinPool / winningPlayerCount
skinValue    = skinPool / totalSkins
```

Team scores are manually entered (not auto-calculated from individual scores).

## Database Schema

| Table | Key columns |
|---|---|
| `players` | name, avg_score, rounds_played, active, email, phone, base_avg, base_rounds |
| `rounds` | date, course, buyin_per_player, cth_per_player, status, team_scores (jsonb), round_state (jsonb) |
| `round_players` | round_id, player_id, team, score, holes_won, cth_winner, cth_count, paid_in, paid_out |
| `round_results` | round_id, player_id, team_winnings, skin_winnings, cth_winnings, total_winnings |
| `rsvps` | round_id, player_id, name, email, phone |

RLS enabled on all tables with public read + write (commish auth is client-side — appropriate for a private friend-group app).

## Workflow

- Always commit and push after making changes.
- Local dev: `cp config.example.js config.js`, then `python3 -m http.server 8000`.
- Deploy: push to `main` — GitHub Actions injects config and deploys automatically.
