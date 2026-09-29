/* ============================================================
   Sheila — Scorecard Upload
   Photograph the paper cards, let Claude read them, review,
   then apply check-ins, teams, scores, and skins in one shot.
   Loaded after app.js; relies on its state, db, and helpers.
   ============================================================ */

const SC_PAR = [5, 3, 4, 5, 3, 4, 4, 4, 4]; // Whitehaven front nine, 36
const SC_MAX_EDGE = 1600;                     // px, longest side sent to the reader
const SC_JPEG_QUALITY = 0.85;

const sc = {
  mode: 'teams',   // 'teams' (build teams from the cards) or 'scores' (teams already locked)
  cards: [],       // analyzed cards, see scAnalyzeCard()
  busy: false,
  skinsOn: true,
  tiebreakOn: true,
};

// ---------- open / close ----------

function scorecardMode() {
  const r = state.currentRound;
  if (!r) return 'teams';
  const hasTeams = state.roundPlayers.some(rp => rp.team);
  return (r.status === 'in_progress' && hasTeams) ? 'scores' : 'teams';
}

function openScorecardModal() {
  if (!state.currentRound) { toast('Set up a round first.'); return; }
  if (state.currentRound.status === 'complete') { toast('This round is already finalized.'); return; }
  sc.mode = scorecardMode();
  sc.cards = [];
  sc.busy = false;

  document.getElementById('sc-subtitle').textContent = sc.mode === 'teams'
    ? 'One photo per card. Each card becomes a team; players are checked in, scored, and locked in.'
    : 'One photo per card. Scores go onto the teams you already locked in.';
  document.getElementById('sc-picker').style.display = '';
  document.getElementById('sc-files').value = '';
  document.getElementById('sc-status').innerHTML = '';
  document.getElementById('sc-review').innerHTML = '';
  document.getElementById('sc-actions').innerHTML = '';

  const demo = new URLSearchParams(location.search).get('demo') === 'scorecards';
  document.getElementById('sc-demo').style.display = demo ? '' : 'none';

  document.getElementById('scorecard-modal').classList.add('open');
}

function closeScorecardModal() {
  if (sc.busy) return;
  document.getElementById('scorecard-modal').classList.remove('open');
}

// ---------- reading ----------

async function scHandleFiles(fileList) {
  const files = [...(fileList || [])].filter(f => f && f.size > 0);
  if (!files.length) return;
  if (!db) { toast('Scorecard reading needs Supabase configured.'); return; }
  if (files.length > TEAMS.length) { toast(`Max ${TEAMS.length} cards at once.`); return; }

  sc.busy = true;
  document.getElementById('sc-picker').style.display = 'none';
  const status = document.getElementById('sc-status');
  const roster = state.players.filter(p => p.active !== false).map(p => p.name);
  const results = new Array(files.length).fill(null);
  const errors  = new Array(files.length).fill(null);
  let done = 0;
  const tick = () => { status.innerHTML = `<div class="sc-progress">Reading card ${Math.min(done + 1, files.length)} of ${files.length}…</div>`; };
  tick();

  await Promise.all(files.map(async (file, i) => {
    try {
      const image = await scResizeImage(file);
      const card  = await scReadCard(image, roster);
      results[i]  = { card, thumb: `data:${image.media_type};base64,${image.data}`, file: file.name };
    } catch (e) {
      console.error('scorecard read failed:', e);
      errors[i] = e.message || String(e);
    } finally {
      done++; tick();
    }
  }));

  sc.busy = false;
  const failed = errors.map((e, i) => e ? `Card ${i + 1}: ${escHtml(e)}` : null).filter(Boolean);
  status.innerHTML = failed.length
    ? `<div class="sc-error">${failed.join('<br>')}</div>`
    : '';

  const ok = results.filter(Boolean);
  if (!ok.length) {
    document.getElementById('sc-picker').style.display = '';
    return;
  }
  sc.cards = ok.map((r, i) => scAnalyzeCard(r.card, i, r.thumb));
  scAssignDefaultLetters();
  scRenderReview();
}

async function scLoadFixture() {
  sc.busy = true;
  document.getElementById('sc-picker').style.display = 'none';
  const status = document.getElementById('sc-status');
  status.innerHTML = '<div class="sc-progress">Loading sample cards…</div>';
  try {
    const res = await fetch('test/scorecard-fixture.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    sc.cards = data.cards.map((c, i) => scAnalyzeCard(c, i, null));
    scAssignDefaultLetters();
    status.innerHTML = '<div class="sc-progress">Sample: the six cards from 9/27/2026 (no photos attached).</div>';
    scRenderReview();
  } catch (e) {
    status.innerHTML = `<div class="sc-error">Couldn't load sample: ${escHtml(e.message)}</div>`;
    document.getElementById('sc-picker').style.display = '';
  } finally {
    sc.busy = false;
  }
}

// Downscale + re-encode as JPEG so uploads stay small (phone photos are 3-5 MB).
async function scResizeImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't decode this image. Use a JPG or PNG, or take the photo from the upload button.");
  }
  const scale = Math.min(1, SC_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', SC_JPEG_QUALITY);
  return { media_type: 'image/jpeg', data: dataUrl.split(',')[1] };
}

async function scReadCard(image, roster) {
  const { data, error } = await db.functions.invoke('read-scorecard', { body: { image, roster } });
  if (error) {
    // supabase-js wraps non-2xx responses; try to surface the function's own message
    let msg = error.message || 'Reader failed';
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (!data?.card?.players) throw new Error('Reader returned no players');
  return data.card;
}

// ---------- analysis ----------

function scNum(v) { return (typeof v === 'number' && Number.isFinite(v)) ? Math.trunc(v) : null; }

function scAnalyzeCard(raw, index, thumb) {
  const rows = (raw.players || []).map((p, pi) => {
    const holes = Array.from({ length: 9 }, (_, h) => scNum(p.holes?.[h]));
    const row = {
      name: String(p.name_as_written || '').trim() || `Row ${pi + 1}`,
      holes,
      totalWritten: scNum(p.total_written),
      confidence: p.confidence || 'medium',
      totalOverride: null,   // set when commish edits the total by hand
      playerId: null, guest: false, skip: false, ambiguous: [],
    };
    scMatchRow(row);
    return row;
  });
  const teamRow = raw.team_row || null;
  let teamWritten = scNum(teamRow?.final_written);
  if (teamWritten === null && Array.isArray(teamRow?.values)) {
    const vals = teamRow.values.map(scNum).filter(v => v !== null);
    teamWritten = vals.length ? vals[vals.length - 1] : null;
  }
  const card = {
    index, thumb, rows, teamWritten,
    letter: null,
    notes: raw.notes || '',
    legibility: raw.legibility || 'fair',
    teamOverride: null,
  };
  scRecompute(card);
  return card;
}

// Roster match: the same tiers as Paste List (exact, first name, last name, first + initial),
// then a loose tier that unions substring hits with one-letter typos (Bent → Benton or Brent P)
// so a loose hit never silently wins when another player is just as plausible.
function scMatchRow(row) {
  row.playerId = null; row.ambiguous = [];
  const token = row.name.toLowerCase().replace(/[^a-z0-9$ ]/g, '').trim();
  if (!token) return;
  const words  = token.split(/\s+/);
  const active = state.players.filter(p => p.active !== false);
  const parts  = p => p.name.toLowerCase().split(/\s+/);
  const tiers = [
    () => active.filter(p => p.name.toLowerCase() === token),
    () => words.length === 1 ? active.filter(p => parts(p)[0] === token) : [],
    () => words.length === 1 ? active.filter(p => parts(p).at(-1) === token) : [],
    () => (words.length === 2 && words[1].length === 1)
      ? active.filter(p => parts(p)[0] === words[0] && parts(p).at(-1).startsWith(words[1])) : [],
    () => {
      const loose = active.filter(p => p.name.toLowerCase().includes(token) || (token.length >= 4 && token.includes(p.name.toLowerCase())));
      const typo  = token.length >= 4 ? active.filter(p => parts(p)[0].length >= 4 && scEditDistance(parts(p)[0], token) === 1) : [];
      return [...new Map([...loose, ...typo].map(p => [p.id, p])).values()];
    },
  ];
  for (const tier of tiers) {
    const hits = tier();
    if (hits.length === 1) { row.playerId = hits[0].id; return; }
    if (hits.length > 1)  { row.ambiguous = hits; return; }
  }
}

function scEditDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function scRowSum(row) {
  return row.holes.every(h => h !== null) ? row.holes.reduce((a, b) => a + b, 0) : null;
}

// Effective 9-hole total for a row: the commish's edit wins, then what was written, then the hole sum.
function scRowTotal(row) {
  if (row.totalOverride !== null) return row.totalOverride;
  if (row.totalWritten !== null) return row.totalWritten;
  return scRowSum(row);
}

function scActiveRows(card) { return card.rows.filter(r => !r.skip); }

// Team shamble score: best N of M balls per hole, relative to par, cumulative.
// Whitehaven plays best 3 of 4 (cards are marked "x3"); best 2 of 3 for three-man teams.
function scRecompute(card) {
  const rows = scActiveRows(card);
  const complete = rows.length > 0 && rows.every(r => r.holes.every(h => h !== null));
  card.bestN = Math.max(1, rows.length - 1);
  card.perHole = null;
  card.teamComputed = null;
  if (complete) {
    let running = 0;
    card.perHole = SC_PAR.map((par, h) => {
      const best = rows.map(r => r.holes[h]).sort((a, b) => a - b).slice(0, card.bestN);
      const rel  = best.reduce((a, b) => a + b, 0) - par * card.bestN;
      running += rel;
      return rel;
    });
    card.teamComputed = running;
  }
  card.teamScore = card.teamOverride !== null ? card.teamOverride
    : (card.teamComputed !== null ? card.teamComputed : card.teamWritten);
}

function scAssignDefaultLetters() {
  if (sc.mode === 'scores') {
    // Map each card to the team most of its matched players already sit on.
    const rpByPlayer = Object.fromEntries(state.roundPlayers.map(rp => [rp.player_id, rp]));
    sc.cards.forEach(card => {
      const tally = {};
      card.rows.forEach(r => {
        const t = r.playerId && rpByPlayer[r.playerId]?.team;
        if (t) tally[t] = (tally[t] || 0) + 1;
      });
      const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      card.letter = best ? best[0] : null;
      card.split  = Object.keys(tally).length > 1;
    });
  } else {
    const used = new Set();
    sc.cards.forEach(card => {
      const letter = TEAMS.find(t => !used.has(t)) || null;
      if (letter) used.add(letter);
      card.letter = letter;
    });
  }
}

// Skins: lowest score on a hole, only when exactly one player has it.
function scSuggestSkins() {
  const out = [];
  for (let h = 0; h < 9; h++) {
    let min = Infinity, holders = [];
    sc.cards.forEach(card => scActiveRows(card).forEach(row => {
      const s = row.holes[h];
      if (s === null) return;
      if (s < min) { min = s; holders = [{ card, row }]; }
      else if (s === min) holders.push({ card, row });
    }));
    if (holders.length === 1 && holders[0].row.playerId) out.push({ hole: h + 1, score: min, ...holders[0] });
  }
  return out;
}

// ---------- review UI ----------

function scPlayerOptions(row) {
  const active   = state.players.filter(p => p.active !== false);
  const inactive = state.players.filter(p => p.active === false);
  const opt = p => `<option value="${escHtml(p.id)}" ${row.playerId === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`;
  const top = row.ambiguous.length
    ? `<optgroup label="Could be">${row.ambiguous.map(opt).join('')}</optgroup>` : '';
  return `
    <option value="">— Pick player</option>
    ${top}
    <option value="__guest" ${row.guest ? 'selected' : ''}>＋ Add “${escHtml(row.name)}” as guest</option>
    <option value="__skip"  ${row.skip  ? 'selected' : ''}>Skip this row</option>
    <optgroup label="Roster">${active.map(opt).join('')}</optgroup>
    ${inactive.length ? `<optgroup label="Inactive">${inactive.map(opt).join('')}</optgroup>` : ''}
  `;
}

function scFmtRel(n) { return n === null || n === undefined ? '—' : (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`); }

function scRenderReview() {
  const el = document.getElementById('sc-review');
  const dupes = scDuplicatePlayerIds();
  const letterOptions = card => TEAMS.map(t => `<option value="${t}" ${card.letter === t ? 'selected' : ''}>Team ${t}</option>`).join('');

  el.innerHTML = sc.cards.map((card, ci) => {
    const rowsHtml = card.rows.map((row, pi) => {
      const sum   = scRowSum(row);
      const total = scRowTotal(row);
      const flags = [];
      if (!row.skip) {
        if (row.playerId && dupes.has(row.playerId)) flags.push('<span class="sc-flag sc-flag-bad">Duplicate player</span>');
        if (!row.playerId && !row.guest) flags.push(`<span class="sc-flag sc-flag-bad">${row.ambiguous.length ? 'Which one?' : 'Not on roster'}</span>`);
        if (sum !== null && row.totalWritten !== null && sum !== row.totalWritten && row.totalOverride === null) {
          flags.push(`<span class="sc-flag sc-flag-warn">Holes add to ${sum}, card says ${row.totalWritten} <button class="sc-link" onclick="scUseSum(${ci},${pi})">use ${sum}</button></span>`);
        }
        if (sum === null) flags.push('<span class="sc-flag sc-flag-warn">Missing hole</span>');
        if (row.confidence === 'low') flags.push('<span class="sc-flag sc-flag-warn">Low confidence</span>');
      }
      return `
        <tr class="${row.skip ? 'sc-row-skip' : ''}">
          <td class="sc-name" title="${escHtml(row.name)}">${escHtml(row.name)}</td>
          <td class="sc-player"><select onchange="scSetName(${ci},${pi},this.value)">${scPlayerOptions(row)}</select></td>
          ${row.holes.map((h, hi) => `<td><input type="number" inputmode="numeric" class="sc-hole ${h === null ? 'sc-hole-missing' : ''}" value="${h === null ? '' : h}" oninput="scSetHole(${ci},${pi},${hi},this.value)"></td>`).join('')}
          <td><input type="number" inputmode="numeric" class="sc-total" value="${total === null ? '' : total}" oninput="scSetTotal(${ci},${pi},this.value)"></td>
          <td class="sc-flags">${flags.join(' ')}</td>
        </tr>`;
    }).join('');

    const teamBits = [];
    if (card.teamComputed !== null) {
      teamBits.push(`<strong>${scFmtRel(card.teamScore)}</strong> <span class="sc-muted">best ${card.bestN} of ${scActiveRows(card).length}, computed from the holes</span>`);
      if (card.teamWritten !== null && card.teamWritten !== card.teamComputed && card.teamOverride === null) {
        teamBits.push(`<span class="sc-flag sc-flag-warn">Card's running row ends at ${scFmtRel(card.teamWritten)} <button class="sc-link" onclick="scUseWrittenTeam(${ci})">use ${scFmtRel(card.teamWritten)}</button></span>`);
      } else if (card.teamWritten !== null && card.teamOverride === null) {
        teamBits.push('<span class="sc-flag sc-flag-ok">matches the card</span>');
      }
    } else {
      teamBits.push(`<strong>${scFmtRel(card.teamScore)}</strong> <span class="sc-muted">from the card's running row (fill every hole to compute)</span>`);
    }

    return `
      <div class="sc-card">
        <div class="sc-card-head">
          ${card.thumb ? `<img class="sc-thumb" src="${card.thumb}" alt="Card ${ci + 1}" onclick="scZoom(${ci})">` : '<div class="sc-thumb sc-thumb-empty">no photo</div>'}
          <div class="sc-card-meta">
            <div class="sc-card-title">Card ${ci + 1}
              <select class="sc-letter" onchange="scSetLetter(${ci},this.value)"><option value="">— Team</option>${letterOptions(card)}</select>
              ${card.split ? '<span class="sc-flag sc-flag-warn">Players are on different teams</span>' : ''}
            </div>
            <div class="sc-team-score">Team score: ${teamBits.join(' ')}
              <input type="number" class="sc-total sc-team-input" value="${card.teamScore === null ? '' : card.teamScore}" oninput="scSetTeamScore(${ci},this.value)" title="Team score relative to par">
            </div>
            ${card.notes ? `<div class="sc-muted sc-notes">Reader note: ${escHtml(card.notes)}</div>` : ''}
          </div>
        </div>
        <div class="sc-table-wrap">
          <table class="sc-table">
            <thead><tr><th>On card</th><th>Player</th>${SC_PAR.map((p, i) => `<th>${i + 1}<span class="sc-par">${p}</span></th>`).join('')}<th>Out</th><th></th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  // Skins + summary + actions
  const skins = scSuggestSkins();
  const teamsReady = sc.cards.filter(c => c.letter && c.teamScore !== null);
  const sorted = [...teamsReady].sort((a, b) => a.teamScore - b.teamScore);
  const leader = sorted[0];
  const tied = leader ? sorted.filter(c => c.teamScore === leader.teamScore) : [];

  el.innerHTML += `
    <div class="sc-card sc-summary">
      <div class="sc-card-title">Skins from the hole scores</div>
      ${skins.length
        ? `<ul class="sc-skins">${skins.map(s => `<li>Hole ${s.hole}: <strong>${escHtml(scRowLabel(s.row))}</strong> (${s.score}, Team ${s.card.letter || '?'})</li>`).join('')}</ul>`
        : '<div class="sc-muted">No outright hole winners yet (ties or missing holes).</div>'}
      <label class="sc-check"><input type="checkbox" ${sc.skinsOn ? 'checked' : ''} onchange="sc.skinsOn=this.checked"> Mark these skins on the Scores tab</label>
      <label class="sc-check"><input type="checkbox" ${sc.tiebreakOn ? 'checked' : ''} onchange="sc.tiebreakOn=this.checked"> Fill the tiebreaker from per-hole team scores</label>
      ${leader ? `<div class="sc-muted" style="margin-top:8px;">${tied.length > 1 ? `Tied for the lead at ${scFmtRel(leader.teamScore)}: ${tied.map(c => 'Team ' + c.letter).join(', ')}` : `Leader: Team ${leader.letter} at ${scFmtRel(leader.teamScore)}`}</div>` : ''}
    </div>`;

  const problems = scProblems();
  document.getElementById('sc-actions').innerHTML = `
    ${problems.length ? `<div class="sc-error" style="width:100%;">${problems.map(escHtml).join('<br>')}</div>` : ''}
    <button class="btn btn-outline btn-sm" onclick="scStartOver()">Start over</button>
    <button class="btn btn-gold" ${problems.length ? 'disabled' : ''} onclick="scApply()">${sc.mode === 'teams' ? 'Check in, build teams & enter scores' : 'Enter scores'} →</button>
  `;
}

function scRowLabel(row) {
  if (row.playerId) return state.players.find(p => p.id === row.playerId)?.name || row.name;
  return row.name;
}

function scDuplicatePlayerIds() {
  const seen = new Map();
  sc.cards.forEach(c => scActiveRows(c).forEach(r => { if (r.playerId) seen.set(r.playerId, (seen.get(r.playerId) || 0) + 1); }));
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

function scProblems() {
  const out = [];
  const dupes = scDuplicatePlayerIds();
  if (dupes.size) out.push('The same player appears on more than one row.');
  sc.cards.forEach((c, ci) => {
    if (!c.letter) out.push(`Card ${ci + 1}: pick a team letter.`);
    if (scActiveRows(c).some(r => !r.playerId && !r.guest)) out.push(`Card ${ci + 1}: every row needs a player, a guest, or Skip.`);
    if (scActiveRows(c).some(r => scRowTotal(r) === null)) out.push(`Card ${ci + 1}: every player needs a 9-hole total.`);
    if (c.teamScore === null) out.push(`Card ${ci + 1}: needs a team score.`);
  });
  const letters = sc.cards.map(c => c.letter).filter(Boolean);
  if (new Set(letters).size !== letters.length) out.push('Two cards are assigned the same team letter.');
  return out;
}

function scStartOver() {
  if (sc.busy) return;
  openScorecardModal();
}

function scZoom(ci) {
  const card = sc.cards[ci];
  if (!card?.thumb) return;
  const w = window.open('', '_blank');
  if (w) { w.document.write(`<title>Card ${ci + 1}</title><body style="margin:0;background:#111"><img src="${card.thumb}" style="max-width:100%;display:block;margin:0 auto"></body>`); w.document.close(); }
}

// ---------- edits ----------

function scSetName(ci, pi, value) {
  const row = sc.cards[ci].rows[pi];
  row.guest = false; row.skip = false; row.playerId = null;
  if (value === '__guest') row.guest = true;
  else if (value === '__skip') row.skip = true;
  else if (value) row.playerId = value;
  scRecompute(sc.cards[ci]);
  if (sc.mode === 'scores') scAssignDefaultLetters();
  scRenderReview();
}

function scSetHole(ci, pi, hi, value) {
  const row = sc.cards[ci].rows[pi];
  const n = parseInt(value, 10);
  row.holes[hi] = Number.isFinite(n) ? n : null;
  scRecompute(sc.cards[ci]);
  scRenderReviewPreserving();
}

function scSetTotal(ci, pi, value) {
  const row = sc.cards[ci].rows[pi];
  const n = parseInt(value, 10);
  row.totalOverride = Number.isFinite(n) ? n : null;
  scRenderReviewPreserving();
}

function scUseSum(ci, pi) {
  const row = sc.cards[ci].rows[pi];
  row.totalOverride = scRowSum(row);
  scRenderReview();
}

function scUseWrittenTeam(ci) {
  const card = sc.cards[ci];
  card.teamOverride = card.teamWritten;
  scRecompute(card);
  scRenderReview();
}

function scSetTeamScore(ci, value) {
  const card = sc.cards[ci];
  const n = parseInt(value, 10);
  card.teamOverride = Number.isFinite(n) ? n : null;
  scRecompute(card);
  scRenderReviewPreserving();
}

function scSetLetter(ci, value) {
  sc.cards[ci].letter = value || null;
  scRenderReview();
}

// Re-render without yanking focus from the input being typed in.
function scRenderReviewPreserving() {
  const active = document.activeElement;
  const table  = active?.closest?.('.sc-table-wrap') || active?.closest?.('.sc-card');
  if (!active || !table) { scRenderReview(); return; }
  const inputs = [...document.querySelectorAll('#sc-review input')];
  const idx = inputs.indexOf(active);
  const pos = active.selectionStart;
  scRenderReview();
  const next = document.querySelectorAll('#sc-review input')[idx];
  if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch { /* number inputs */ } }
}

// ---------- apply ----------

async function scApply() {
  if (sc.busy) return;
  if (scProblems().length) { scRenderReview(); return; }
  if (!state.currentRound) { toast('No active round.'); return; }
  sc.busy = true;
  const actions = document.getElementById('sc-actions');
  actions.innerHTML = '<div class="sc-progress">Applying…</div>';

  try {
    // 1. Guests → real player rows (their score today seeds the average).
    for (const card of sc.cards) {
      for (const row of scActiveRows(card)) {
        if (!row.guest) continue;
        const total = scRowTotal(row);
        const guest = await scCreateGuest(row.name, total);
        row.playerId = guest.id; row.guest = false;
      }
    }

    // 2. Teams mode: check everyone in with their card's letter and lock in.
    if (sc.mode === 'teams') {
      for (const card of sc.cards) {
        for (const row of scActiveRows(card)) {
          state.checkedIn.add(row.playerId);
          state.teamAssignments[row.playerId] = card.letter;
        }
      }
      if (db) {
        await persistTeamAssignmentsBulk();
        const { error } = await db.from('rounds').update({ status: 'in_progress' }).eq('id', state.currentRound.id);
        if (error) throw new Error(error.message);
        state.currentRound.status = 'in_progress';
        await loadRoundPlayers();
      } else {
        state.roundPlayers = [...state.checkedIn].map(pid => {
          const p = state.players.find(x => x.id === pid) || { id: pid, name: pid, avg_score: 40 };
          return { id: 'rp-' + pid, round_id: state.currentRound.id, player_id: pid, team: state.teamAssignments[pid] || null,
                   score: null, holes_won: 0, cth_winner: false, paid_in: false, paid_out: false, players: p };
        });
        state.currentRound.status = 'in_progress';
      }
    } else if (db) {
      // Scores mode: anyone on a card who isn't in the round yet joins their card's team.
      const inRound = new Set(state.roundPlayers.map(rp => rp.player_id));
      const additions = [];
      sc.cards.forEach(card => scActiveRows(card).forEach(row => {
        if (!inRound.has(row.playerId)) additions.push({ round_id: state.currentRound.id, player_id: row.playerId, team: card.letter });
      }));
      if (additions.length) {
        const { error } = await db.from('round_players').upsert(additions, { onConflict: 'round_id,player_id' });
        if (error) throw new Error(error.message);
      }
      await loadRoundPlayers();
    }

    // 3. Scores, hole scores, team scores, skins, tiebreaker.
    const rpByPlayer = Object.fromEntries(state.roundPlayers.map(rp => [rp.player_id, rp]));
    const holeScores = { ...(state.holeScores || {}) };
    const skins = sc.skinsOn ? scSuggestSkins() : [];

    for (const card of sc.cards) {
      for (const row of scActiveRows(card)) {
        const rp = rpByPlayer[row.playerId];
        if (!rp) continue;
        const total = scRowTotal(row);
        state.scores[rp.id] = total;
        if (row.holes.every(h => h !== null)) holeScores[rp.id] = [...row.holes];
        if (db) {
          const { error } = await db.from('round_players').update({ score: total }).eq('id', rp.id);
          if (error) throw new Error(error.message);
        }
      }
      state.teamScores[card.letter] = card.teamScore;
      if (sc.tiebreakOn && card.perHole) {
        state.tiebreakerScores[card.letter] = Object.fromEntries(card.perHole.map((v, i) => [i + 1, v]));
      }
    }
    localStorage.setItem('whg_team_scores', JSON.stringify(state.teamScores));

    if (sc.skinsOn) {
      skins.forEach(s => {
        const rp = rpByPlayer[s.row.playerId];
        if (rp) state.holeWinners[s.hole] = rp.id;
      });
    }
    state.holeScores = holeScores;

    if (db) {
      const { error } = await db.from('rounds').update({
        team_scores: state.teamScores,
        round_state: {
          holeWinners: state.holeWinners,
          cthWinners: state.cthWinners,
          tiebreakerScores: state.tiebreakerScores,
          teamNarratives: state.teamNarratives,
          holeScores: state.holeScores,
        },
      }).eq('id', state.currentRound.id);
      if (error) throw new Error(error.message);
    }

    const nPlayers = sc.cards.reduce((n, c) => n + scActiveRows(c).length, 0);
    sc.busy = false;
    closeScorecardModal();
    toast(`${nPlayers} scores entered across ${sc.cards.length} teams${skins.length ? `, ${skins.length} skins marked` : ''}.`);
    showPage('scores');
  } catch (e) {
    console.error('scorecard apply failed:', e);
    sc.busy = false;
    actions.innerHTML = `<div class="sc-error" style="width:100%;">Apply failed: ${escHtml(e.message || String(e))}</div>
      <button class="btn btn-gold" onclick="scApply()">Try again</button>`;
  }
}

async function scCreateGuest(name, todayScore) {
  const avg = todayScore ?? 40;
  if (!db) {
    const guest = { id: 'guest-' + Date.now() + Math.random().toString(36).slice(2, 6), name, avg_score: avg, rounds_played: 0 };
    state.players.push(guest);
    return guest;
  }
  const { data, error } = await db.from('players').insert({ name, avg_score: avg, rounds_played: 0 }).select().single();
  if (error) throw new Error(`Couldn't add guest ${name}: ${error.message}`);
  state.players.push(data);
  state.players.sort((a, b) => (a.avg_score || 99) - (b.avg_score || 99));
  return data;
}
