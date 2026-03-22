/* ============================================================
   Whitehaven Golf League — App Logic
   Stack: Vanilla JS + Supabase
   ============================================================ */

// ===== SUPABASE INIT =====
let db;
try {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase not configured — running in local mode');
  db = null;
}

// ===== CONSTANTS =====
const TEAMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const TEAM_COLORS = {
  A: '#2d5a40', B: '#4a3a70', C: '#704a30',
  D: '#30607a', E: '#6a4a20', F: '#3a6a50', G: '#6a3a50'
};

// ===== APP STATE =====
const state = {
  isCommish: false,
  players: [],            // loaded from DB (or seed)
  currentRoundId: localStorage.getItem('whg_round_id') || null,
  currentRound: null,     // full round object
  roundPlayers: [],       // round_players joined with players
  historyRounds: [],      // cache for history page
  // Local UI state (pending saves)
  checkedIn: new Set(),   // player IDs checked in
  teamAssignments: {},    // playerId -> team letter
  scores: {},             // rpId -> score int
  teamScores: JSON.parse(localStorage.getItem('whg_team_scores') || '{}'), // team -> manual score
  holeWinners: {},        // hole# (1-9) -> rpId
  cthWinners: { hole2: null, hole5: null }, // rpId per CTH hole
  tiebreakerScores: {},   // team -> hole# -> score
  paidIn: new Set(),
  paidOut: new Set(),
};

// ===== AUTO-SAVE HELPERS =====
const _debounceTimers = {};
function debounce(key, fn, ms = 800) {
  clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(fn, ms);
}

function showSavingStatus() {
  const el = document.getElementById('autosave-status');
  if (el) { el.textContent = 'Saving…'; el.style.display = ''; }
}

function showSavedStatus() {
  const el = document.getElementById('autosave-status');
  if (el) {
    el.textContent = 'Saved ✓';
    clearTimeout(_debounceTimers['savedHide']);
    _debounceTimers['savedHide'] = setTimeout(() => { el.style.display = 'none'; }, 2000);
  }
}

function saveRoundState() {
  if (!db || !state.currentRound) return;
  const roundState = {
    holeWinners: state.holeWinners,
    cthWinners: state.cthWinners,
    tiebreakerScores: state.tiebreakerScores,
  };
  showSavingStatus();
  debounce('roundState', async () => {
    await db.from('rounds').update({ round_state: roundState }).eq('id', state.currentRound.id);
    showSavedStatus();
  });
}

// ===== SEED DATA (fallback when Supabase not configured) =====
const SEED_PLAYERS = [
  {id:'local-0',  name:'Burton',         avg_score:34.0,  rounds_played:1},
  {id:'local-1',  name:'Jon Murdock',    avg_score:34.2,  rounds_played:10},
  {id:'local-2',  name:'Randy K.',       avg_score:35.1,  rounds_played:24},
  {id:'local-3',  name:'Corey',          avg_score:35.5,  rounds_played:4},
  {id:'local-4',  name:'Terry W.',       avg_score:36.5,  rounds_played:8},
  {id:'local-5',  name:'Terrence (T$)',  avg_score:36.8,  rounds_played:37},
  {id:'local-6',  name:'Larry',          avg_score:37.5,  rounds_played:13},
  {id:'local-7',  name:'William W.',     avg_score:37.7,  rounds_played:11},
  {id:'local-8',  name:'Jay Sheffield',  avg_score:37.75, rounds_played:8},
  {id:'local-9',  name:'Justin G',       avg_score:37.89, rounds_played:9},
  {id:'local-10', name:'Dick',           avg_score:38.1,  rounds_played:31},
  {id:'local-11', name:'Nathan',         avg_score:38.1,  rounds_played:49},
  {id:'local-12', name:'Andy',           avg_score:38.25, rounds_played:8},
  {id:'local-13', name:'Ben M.',         avg_score:38.33, rounds_played:3},
  {id:'local-14', name:'Robin',          avg_score:38.4,  rounds_played:40},
  {id:'local-15', name:'Justin D',       avg_score:38.43, rounds_played:7},
  {id:'local-16', name:'Billie W.',      avg_score:38.5,  rounds_played:13},
  {id:'local-17', name:'Lee',            avg_score:38.8,  rounds_played:36},
  {id:'local-18', name:'Rich P',         avg_score:38.9,  rounds_played:29},
  {id:'local-19', name:'Stuart',         avg_score:38.9,  rounds_played:14},
  {id:'local-20', name:'Matt W',         avg_score:39.0,  rounds_played:5},
  {id:'local-21', name:'Zac',            avg_score:39.2,  rounds_played:41},
  {id:'local-22', name:'Chris Lareau',   avg_score:39.33, rounds_played:3},
  {id:'local-23', name:'Spencer T',      avg_score:39.33, rounds_played:3},
  {id:'local-24', name:'Trey',           avg_score:39.33, rounds_played:3},
  {id:'local-25', name:'Arthur',         avg_score:39.4,  rounds_played:32},
  {id:'local-26', name:'Benton',         avg_score:39.5,  rounds_played:52},
  {id:'local-27', name:'Bill S.',        avg_score:39.6,  rounds_played:46},
  {id:'local-28', name:'Harry O',        avg_score:39.8,  rounds_played:28},
  {id:'local-29', name:'Joe Jones',      avg_score:40.1,  rounds_played:39},
  {id:'local-30', name:'Webb Playford',  avg_score:40.33, rounds_played:9},
  {id:'local-31', name:'David T.',       avg_score:40.6,  rounds_played:5},
  {id:'local-32', name:'Will Goodwin',   avg_score:40.7,  rounds_played:47},
  {id:'local-33', name:'Cary',           avg_score:40.8,  rounds_played:25},
  {id:'local-34', name:'Ricky',          avg_score:40.86, rounds_played:7},
  {id:'local-35', name:'Ben H.',         avg_score:41.0,  rounds_played:1},
  {id:'local-36', name:'Robby',          avg_score:41.1,  rounds_played:42},
  {id:'local-37', name:'John G.',        avg_score:41.33, rounds_played:3},
  {id:'local-38', name:'Brent P',        avg_score:41.5,  rounds_played:2},
  {id:'local-39', name:'JC Youngblood',  avg_score:41.5,  rounds_played:2},
  {id:'local-40', name:'Bryan H.',       avg_score:41.6,  rounds_played:43},
  {id:'local-41', name:'Joe Boone',      avg_score:41.6,  rounds_played:5},
  {id:'local-42', name:'Iain',           avg_score:41.9,  rounds_played:25},
  {id:'local-43', name:'Latty',          avg_score:42.0,  rounds_played:5},
  {id:'local-44', name:'John Markham',   avg_score:42.1,  rounds_played:46},
  {id:'local-45', name:'Hugh',           avg_score:42.3,  rounds_played:14},
  {id:'local-46', name:'Chip',           avg_score:43.2,  rounds_played:12},
  {id:'local-47', name:'Whitten S.',     avg_score:43.33, rounds_played:3},
  {id:'local-48', name:'Colin',          avg_score:44.0,  rounds_played:1},
  {id:'local-49', name:'Sam G.',         avg_score:44.0,  rounds_played:7},
];

// ===== DEEP LINK =====
let _pendingRoundOpen = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  await loadPlayers();
  if (state.currentRoundId) await loadCurrentRound();
  renderNav();

  // Resolve target page from URL:
  //  - /?p=<slug>       → redirected here by 404.html (direct navigation to /round, /guide, etc.)
  //  - /round, /guide   → pathname slug (when replaceState put it there and user refreshes)
  //  - /?round=<uuid>   → legacy deep link; also emitted by 404.html for /history?round=<uuid>
  const params    = new URLSearchParams(window.location.search);
  const deepRound = params.get('round');
  const pSlug     = params.get('p') || window.location.pathname.replace(/^\//, '').split('/')[0];
  const pageFromSlug = SLUG_PAGES[pSlug];

  if (deepRound) {
    _pendingRoundOpen = deepRound;
    showPage('history');
    return;
  }

  if (pageFromSlug) {
    showPage(pageFromSlug);
    return;
  }

  // Default page
  if (state.isCommish && state.currentRound && state.currentRound.status !== 'complete') {
    showPage(state.currentRound.status === 'in_progress' ? 'scores' : 'round');
  } else {
    showPage('stats');
  }
  // Attach round form listeners
  ['round-buyin', 'round-cth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCalc);
  });
});

// ===== AUTH =====
function initAuth() {
  state.isCommish = sessionStorage.getItem('whg_commish') === 'true';
  if (state.isCommish) document.body.classList.add('is-commish');
}

function showCommishLogin() {
  const modal = document.getElementById('commish-modal');
  modal.classList.add('open');
  document.getElementById('commish-error').textContent = '';
  document.getElementById('commish-pw').value = '';
  setTimeout(() => document.getElementById('commish-pw').focus(), 150);
}

function closeCommishModal() {
  document.getElementById('commish-modal').classList.remove('open');
}

function submitCommishPassword() {
  const entered = document.getElementById('commish-pw').value;
  let correctPw;
  try { correctPw = COMMISH_PASSWORD; } catch(e) { correctPw = null; }

  if (!correctPw) {
    // No config — warn but let through (dev mode)
    document.getElementById('commish-error').textContent = 'config.js not loaded — running in dev mode';
    grantCommishAccess();
    return;
  }
  if (entered === correctPw) {
    closeCommishModal();
    grantCommishAccess();
  } else {
    document.getElementById('commish-error').textContent = 'Incorrect password';
    document.getElementById('commish-pw').value = '';
    document.getElementById('commish-pw').focus();
  }
}

function grantCommishAccess() {
  sessionStorage.setItem('whg_commish', 'true');
  state.isCommish = true;
  document.body.classList.add('is-commish');
  renderNav();
  toast('Welcome, Commissioner! ⛳');
  if (state.currentRound && state.currentRound.status !== 'complete') {
    showPage(state.currentRound.status === 'in_progress' ? 'scores' : 'round');
  } else {
    showPage('round');
  }
}

function logoutCommish() {
  sessionStorage.removeItem('whg_commish');
  state.isCommish = false;
  document.body.classList.remove('is-commish');
  renderNav();
  showPage('stats');
  toast('Signed out.');
}

// ===== NAV =====
function renderNav() {
  const authBtn = document.getElementById('auth-btn');
  if (state.isCommish) {
    authBtn.textContent = 'Sign Out';
    authBtn.onclick = logoutCommish;
  } else {
    authBtn.textContent = 'Commish Login';
    authBtn.onclick = showCommishLogin;
  }
}

// Maps internal page ids → URL slugs (and back)
const PAGE_SLUGS = { round:'round', teams:'teams', scores:'scores', players:'players', stats:'stats', history:'history', howto:'guide' };
const SLUG_PAGES = Object.fromEntries(Object.entries(PAGE_SLUGS).map(([k,v]) => [v,k]));

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('nav [data-page]').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const btn = document.querySelector(`nav [data-page="${id}"]`);
  if (btn) btn.classList.add('active');

  // Update the browser URL to the clean slug (e.g. /guide, /round)
  const slug = PAGE_SLUGS[id] || id;
  history.replaceState({}, '', '/' + slug);

  if (id === 'round')   renderRoundPage();
  if (id === 'teams')   renderTeamsPage();
  if (id === 'scores')  renderScoresPage();
  if (id === 'stats')   renderStats();
  if (id === 'history') renderHistory();
  if (id === 'players') renderPlayersAdmin();
  // 'howto' page is static HTML — no render needed
}

// ===== DATA LOADING =====
async function loadPlayers() {
  if (!db) { state.players = SEED_PLAYERS; return; }
  const { data, error } = await db.from('players').select('*').order('avg_score', { ascending: true });
  if (error) {
    console.error('loadPlayers:', error);
    state.players = SEED_PLAYERS;
    return;
  }
  state.players = data || SEED_PLAYERS;
}

async function loadCurrentRound() {
  if (!db || !state.currentRoundId) return;
  const { data, error } = await db.from('rounds').select('*').eq('id', state.currentRoundId).single();
  if (error || !data) {
    state.currentRoundId = null;
    state.currentRound = null;
    localStorage.removeItem('whg_round_id');
    return;
  }
  state.currentRound = data;

  // Restore draft state from DB
  if (data.round_state) {
    state.holeWinners      = data.round_state.holeWinners      || {};
    state.cthWinners       = data.round_state.cthWinners       || { hole2: null, hole5: null };
    state.tiebreakerScores = data.round_state.tiebreakerScores || {};
  }
  // Sync team scores from DB (source of truth over localStorage)
  if (data.team_scores && Object.keys(data.team_scores).length) {
    state.teamScores = data.team_scores;
    localStorage.setItem('whg_team_scores', JSON.stringify(state.teamScores));
  }

  if (data.status !== 'complete') await loadRoundPlayers();
}

async function loadRoundPlayers() {
  if (!db || !state.currentRoundId) return;
  const { data, error } = await db
    .from('round_players')
    .select('*, players(*)')
    .eq('round_id', state.currentRoundId);
  if (error) { console.error('loadRoundPlayers:', error); return; }

  state.roundPlayers = data || [];

  // Sync local state from DB
  state.checkedIn = new Set(state.roundPlayers.map(rp => rp.player_id));
  state.teamAssignments = {};
  state.scores = {};
  state.cthWinners = { hole2: null, hole5: null }; // can't reconstruct per-hole from DB
  state.paidIn = new Set();
  state.paidOut = new Set();

  state.roundPlayers.forEach(rp => {
    state.teamAssignments[rp.player_id] = rp.team || '';
    if (rp.score)   state.scores[rp.id] = rp.score;
    if (rp.paid_in) state.paidIn.add(rp.id);
    if (rp.paid_out) state.paidOut.add(rp.id);
  });
}

// ===== ROUND SETUP PAGE =====
function renderRoundPage() {
  const today = new Date().toISOString().split('T')[0];
  const r = state.currentRound;

  const sel = document.getElementById('round-commish');
  sel.innerHTML = '<option value="">— Select commish</option>' +
    [...state.players]
      .filter(p => p.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => `<option value="${p.id}">${p.name}</option>`)
      .join('');

  if (r && r.status !== 'complete') {
    document.getElementById('round-date').value     = r.date || today;
    document.getElementById('round-course').value   = r.course || 'Whitehaven';
    document.getElementById('round-buyin').value    = r.buyin_per_player ?? 12;
    sel.value = r.lead_commish_id || '';
    document.getElementById('round-badge-text').textContent = `Editing: ${r.date} at ${r.course}`;
    document.getElementById('round-active-badge').style.display = 'block';
    document.getElementById('clear-round-btn').style.display = '';
    showRsvpLink(r.id);
  } else {
    document.getElementById('round-date').value     = today;
    document.getElementById('round-course').value   = 'Whitehaven';
    document.getElementById('round-buyin').value    = 12;
    sel.value = '';
    document.getElementById('round-active-badge').style.display = 'none';
    document.getElementById('clear-round-btn').style.display = 'none';
  }
  updateCalc();
}

function updateCalc() {
  const n     = state.roundPlayers.length;
  const buyin = parseFloat(document.getElementById('round-buyin')?.value) || 0;
  const total     = n * buyin;
  const mainPool  = n * (buyin - 2);   // after $2/player CTH
  const teamWin   = mainPool * 0.75;   // 75% of main pool (assumes skins)
  const $id = id => document.getElementById(id);
  if ($id('calc-players'))  $id('calc-players').textContent  = n;
  if ($id('calc-pot'))      $id('calc-pot').textContent      = '$' + total.toFixed(0);
  if ($id('calc-team-win')) $id('calc-team-win').textContent = '$' + teamWin.toFixed(0);
}

async function saveRound() {
  const roundData = {
    date:             document.getElementById('round-date').value,
    course:           document.getElementById('round-course').value || 'Whitehaven',
    buyin_per_player: parseFloat(document.getElementById('round-buyin').value) || 12,
    cth_per_player:   2,
    status:           'setup',
    lead_commish_id:  document.getElementById('round-commish').value || null,
  };

  if (!roundData.date) { toast('Please select a date.'); return; }

  if (!db) {
    // Local mode
    state.currentRound = { id: 'local-round', ...roundData };
    toast('Round saved (local mode)! Assign players to teams.');
    showPage('teams');
    return;
  }

  let result;
  if (state.currentRound && state.currentRound.status !== 'complete') {
    result = await db.from('rounds').update(roundData).eq('id', state.currentRound.id).select().single();
  } else {
    result = await db.from('rounds').insert(roundData).select().single();
  }

  if (result.error) { toast('Error: ' + result.error.message); return; }

  state.currentRound  = result.data;
  state.currentRoundId = result.data.id;
  localStorage.setItem('whg_round_id', result.data.id);
  showRsvpLink(result.data.id);
  toast('Round saved! Assign players to teams.');
  showPage('teams');
}

function clearActiveRound() {
  if (!confirm('Clear the active round? This won\'t delete any completed data.')) return;
  state.currentRound    = null;
  state.currentRoundId  = null;
  state.roundPlayers    = [];
  state.checkedIn       = new Set();
  state.teamAssignments = {};
  state.scores          = {};
  state.teamScores      = {};
  state.holeWinners     = {};
  state.cthWinners      = { hole2: null, hole5: null };
  state.paidIn          = new Set();
  state.paidOut         = new Set();
  localStorage.removeItem('whg_round_id');
  localStorage.removeItem('whg_team_scores');
  renderRoundPage();
  toast('Active round cleared.');
}

// ===== TEAMS PAGE =====
async function renderTeamsPage() {
  if (!state.currentRound || state.currentRound.status === 'complete') {
    document.getElementById('no-round-teams').style.display = '';
    document.getElementById('teams-page-content').style.display = 'none';
    return;
  }
  document.getElementById('no-round-teams').style.display = 'none';
  document.getElementById('teams-page-content').style.display = '';

  // If round has saved players, sync state
  if (state.roundPlayers.length) {
    state.checkedIn = new Set(state.roundPlayers.map(rp => rp.player_id));
    state.roundPlayers.forEach(rp => {
      state.teamAssignments[rp.player_id] = rp.team || '';
    });
  }
  renderPlayerAssignList();
  renderTeamPreview();
  if (state.isCommish && state.currentRound) renderRsvpSummary();
}

function renderPlayerAssignList() {
  const search = (document.getElementById('player-search')?.value || '').toLowerCase();
  const container = document.getElementById('assign-list');
  if (!container) return;

  const filtered = state.players.filter(p =>
    p.active !== false && (!search || p.name.toLowerCase().includes(search))
  ).sort((a, b) => a.name.localeCompare(b.name));
  const checkedCount = state.checkedIn.size;
  const countEl = document.getElementById('teams-player-count');
  if (countEl) countEl.textContent = `${checkedCount} checked in`;

  container.innerHTML = filtered.map(p => {
    const isIn  = state.checkedIn.has(p.id);
    const team  = state.teamAssignments[p.id] || '';
    const avg   = p.avg_score ? parseFloat(p.avg_score).toFixed(1) : '?';
    return `
      <div class="team-select-row">
        <input type="checkbox" ${isIn ? 'checked' : ''} onchange="togglePlayer('${p.id}', this.checked)"
          style="cursor:pointer;accent-color:var(--green);flex-shrink:0;">
        <span class="tsrow-name" title="${p.name}">${p.name}</span>
        <span class="tsrow-avg">${avg}</span>
        <select class="tsrow-select" onchange="assignTeam('${p.id}', this.value)" ${!isIn ? 'disabled' : ''}>
          <option value="">— Team</option>
          ${TEAMS.map(t => `<option value="${t}" ${team === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
    `;
  }).join('');
}

function togglePlayer(playerId, checked) {
  if (checked) {
    state.checkedIn.add(playerId);
    if (!state.teamAssignments[playerId]) state.teamAssignments[playerId] = '';
  } else {
    state.checkedIn.delete(playerId);
    delete state.teamAssignments[playerId];
  }
  renderPlayerAssignList();
  renderTeamPreview();
  updateCalc();
}

function assignTeam(playerId, team) {
  state.teamAssignments[playerId] = team;
  renderTeamPreview();
}

function renderTeamPreview() {
  const container = document.getElementById('teams-preview');
  if (!container) return;

  const teams = getTeamGroupsByPlayerId();
  if (!Object.keys(teams).length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No teams yet — check players in and assign a team letter above.</p>';
    return;
  }

  const teamEntries = Object.entries(teams).sort();
  const copyText = teamEntries.map(([t, players]) =>
    `Team ${t}\n` + players.map(p => p.name).join('\n')
  ).join('\n\n');

  container.innerHTML =
    `<button class="btn-copy-teams" onclick="copyTeamsToClipboard()" title="Copy all teams">Copy Teams</button>` +
    `<div id="teams-preview-cards">` +
    teamEntries.map(([t, players]) => {
      const avgSum = players.reduce((s, p) => s + (parseFloat(p.avg_score) || 40), 0);
      const teamAvg = players.length ? (avgSum / players.length).toFixed(1) : '—';
      return `
        <div class="team-card">
          <div class="team-card-header">
            <span class="team-label" style="color:${TEAM_COLORS[t] || 'var(--green)'}">Team ${t}</span>
            <span class="team-score-badge">avg ${teamAvg}</span>
          </div>
          ${players.map(p => `
            <div class="team-member">
              <span class="member-name">${p.name}</span>
              <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted)">
                ${p.avg_score ? parseFloat(p.avg_score).toFixed(1) : '?'}
              </span>
            </div>
          `).join('')}
        </div>
      `;
    }).join('') +
    `</div>`;

  // store copy text for the handler
  container.dataset.copyText = copyText;
}

function copyTeamsToClipboard() {
  const container = document.getElementById('teams-preview');
  const text = container?.dataset.copyText;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('Teams copied!'));
}

function getTeamGroupsByPlayerId() {
  const teams = {};
  state.checkedIn.forEach(pid => {
    const team = state.teamAssignments[pid];
    if (team) {
      if (!teams[team]) teams[team] = [];
      const p = state.players.find(x => x.id === pid) || { id: pid, name: pid, avg_score: 40 };
      teams[team].push(p);
    }
  });
  return teams;
}

function autoBalance() {
  const checkedIds = [...state.checkedIn];
  if (!checkedIds.length) { toast('Check in players first!'); return; }

  const sorted = checkedIds
    .map(id => state.players.find(p => p.id === id) || { id, avg_score: 40 })
    .sort((a, b) => (parseFloat(a.avg_score) || 40) - (parseFloat(b.avg_score) || 40));

  const numTeams = Math.min(Math.ceil(sorted.length / 4), TEAMS.length);

  sorted.forEach((p, i) => {
    const round   = Math.floor(i / numTeams);
    const pos     = i % numTeams;
    const teamIdx = round % 2 === 0 ? pos : numTeams - 1 - pos;
    state.teamAssignments[p.id] = TEAMS[teamIdx];
  });

  renderPlayerAssignList();
  renderTeamPreview();
  toast('Teams balanced by scoring average!');
}

async function addGuest() {
  const name = prompt('Guest player name:');
  if (!name?.trim()) return;
  const avgInput = prompt(`Estimated average score for ${name.trim()} (e.g. 40):`);
  const avg = parseFloat(avgInput) || 40;

  if (!db) {
    const guest = { id: 'guest-' + Date.now(), name: name.trim(), avg_score: avg, rounds_played: 0 };
    state.players.push(guest);
    state.checkedIn.add(guest.id);
    state.teamAssignments[guest.id] = '';
    renderPlayerAssignList();
    renderTeamPreview();
    toast(`${name.trim()} added as guest!`);
    return;
  }

  const { data, error } = await db
    .from('players')
    .insert({ name: name.trim(), avg_score: avg, rounds_played: 0 })
    .select().single();

  if (error) { toast('Error: ' + error.message); return; }

  state.players.push(data);
  state.players.sort((a, b) => (a.avg_score || 99) - (b.avg_score || 99));
  state.checkedIn.add(data.id);
  state.teamAssignments[data.id] = '';
  renderPlayerAssignList();
  renderTeamPreview();
  toast(`${data.name} added as guest!`);
}

// ===== PASTE LIST =====
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function matchPastedNames(lines, players) {
  const active = players.filter(p => p.active !== false);
  const results = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const token = line.toLowerCase();
    const words = token.split(/\s+/);
    let candidates = [];

    // 1. Exact full name
    candidates = active.filter(p => p.name.toLowerCase() === token);

    // 2. First name only (single word in paste)
    if (!candidates.length && words.length === 1) {
      candidates = active.filter(p => p.name.toLowerCase().split(/\s+/)[0] === token);
    }

    // 3. Last name only (single word in paste)
    if (!candidates.length && words.length === 1) {
      candidates = active.filter(p => {
        const parts = p.name.toLowerCase().split(/\s+/);
        return parts[parts.length - 1] === token;
      });
    }

    // 4. First name + last initial (e.g. "John M" → "John Markham")
    if (!candidates.length && words.length === 2 && words[1].length === 1) {
      candidates = active.filter(p => {
        const parts = p.name.toLowerCase().split(/\s+/);
        return parts[0] === words[0] && parts[parts.length - 1].startsWith(words[1]);
      });
    }

    // 5. Contains fallback
    if (!candidates.length) {
      candidates = active.filter(p => {
        const pName = p.name.toLowerCase();
        return pName.includes(token) || token.includes(pName);
      });
    }

    // Deduplicate by id
    const unique = [...new Map(candidates.map(p => [p.id, p])).values()];

    if (unique.length === 1) {
      results.push({ raw, matched: unique[0], ambiguous: [] });
    } else if (unique.length > 1) {
      results.push({ raw, matched: null, ambiguous: unique });
    } else {
      results.push({ raw, matched: null, ambiguous: [] });
    }
  }
  return results;
}

function openPasteModal() {
  document.getElementById('paste-input-section').style.display = '';
  document.getElementById('paste-results-section').style.display = 'none';
  document.getElementById('paste-textarea').value = '';
  document.getElementById('paste-modal').classList.add('open');
  setTimeout(() => document.getElementById('paste-textarea').focus(), 150);
}

function closePasteModal() {
  document.getElementById('paste-modal').classList.remove('open');
}

function submitPasteList() {
  const text = document.getElementById('paste-textarea').value;
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (!lines.length) { toast('Paste some names first!'); return; }

  const results = matchPastedNames(lines, state.players);

  // Bulk check in all matched players (single re-render at end)
  let checkedCount = 0;
  for (const r of results) {
    if (r.matched) {
      if (!state.checkedIn.has(r.matched.id)) {
        state.checkedIn.add(r.matched.id);
        if (!state.teamAssignments[r.matched.id]) state.teamAssignments[r.matched.id] = '';
      }
      checkedCount++;
    }
  }
  renderPlayerAssignList();
  renderTeamPreview();
  updateCalc();

  // Switch to results view
  document.getElementById('paste-input-section').style.display = 'none';
  document.getElementById('paste-results-section').style.display = '';
  document.getElementById('paste-success-msg').textContent =
    `✅ ${checkedCount} player${checkedCount !== 1 ? 's' : ''} checked in`;

  const unresolved = results.filter(r => !r.matched);
  const unresolvedList = document.getElementById('paste-unresolved-list');

  if (!unresolved.length) {
    unresolvedList.innerHTML = '';
    return;
  }

  unresolvedList.innerHTML =
    `<div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">⚠️ ${unresolved.length} unresolved name${unresolved.length !== 1 ? 's' : ''}</div>` +
    unresolved.map((r, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;" id="paste-row-${i}">
        <span style="font-family:'DM Mono',monospace;font-size:13px;min-width:80px;flex-shrink:0;">${escHtml(r.raw)}</span>
        ${r.ambiguous.length > 1
          ? `<select onchange="resolvePastedName(${i}, this.value)" style="flex:1;min-width:140px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--warm-white);">
               <option value="">— Pick player</option>
               ${r.ambiguous.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}
             </select>`
          : `<span style="font-size:12px;color:var(--text-muted);flex:1;">Not found</span>
             <button class="btn btn-outline btn-sm" onclick="resolvePastedNameGuest('${escHtml(r.raw)}', ${i})">+ Add Guest</button>`
        }
        <button class="btn btn-outline btn-sm" style="color:var(--text-muted);" onclick="dismissPasteRow(${i})">Skip</button>
      </div>
    `).join('');
}

function resolvePastedName(rowIndex, playerId) {
  if (!playerId) return;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;
  if (!state.checkedIn.has(playerId)) {
    state.checkedIn.add(playerId);
    if (!state.teamAssignments[playerId]) state.teamAssignments[playerId] = '';
    renderPlayerAssignList();
    renderTeamPreview();
    updateCalc();
  }
  dismissPasteRow(rowIndex);
  const el = document.getElementById('paste-success-msg');
  const n = parseInt(el.textContent.match(/\d+/)?.[0] || '0') + 1;
  el.textContent = `✅ ${n} player${n !== 1 ? 's' : ''} checked in`;
}

async function resolvePastedNameGuest(name, rowIndex) {
  const avgInput = prompt(`Estimated average score for ${name} (e.g. 40):`);
  const avg = parseFloat(avgInput) || 40;

  if (!db) {
    const guest = { id: 'guest-' + Date.now(), name: name.trim(), avg_score: avg, rounds_played: 0 };
    state.players.push(guest);
    state.checkedIn.add(guest.id);
    state.teamAssignments[guest.id] = '';
    renderPlayerAssignList();
    renderTeamPreview();
    toast(`${name} added as guest!`);
  } else {
    const { data, error } = await db.from('players')
      .insert({ name: name.trim(), avg_score: avg, rounds_played: 0 })
      .select().single();
    if (error) { toast('Error: ' + error.message); return; }
    state.players.push(data);
    state.players.sort((a, b) => (a.avg_score || 99) - (b.avg_score || 99));
    state.checkedIn.add(data.id);
    state.teamAssignments[data.id] = '';
    renderPlayerAssignList();
    renderTeamPreview();
    toast(`${data.name} added as guest!`);
  }

  dismissPasteRow(rowIndex);
  const el = document.getElementById('paste-success-msg');
  const n = parseInt(el.textContent.match(/\d+/)?.[0] || '0') + 1;
  el.textContent = `✅ ${n} player${n !== 1 ? 's' : ''} checked in`;
}

function dismissPasteRow(rowIndex) {
  const row = document.getElementById(`paste-row-${rowIndex}`);
  if (row) row.style.display = 'none';
}

async function saveTeams() {
  const assigned = [...state.checkedIn].filter(id => state.teamAssignments[id]);
  if (!assigned.length) { toast('Assign at least one player to a team!'); return; }
  if (!state.currentRound) { toast('No active round. Set up a round first.'); return; }

  if (!db) {
    // Local mode: synthesize round_players from state
    state.roundPlayers = [...state.checkedIn].map(pid => {
      const p = state.players.find(x => x.id === pid) || { id: pid, name: pid, avg_score: 40 };
      return {
        id: 'rp-' + pid,
        round_id: state.currentRound.id,
        player_id: pid,
        team: state.teamAssignments[pid] || null,
        score: null, holes_won: 0, cth_winner: false, paid_in: false, paid_out: false,
        players: p,
      };
    });
    state.currentRound.status = 'in_progress';
    toast('Teams saved!');
    showPage('scores');
    return;
  }

  // Delete existing + reinsert
  await db.from('round_players').delete().eq('round_id', state.currentRound.id);

  const records = [...state.checkedIn].map(pid => ({
    round_id:   state.currentRound.id,
    player_id:  pid,
    team:       state.teamAssignments[pid] || null,
    score:      null,
    holes_won:  0,
    cth_winner: false,
    paid_in:    false,
    paid_out:   false,
  }));

  const { error } = await db.from('round_players').insert(records);
  if (error) { toast('Error saving teams: ' + error.message); return; }

  await db.from('rounds').update({ status: 'in_progress' }).eq('id', state.currentRound.id);
  state.currentRound.status = 'in_progress';

  await loadRoundPlayers();
  toast('Teams saved! Ready to enter scores.');
  showPage('scores');
}

// ===== SCORES PAGE =====
async function renderScoresPage() {
  if (db && state.currentRoundId) await loadRoundPlayers();

  const subtitle   = document.getElementById('scores-subtitle');
  const noRound    = document.getElementById('no-round-scores');
  const mainCard   = document.getElementById('scores-main-card');
  const skinsCard  = document.getElementById('skins-card');
  const finalizeBtn = document.getElementById('finalize-btn');

  if (!state.currentRound || !state.roundPlayers.length) {
    noRound.style.display   = '';
    mainCard.style.display  = 'none';
    if (skinsCard)  skinsCard.style.display  = 'none';
    document.getElementById('payout-card').style.display = 'none';
    document.getElementById('winner-banner').classList.remove('show');
    return;
  }

  noRound.style.display  = 'none';
  mainCard.style.display = '';

  const r = state.currentRound;
  if (subtitle) subtitle.textContent = `${r.date} · ${r.course} · ${state.roundPlayers.length} players`;

  // Show commish-only elements
  if (state.isCommish) {
    if (skinsCard)    skinsCard.style.display   = 'block';
    if (finalizeBtn)  finalizeBtn.style.display = '';
    document.getElementById('payout-th-paidin').style.display  = '';
    document.getElementById('payout-th-paidout').style.display = '';
  }

  renderTeamScoreCards();
  renderSkinsSection();
  calcAndRenderPayouts();
}

function renderTeamScoreCards() {
  const container = document.getElementById('score-teams');
  if (!container) return;

  const teams = getTeamGroupsByRpId();
  if (!Object.keys(teams).length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No teams assigned. Go to Teams first.</p>';
    return;
  }

  container.innerHTML = Object.entries(teams).sort().map(([t, rps]) => {
    const manualScore = state.teamScores[t];
    return `
      <div class="team-card" id="tcard-${t}">
        <div class="team-card-header">
          <span class="team-label" style="color:${TEAM_COLORS[t] || 'var(--green)'}">Team ${t}</span>
          ${state.isCommish
            ? `<input type="number" inputmode="decimal" class="team-score-input" placeholder="Score"
                 min="-99" max="200" value="${manualScore === undefined ? '' : manualScore}"
                 oninput="updateTeamScore('${t}', this.value)" id="tbadge-${t}">`
            : `<span class="team-score-badge" id="tbadge-${t}">${manualScore ?? '—'}</span>`
          }
        </div>
        <div class="section-label" style="font-size:10px;margin:8px 0 4px;">Individual Scores</div>
        ${rps.map(rp => `
          <div class="team-member">
            <div>
              <div class="member-name">${rp.players.name}</div>
              <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">
                avg ${rp.players.avg_score ? parseFloat(rp.players.avg_score).toFixed(1) : '?'}
              </div>
            </div>
            ${state.isCommish
              ? `<input type="number" inputmode="decimal" class="member-score-input" placeholder="—" min="-99" max="99"
                   value="${state.scores[rp.id] !== undefined ? state.scores[rp.id] : ''}"
                   oninput="updateScore('${rp.id}', this.value)">`
              : `<span style="font-family:'DM Mono',monospace;font-size:14px;font-weight:500;">
                   ${state.scores[rp.id] || '—'}
                 </span>`
            }
          </div>
        `).join('')}
      </div>
    `;
  }).join('');
}

function updateTeamScore(team, val) {
  const parsed = parseInt(val);
  if (!isNaN(parsed)) {
    state.teamScores[team] = parsed;
  } else {
    delete state.teamScores[team];
  }
  localStorage.setItem('whg_team_scores', JSON.stringify(state.teamScores));
  calcAndRenderPayouts();
  if (db && state.currentRound) {
    showSavingStatus();
    debounce('teamScores', async () => {
      await db.from('rounds').update({ team_scores: state.teamScores }).eq('id', state.currentRound.id);
      showSavedStatus();
    });
  }
}

function getTeamGroupsByRpId() {
  const teams = {};
  state.roundPlayers.forEach(rp => {
    if (!rp.team) return;
    if (!teams[rp.team]) teams[rp.team] = [];
    teams[rp.team].push(rp);
  });
  return teams;
}


function updateScore(rpId, val) {
  const parsed = parseInt(val);
  if (!isNaN(parsed)) {
    state.scores[rpId] = parsed;
  } else {
    delete state.scores[rpId];
  }
  if (db && state.currentRound) {
    showSavingStatus();
    debounce('score-' + rpId, async () => {
      await db.from('round_players').update({ score: state.scores[rpId] ?? null }).eq('id', rpId);
      showSavedStatus();
    });
  }
}

// ===== SKINS / CTH SECTION =====
function renderSkinsSection() {
  const skinsCard = document.getElementById('skins-card');
  if (!skinsCard || !state.isCommish) return;

  const allRps = state.roundPlayers.filter(rp => rp.team);

  // Hole winner dropdowns
  document.getElementById('skins-holes').innerHTML = Array.from({ length: 9 }, (_, i) => {
    const hole   = i + 1;
    const winner = state.holeWinners[hole] || '';
    return `
      <div class="skins-row">
        <span class="hole-label">Hole ${hole}</span>
        <select class="skins-select" onchange="setHoleWinner(${hole}, this.value)">
          <option value="">— No skin</option>
          ${allRps.map(rp => `
            <option value="${rp.id}" ${winner === rp.id ? 'selected' : ''}>
              ${rp.players.name} (${rp.team})
            </option>
          `).join('')}
        </select>
      </div>
    `;
  }).join('');

  // CTH — two dropdowns, one per par-3 hole
  const cthOptions = `
    <option value="">— No winner</option>
    ${allRps.map(rp => `<option value="${rp.id}">${rp.players.name} (${rp.team})</option>`).join('')}
  `;
  document.getElementById('cth-players').innerHTML = `
    <div class="skins-row">
      <span class="hole-label">Hole 2</span>
      <select class="skins-select" onchange="setCTHWinner(2, this.value)">
        ${allRps.reduce((opts, rp) => opts + `
          <option value="${rp.id}" ${state.cthWinners.hole2 === rp.id ? 'selected' : ''}>
            ${rp.players.name} (${rp.team})
          </option>`, '<option value="">— No winner</option>')}
      </select>
    </div>
    <div class="skins-row">
      <span class="hole-label">Hole 5</span>
      <select class="skins-select" onchange="setCTHWinner(5, this.value)">
        ${allRps.reduce((opts, rp) => opts + `
          <option value="${rp.id}" ${state.cthWinners.hole5 === rp.id ? 'selected' : ''}>
            ${rp.players.name} (${rp.team})
          </option>`, '<option value="">— No winner</option>')}
      </select>
    </div>
  `;
}

function setHoleWinner(hole, rpId) {
  if (rpId) state.holeWinners[hole] = rpId;
  else delete state.holeWinners[hole];
  saveRoundState();
  calcAndRenderPayouts();
}

function setCTHWinner(hole, rpId) {
  if (hole === 2) state.cthWinners.hole2 = rpId || null;
  if (hole === 5) state.cthWinners.hole5 = rpId || null;
  saveRoundState();
  calcAndRenderPayouts();
}

function togglePaidIn(rpId, checked) {
  if (checked) state.paidIn.add(rpId);
  else state.paidIn.delete(rpId);
}

function togglePaidOut(rpId, checked) {
  if (checked) state.paidOut.add(rpId);
  else state.paidOut.delete(rpId);
}

// ===== PAYOUT CALCULATIONS =====
function calcPayoutData() {
  const teams = getTeamGroupsByRpId();
  const r     = state.currentRound;

  // Use manually-entered team scores
  const teamScores = {};
  Object.keys(teams).forEach(t => {
    const s = state.teamScores[t];
    if (typeof s === 'number' && !isNaN(s)) teamScores[t] = s;
  });

  if (!Object.keys(teamScores).length) return null;

  const minScore = Math.min(...Object.values(teamScores));
  let winningTeams = Object.entries(teamScores).filter(([, s]) => s === minScore).map(([t]) => t);
  const tiedTeams = winningTeams.length > 1 ? [...winningTeams] : [];

  // Apply tiebreaker: hole 9 down to 1
  if (winningTeams.length > 1) {
    for (let h = 9; h >= 1; h--) {
      const hScores = winningTeams.map(t => state.tiebreakerScores[t]?.[h]);
      if (hScores.some(s => s === undefined)) break; // not all entered yet
      const minH = Math.min(...hScores);
      const resolved = winningTeams.filter(t => state.tiebreakerScores[t][h] === minH);
      if (resolved.length < winningTeams.length) { winningTeams = resolved; break; }
    }
  }

  const n        = state.roundPlayers.length;
  const buyin    = parseFloat(r.buyin_per_player) || 12;
  const totalPot = n * buyin;
  const cthPool  = n * 2;                // $1/hole × 2 CTH holes
  const mainPool = n * (buyin - 2);      // remaining $10/player

  // Skins
  const skinsPerRp = {};
  Object.values(state.holeWinners).forEach(rpId => {
    skinsPerRp[rpId] = (skinsPerRp[rpId] || 0) + 1;
  });
  const totalSkins  = Object.values(state.holeWinners).length;
  const hasSkins    = totalSkins > 0;
  const skinPool    = hasSkins ? mainPool * 0.25 : 0;
  const teamWinPool = mainPool - skinPool; // 75% if skins, 100% if not
  const skinValue   = hasSkins ? skinPool / totalSkins : 0;

  const winnerRps = winningTeams.flatMap(t => teams[t] || []);
  const perWin    = winnerRps.length > 0 ? teamWinPool / winnerRps.length : 0;

  // CTH — $1/player per hole, split between hole 2 and hole 5 winners
  const cthHalfPool = cthPool / 2;

  return {
    teams, teamScores, winningTeams, tiedTeams, n, totalPot, cthPool, teamWinPool, skinPool,
    perWin, skinsPerRp, skinValue, cthHalfPool, minScore,
  };
}

function calcAndRenderPayouts() {
  const teams         = getTeamGroupsByRpId();
  const hasTeamScore  = Object.values(state.teamScores).some(s => typeof s === 'number' && !isNaN(s));

  const banner     = document.getElementById('winner-banner');
  const payoutCard = document.getElementById('payout-card');
  if (!hasTeamScore || !Object.keys(teams).length) {
    if (banner)     banner.classList.remove('show');
    if (payoutCard) payoutCard.style.display = 'none';
    return;
  }

  const d = calcPayoutData();
  if (!d) return;

  // Highlight winning team cards; for public view update the static badge
  Object.entries(d.teamScores).forEach(([t]) => {
    const card = document.getElementById('tcard-' + t);
    if (card) card.classList.toggle('winning', d.winningTeams.includes(t));
    if (!state.isCommish) {
      const badge = document.getElementById('tbadge-' + t);
      if (badge) {
        badge.textContent = d.teamScores[t];
        badge.className   = 'team-score-badge' + (d.winningTeams.includes(t) ? ' winner' : '');
      }
    }
  });

  // Tiebreaker card
  const tbCard = document.getElementById('tiebreaker-card');
  if (d.tiedTeams.length > 1) {
    renderTiebreaker(d.tiedTeams, d.winningTeams);
  } else if (tbCard) {
    tbCard.style.display = 'none';
  }

  // Winner banner
  if (banner) {
    banner.classList.add('show');
    const stillTied = d.tiedTeams.length > 1 && d.winningTeams.length > 1;
    document.getElementById('winner-team-name').textContent = stillTied
      ? `Teams ${d.tiedTeams.join(' & ')} — Tied`
      : `Team ${d.winningTeams.join(' & ')} Wins! 🏆`;
    document.getElementById('winner-detail').textContent = stillTied
      ? `Score: ${d.minScore} — Enter tiebreaker below ↓`
      : `Score: ${d.minScore} — Team win pool: $${d.teamWinPool.toFixed(2)}`;
  }

  // Payout card
  if (payoutCard) payoutCard.style.display = 'block';

  const statsEl = document.getElementById('payout-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="payout-stat">
      <div class="value">${d.n}</div>
      <div class="label">Players</div>
    </div>
    <div class="payout-stat">
      <div class="value">$${d.totalPot.toFixed(0)}</div>
      <div class="label">Total Pot</div>
    </div>
    <div class="payout-stat">
      <div class="value">$${d.perWin.toFixed(2)}</div>
      <div class="label">Per Winner</div>
    </div>
  `;

  const allRps = Object.values(d.teams).flat();
  const extraCols = state.isCommish ? `
    <th style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">Paid In</th>
    <th style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">Paid Out</th>
  ` : '';

  let rows = '';
  allRps.forEach(rp => {
    const isWin  = d.winningTeams.includes(rp.team);
    const teamW  = isWin ? d.perWin : 0;
    const skinW  = (d.skinsPerRp[rp.id] || 0) * d.skinValue;
    const cthW   = (state.cthWinners.hole2 === rp.id ? d.cthHalfPool : 0)
                 + (state.cthWinners.hole5 === rp.id ? d.cthHalfPool : 0);
    const total  = teamW + skinW + cthW;
    const tColor = TEAM_COLORS[rp.team] || '#2d5a40';
    const paidCols = state.isCommish ? `
      <td>
        <label class="paid-label">
          <input type="checkbox" ${state.paidIn.has(rp.id) ? 'checked' : ''}
            onchange="togglePaidIn('${rp.id}', this.checked)"
            style="accent-color:var(--green);">
          In
        </label>
      </td>
      <td>
        <label class="paid-label">
          <input type="checkbox" ${state.paidOut.has(rp.id) ? 'checked' : ''}
            onchange="togglePaidOut('${rp.id}', this.checked)"
            style="accent-color:var(--gold);">
          Out
        </label>
      </td>
    ` : '';

    rows += `
      <tr>
        <td>
          <span style="font-weight:500">${rp.players.name}</span>
          <span class="tag" style="margin-left:4px;background:${tColor}22;color:${tColor}">${rp.team}</span>
        </td>
        <td>${isWin ? `<span class="tag">$${teamW.toFixed(2)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${skinW > 0 ? `<span class="tag">$${skinW.toFixed(2)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${cthW  > 0 ? `<span class="tag gold">$${cthW.toFixed(2)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${total > 0
          ? `<strong style="color:var(--green)">$${total.toFixed(2)}</strong>`
          : '<span style="color:var(--text-muted)">—</span>'
        }</td>
        ${paidCols}
      </tr>
    `;
  });

  const tbody = document.getElementById('payout-body');
  if (tbody) tbody.innerHTML = rows;
}

// ===== FINALIZE ROUND =====
async function finalizeRound() {
  if (!state.currentRound) return;
  const d = calcPayoutData();
  if (!d) { toast('Enter scores before finalizing!'); return; }

  if (!confirm(`Finalize this round? This will save all results and update player averages.`)) return;

  const btn = document.getElementById('finalize-btn');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  if (!db) {
    toast('Round finalized! (local mode — no DB to save to)');
    clearActiveRound();
    showPage('history');
    return;
  }

  // Update round_players with scores, skins, CTH, paid status
  for (const rp of state.roundPlayers) {
    const skinsCount = Object.values(state.holeWinners).filter(id => id === rp.id).length;
    const cthCount   = (state.cthWinners.hole2 === rp.id ? 1 : 0)
                     + (state.cthWinners.hole5 === rp.id ? 1 : 0);
    await db.from('round_players').update({
      score:      state.scores[rp.id] !== undefined ? state.scores[rp.id] : null,
      holes_won:  skinsCount,
      cth_winner: cthCount > 0,
      cth_count:  cthCount,
      paid_in:    state.paidIn.has(rp.id),
      paid_out:   state.paidOut.has(rp.id),
    }).eq('id', rp.id);
  }

  // Upsert round_results
  const results = state.roundPlayers.map(rp => {
    const isWin  = d.winningTeams.includes(rp.team);
    const teamW  = isWin ? d.perWin : 0;
    const skinW  = (d.skinsPerRp[rp.id] || 0) * d.skinValue;
    const cthW   = (state.cthWinners.hole2 === rp.id ? d.cthHalfPool : 0)
                 + (state.cthWinners.hole5 === rp.id ? d.cthHalfPool : 0);
    return {
      round_id:       state.currentRound.id,
      player_id:      rp.player_id,
      team_winnings:  teamW,
      skin_winnings:  skinW,
      cth_winnings:   cthW,
      total_winnings: teamW + skinW + cthW,
    };
  });

  await db.from('round_results').delete().eq('round_id', state.currentRound.id);
  await db.from('round_results').insert(results);

  // Update player stats — rolling last-10 avg, blended with base_avg for new players
  for (const rp of state.roundPlayers) {
    const currentScore = state.scores[rp.id];
    if (currentScore === undefined || currentScore === null) continue;
    const player = state.players.find(p => p.id === rp.player_id);
    if (!player) continue;

    // Fetch last 9 app scores (current round will be the 10th)
    const { data: history } = await db
      .from('round_players')
      .select('score')
      .eq('player_id', rp.player_id)
      .not('score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(9);

    const appScores = [currentScore, ...(history || []).map(h => h.score)];
    const n = appScores.length; // 1–10

    let newAvg;
    if (n >= 10) {
      // Full window of app scores — pure rolling last-10
      newAvg = appScores.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    } else {
      const baseAvg = parseFloat(player.base_avg ?? player.avg_score ?? 40);
      if (baseAvg != null && (player.base_rounds || 0) > 0) {
        // Blend app scores with historical base avg to fill the 10-round window
        newAvg = (appScores.reduce((a, b) => a + b, 0) + baseAvg * (10 - n)) / 10;
      } else {
        newAvg = appScores.reduce((a, b) => a + b, 0) / n;
      }
    }

    await db.from('players').update({
      rounds_played: (player.rounds_played || 0) + 1,
      avg_score:     parseFloat(newAvg.toFixed(2)),
    }).eq('id', rp.player_id);
  }

  // Mark round complete and save team scores
  await db.from('rounds').update({ status: 'complete', team_scores: state.teamScores }).eq('id', state.currentRound.id);

  // Clear state
  state.currentRoundId  = null;
  state.currentRound    = null;
  state.roundPlayers    = [];
  state.checkedIn       = new Set();
  state.teamAssignments = {};
  state.scores          = {};
  state.teamScores      = {};
  state.holeWinners     = {};
  state.cthWinners      = { hole2: null, hole5: null };
  state.paidIn          = new Set();
  state.paidOut         = new Set();
  localStorage.removeItem('whg_round_id');
  localStorage.removeItem('whg_team_scores');

  await loadPlayers();
  toast('Round finalized and results saved! 🏆');
  showPage('history');
}

// ===== COPY PAYOUT TEXT =====
function copyPayoutText() {
  const d = calcPayoutData();
  if (!d) { toast('No scores yet to copy.'); return; }

  const r = state.currentRound;
  let text = `⛳ ${r.course} — ${r.date}\n`;
  text += `${d.n} players | Total pot: $${d.totalPot.toFixed(0)}\n\n`;

  // Winning teams
  d.winningTeams.forEach(t => {
    const rps = d.teams[t] || [];
    text += `🏆 Team ${t} wins! Score: ${d.teamScores[t]} | $${d.perWin.toFixed(2)}/player\n`;
    rps.forEach(rp => {
      text += `  ${rp.players.name}: ${state.scores[rp.id] || '—'}\n`;
    });
    text += '\n';
  });

  // All payouts
  text += '💰 Payouts:\n';
  const allRps = Object.values(d.teams).flat();
  allRps.forEach(rp => {
    const isWin = d.winningTeams.includes(rp.team);
    const teamW = isWin ? d.perWin : 0;
    const skinW = (d.skinsPerRp[rp.id] || 0) * d.skinValue;
    const cthW  = (state.cthWinners.hole2 === rp.id ? d.cthHalfPool : 0)
               + (state.cthWinners.hole5 === rp.id ? d.cthHalfPool : 0);
    const total = teamW + skinW + cthW;
    if (total > 0) {
      const parts = [];
      if (teamW > 0) parts.push('team win');
      if (skinW > 0) parts.push(`${d.skinsPerRp[rp.id]} skin${d.skinsPerRp[rp.id] > 1 ? 's' : ''}`);
      if (cthW  > 0) parts.push('CTH');
      text += `  ${rp.players.name}: $${total.toFixed(2)} (${parts.join(' + ')})\n`;
    }
  });

  navigator.clipboard.writeText(text)
    .then(() => toast('Copied to clipboard! 📋'))
    .catch(() => {
      // Fallback: show in prompt
      prompt('Copy this payout summary:', text);
    });
}

// ===== STATS PAGE =====
const LEADERBOARD_MIN_ROUNDS = 5;

// ===== SEASON SUPERLATIVES =====
async function renderSuperlatives() {
  const grid  = document.getElementById('superlatives-grid');
  const title = document.getElementById('superlatives-title');
  if (!grid) return;

  const year = new Date().getFullYear();
  if (title) title.textContent = `${year} Leaderboard`;
  if (!db) { grid.innerHTML = ''; return; }

  const yearStart = `${year}-01-01`;

  const { data: yearRounds } = await db.from('rounds')
    .select('id').eq('status', 'complete').gte('date', yearStart);
  const roundIds = (yearRounds || []).map(r => r.id);

  if (!roundIds.length) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--text-muted);padding:8px 0;grid-column:1/-1;">No rounds completed yet in ${year}.</p>`;
    return;
  }

  const [
    { data: rpScores },
    { data: results },
    { data: rpSkins },
    { data: rpCtps },
  ] = await Promise.all([
    db.from('round_players').select('score, player_id, players(name)').in('round_id', roundIds).not('score', 'is', null),
    db.from('round_results').select('player_id, total_winnings, team_winnings, players(name)').in('round_id', roundIds),
    db.from('round_players').select('player_id, holes_won, players(name)').in('round_id', roundIds),
    db.from('round_players').select('player_id, cth_count, players(name)').in('round_id', roundIds),
  ]);

  // Best individual score — sorted ascending (lower = better), grouped by score value
  const allScores = (rpScores || []).map(r => ({ name: r.players?.name, score: r.score })).filter(r => r.score > 0);
  allScores.sort((a, b) => a.score - b.score);
  const bestRoundPodium = buildPodium(allScores, p => p.score, true); // ascending

  // Most money
  const moneyMap = {};
  (results || []).forEach(r => {
    if (!moneyMap[r.player_id]) moneyMap[r.player_id] = { name: r.players?.name, total: 0 };
    moneyMap[r.player_id].total += parseFloat(r.total_winnings || 0);
  });
  const moneySorted = Object.values(moneyMap).sort((a, b) => b.total - a.total);
  const moneyPodium = buildPodium(moneySorted, p => p.total);

  // Most wins (rounds where team_winnings > 0)
  const winsMap = {};
  (results || []).forEach(r => {
    if (parseFloat(r.team_winnings || 0) > 0) {
      if (!winsMap[r.player_id]) winsMap[r.player_id] = { name: r.players?.name, total: 0 };
      winsMap[r.player_id].total++;
    }
  });
  const winsSorted = Object.values(winsMap).sort((a, b) => b.total - a.total);
  const winsPodium = buildPodium(winsSorted, p => p.total);

  // Most skins
  const skinsMap = {};
  (rpSkins || []).forEach(r => {
    if (!skinsMap[r.player_id]) skinsMap[r.player_id] = { name: r.players?.name, total: 0 };
    skinsMap[r.player_id].total += (r.holes_won || 0);
  });
  const skinsSorted = Object.values(skinsMap).filter(p => p.total > 0).sort((a, b) => b.total - a.total);
  const skinsPodium = buildPodium(skinsSorted, p => p.total);

  // Most CTPs
  const ctpMap = {};
  (rpCtps || []).forEach(r => {
    if (!ctpMap[r.player_id]) ctpMap[r.player_id] = { name: r.players?.name, total: 0 };
    ctpMap[r.player_id].total += (r.cth_count || 0);
  });
  const ctpSorted = Object.values(ctpMap).filter(p => p.total > 0).sort((a, b) => b.total - a.total);
  const ctpPodium = buildPodium(ctpSorted, p => p.total);

  grid.innerHTML = [
    podiumTile('🏌️', 'Best Round',     bestRoundPodium, p => p.score),
    podiumTile('💰', 'Most Winnings',  moneyPodium,     p => `$${p.total.toFixed(2)}`),
    podiumTile('🏆', 'Most Wins',      winsPodium,      p => `${p.total} win${p.total !== 1 ? 's' : ''}`),
    podiumTile('🦴', 'Most Skins',     skinsPodium,     p => `${p.total} skin${p.total !== 1 ? 's' : ''}`),
    podiumTile('📍', 'Most CTPs',      ctpPodium,       p => `${p.total} CTP${p.total !== 1 ? 's' : ''}`),
  ].join('');
}

// Groups sorted entries into [{place, names, value}, ...] up to 3 podium positions
function buildPodium(sorted, getVal, ascending = false) {
  const places = [];
  const seen   = new Set();
  for (const item of sorted) {
    const v = getVal(item);
    if (seen.has(v)) continue;
    seen.add(v);
    const tied = sorted.filter(x => getVal(x) === v);
    places.push({ names: tied.map(x => x.name), value: v, raw: tied[0] });
    if (places.length === 3) break;
  }
  return places;
}

function podiumTile(icon, label, places, formatVal) {
  if (!places.length) return `
    <div class="superlative-tile">
      <div class="superlative-icon">${icon}</div>
      <div class="superlative-label">${label}</div>
      <div class="superlative-name" style="color:var(--text-muted);font-weight:400;font-size:13px;">—</div>
    </div>
  `;

  const first    = places[0];
  const firstName = first.names.length > 2
    ? `${first.names[0]} +${first.names.length - 1}`
    : first.names.join(', ');

  const podiumRows = places.slice(1).map((p, i) => {
    const num   = i + 2;
    const pname = p.names.length > 1 ? `${p.names[0]} +${p.names.length - 1}` : p.names[0];
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-top:5px;">
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text-muted);flex-shrink:0;">${num}</span>
        <span style="font-size:12px;color:var(--text-muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px;">${pname}</span>
        <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--gold);flex-shrink:0;">${formatVal(p.raw)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="superlative-tile">
      <div class="superlative-icon">${icon}</div>
      <div class="superlative-label">${label}</div>
      <div class="superlative-name">${firstName}</div>
      <div class="superlative-value">${formatVal(first.raw)}</div>
      ${podiumRows ? `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:6px;">${podiumRows}</div>` : ''}
    </div>
  `;
}

async function renderLastRoundCallout() {
  const el = document.getElementById('upcoming-callout');
  if (!el || !db) return;

  const { data: round } = await db
    .from('rounds')
    .select('id, date, course, team_scores')
    .eq('status', 'complete')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (!round) { el.style.display = 'none'; return; }

  // Fetch winners (players with team_winnings > 0)
  const { data: winners } = await db
    .from('round_results')
    .select('team_winnings, players(name)')
    .eq('round_id', round.id)
    .gt('team_winnings', 0);

  const dateObj  = new Date(round.date + 'T12:00:00');
  const weekday  = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const dateLong = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  // Winning team letter + score
  const scores   = round.team_scores || {};
  const minScore = Object.values(scores).length ? Math.min(...Object.values(scores)) : null;
  const winTeams = minScore !== null
    ? Object.entries(scores).filter(([, s]) => s === minScore).map(([t]) => t)
    : [];
  const scoreDisplay = minScore !== null
    ? (minScore > 0 ? `+${minScore}` : `${minScore}`)
    : '';
  const winnerNames = (winners || []).map(w => w.players?.name).filter(Boolean);

  el.style.display = '';
  el.innerHTML = `
    <div style="
      background:var(--green);border-radius:12px;padding:20px 24px;margin-bottom:20px;
      border:2px solid var(--gold);display:flex;align-items:center;
      justify-content:space-between;gap:16px;flex-wrap:wrap;
    ">
      <div>
        <div style="font-family:'DM Mono',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);margin-bottom:6px;">
          ⛳ Last Round
        </div>
        <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:var(--gold-light);line-height:1.2;">
          ${weekday}, ${dateLong}
        </div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:var(--cream);opacity:0.85;margin-top:4px;">
          ${round.course}${winTeams.length ? ` · Team ${winTeams.join(' & ')} wins${scoreDisplay ? ' · ' + scoreDisplay : ''}` : ''}
        </div>
        ${winnerNames.length ? `
          <div style="font-family:'DM Sans',sans-serif;font-size:12px;color:var(--gold-light);opacity:0.9;margin-top:4px;">
            ${winnerNames.join(' · ')}
          </div>` : ''}
      </div>
      <button onclick="openLastRound('${round.id}')"
        style="background:var(--gold);color:var(--green);border:none;border-radius:8px;padding:10px 18px;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;letter-spacing:0.5px;cursor:pointer;white-space:nowrap;flex-shrink:0;">
        See Results →
      </button>
    </div>
  `;
}

function openLastRound(roundId) {
  _pendingRoundOpen = roundId;
  showPage('history');
}

async function renderStats(filter) {
  const list = document.getElementById('stats-list');
  if (!list) return;

  if (!filter) {
    await loadPlayers();
    renderLastRoundCallout(); // fire async, don't await
    renderSuperlatives();     // fire async, don't await — loads independently
  }

  const f = (filter || '').toLowerCase();
  const all = state.players
    .filter(p => !f || p.name.toLowerCase().includes(f))
    .sort((a, b) => (parseFloat(a.avg_score) || 99) - (parseFloat(b.avg_score) || 99));

  if (!all.length) {
    list.innerHTML = '<div class="empty-state"><p>No players found.</p></div>';
    return;
  }

  const qualified = all.filter(p => (p.rounds_played || 0) >= LEADERBOARD_MIN_ROUNDS);
  const pending   = all.filter(p => (p.rounds_played || 0) <  LEADERBOARD_MIN_ROUNDS);

  const scoreColor = avg =>
    avg < 37 ? '#2d5a40' : avg < 40 ? '#4a8c5c' : avg < 43 ? '#c9a84c' : '#b94040';

  function buildBarRows(players, startRank) {
    if (!players.length) return '';
    const scores = players.map(p => parseFloat(p.avg_score) || 40);
    const minAvg = Math.min(...scores);
    const maxAvg = Math.max(...scores);
    const range  = maxAvg - minAvg || 1;
    return players.map((p, i) => {
      const avg = parseFloat(p.avg_score) || 0;
      const pct = Math.max(4, ((avg - minAvg) / range) * 100);
      const col = scoreColor(avg);
      const rank = startRank !== null ? `${startRank + i}` : '—';
      return `
        <div class="stat-bar-row" onclick="showPlayerModal('${p.id}')">
          <div class="stat-rank">${rank}</div>
          <div class="stat-name" title="${p.name}">${p.name}</div>
          <div class="stat-rounds">${p.rounds_played || 0}r</div>
          <div class="stat-bar-wrap">
            <div class="stat-bar-bg">
              <div class="stat-bar-fill" style="width:${pct}%;background:${col}"></div>
            </div>
          </div>
          <div class="stat-avg" style="color:${col}">${avg.toFixed(1)}</div>
        </div>
      `;
    }).join('');
  }

  let html = buildBarRows(qualified, 1);

  if (pending.length) {
    html += `
      <div style="margin-top:28px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
        <div class="section-label" style="margin:0;">Needs ${LEADERBOARD_MIN_ROUNDS}+ rounds to rank</div>
        <div style="flex:1;height:1px;background:var(--border);"></div>
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text-muted);">${pending.length} player${pending.length > 1 ? 's' : ''}</span>
      </div>
      <div style="opacity:0.65;">
        ${buildBarRows(pending, null)}
      </div>
    `;
  }

  list.innerHTML = html;
}

function filterStats(val) {
  renderStats(val);
}

// ===== PLAYER MODAL =====
async function showPlayerModal(playerId) {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return;

  const avg = parseFloat(player.avg_score) || 0;
  document.getElementById('modal-player-name').textContent   = player.name;
  document.getElementById('modal-player-avg').textContent    = avg.toFixed(1);
  document.getElementById('modal-player-rounds').textContent = player.rounds_played || 0;
  document.getElementById('modal-player-best').textContent   = '—';
  document.getElementById('modal-history-list').innerHTML    = '<div class="loading">Loading…</div>';
  document.getElementById('player-modal').classList.add('open');

  if (!db) {
    document.getElementById('modal-history-list').innerHTML =
      '<p style="color:var(--text-muted);font-size:13px;">Connect Supabase to see round history.</p>';
    return;
  }

  const { data } = await db
    .from('round_players')
    .select('score, team, round_id, rounds(date, course, status)')
    .eq('player_id', playerId)
    .not('score', 'is', null);

  if (!data?.length) {
    document.getElementById('modal-history-list').innerHTML =
      '<p style="color:var(--text-muted);font-size:13px;">No completed rounds yet.</p>';
    return;
  }

  // Sort most recent first
  const sorted = data
    .filter(rp => rp.rounds?.status === 'complete' || rp.score)
    .sort((a, b) => (b.rounds?.date || '').localeCompare(a.rounds?.date || ''));

  const bestScore = Math.min(...sorted.map(rp => rp.score || 99));
  document.getElementById('modal-player-best').textContent = bestScore < 99 ? bestScore : '—';

  const col = s => s < 37 ? '#2d5a40' : s < 40 ? '#4a8c5c' : s < 43 ? '#c9a84c' : '#b94040';

  document.getElementById('modal-history-list').innerHTML = sorted.map(rp => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f0ece4;">
      <div>
        <div style="font-size:13px;font-weight:500;">${rp.rounds?.date || 'Unknown'}</div>
        <div style="font-size:11px;color:var(--text-muted);font-family:'DM Mono',monospace;">
          ${rp.rounds?.course || ''} · Team ${rp.team || '?'}
        </div>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:17px;font-weight:500;color:${col(rp.score)}">
        ${rp.score}
      </div>
    </div>
  `).join('');
}

function closePlayerModal() {
  document.getElementById('player-modal').classList.remove('open');
}

// Close modals on overlay click
document.addEventListener('click', e => {
  if (e.target.id === 'player-modal')  closePlayerModal();
  if (e.target.id === 'commish-modal') closeCommishModal();
});

// ===== HISTORY PAGE =====
// ===== PLAYER ADMIN =====
async function addNewPlayer() {
  const input = document.getElementById('new-player-name');
  const name  = (input?.value || '').trim();
  if (!name) { toast('Enter a player name.'); return; }
  if (!db)   { toast('No DB connected.'); return; }

  const { data, error } = await db.from('players')
    .insert({ name, avg_score: null, rounds_played: 0, active: true })
    .select().single();

  if (error) { toast('Error: ' + error.message); return; }

  input.value = '';
  state.players.push(data);
  state.players.sort((a, b) => (parseFloat(a.avg_score) || 99) - (parseFloat(b.avg_score) || 99));
  toast(`${name} added!`);
  renderPlayersAdmin();
}

async function togglePlayerActive(playerId, active) {
  if (!db) return;
  const { error } = await db.from('players').update({ active }).eq('id', playerId);
  if (error) { toast('Error: ' + error.message); return; }
  const p = state.players.find(p => p.id === playerId);
  if (p) p.active = active;
  toast(active ? 'Player reactivated.' : 'Player set to inactive.');
  renderPlayersAdmin();
}

function renderPlayersAdmin() {
  const container = document.getElementById('players-admin-list');
  if (!container) return;

  const search = (document.getElementById('players-admin-search')?.value || '').toLowerCase();
  const active   = state.players.filter(p => p.active !== false);
  const inactive = state.players.filter(p => p.active === false);
  const all = [...active, ...inactive].filter(p => !search || p.name.toLowerCase().includes(search));

  if (!all.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No players found.</p>';
    return;
  }

  container.innerHTML = all.map(p => {
    const isActive = p.active !== false;
    const avg      = p.avg_score != null ? parseFloat(p.avg_score).toFixed(1) : '—';
    const contactLine = (p.email || p.phone)
      ? `<div class="player-admin-meta" style="margin-top:2px;">${[p.email, p.phone].filter(Boolean).join(' · ')}</div>`
      : `<div class="player-admin-meta" style="margin-top:2px;color:#b94040;">No contact info</div>`;
    return `
      <div class="player-admin-row${isActive ? '' : ' player-inactive'}">
        <div style="flex:1;min-width:0;">
          <div class="player-admin-name">${p.name}</div>
          <div class="player-admin-meta">${p.rounds_played || 0} rounds · avg ${avg}</div>
          ${contactLine}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-outline btn-sm" onclick="togglePlayerEdit('${p.id}')">Edit</button>
          <button class="btn btn-sm ${isActive ? 'btn-outline' : 'btn-gold'}"
            onclick="togglePlayerActive('${p.id}', ${!isActive})">
            ${isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
      <div id="edit-${p.id}" style="display:none;padding:12px 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="email" id="edit-email-${p.id}" value="${p.email || ''}" placeholder="Email"
            style="flex:1;min-width:160px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--warm-white);">
          <input type="tel" id="edit-phone-${p.id}" value="${p.phone || ''}" placeholder="Phone"
            style="flex:1;min-width:130px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--warm-white);">
          <button class="btn btn-primary btn-sm" onclick="savePlayerContact('${p.id}')">Save</button>
          <button class="btn btn-outline btn-sm" onclick="togglePlayerEdit('${p.id}')">Cancel</button>
        </div>
      </div>
    `;
  }).join('');
}

function togglePlayerEdit(playerId) {
  const el = document.getElementById('edit-' + playerId);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function savePlayerContact(playerId) {
  const email = document.getElementById('edit-email-' + playerId)?.value.trim() || null;
  const phone = document.getElementById('edit-phone-' + playerId)?.value.trim() || null;
  if (!db) return;
  const { error } = await db.from('players').update({ email, phone }).eq('id', playerId);
  if (error) { toast('Error: ' + error.message); return; }
  const p = state.players.find(p => p.id === playerId);
  if (p) { p.email = email; p.phone = phone; }
  toast('Contact info saved.');
  renderPlayersAdmin();
}

async function deleteRound(roundId) {
  if (!db) { toast('No DB connected.'); return; }
  if (!confirm('Delete this round? Player stats will be recalculated. This cannot be undone.')) return;

  // Get affected player IDs before deletion
  const { data: rps } = await db.from('round_players').select('player_id').eq('round_id', roundId);
  const playerIds = [...new Set((rps || []).map(r => r.player_id).filter(Boolean))];

  // Delete round (cascades to round_players and round_results)
  const { error } = await db.from('rounds').delete().eq('id', roundId);
  if (error) { toast('Error deleting round: ' + error.message); return; }

  // Recalculate stats for each affected player using base_avg blending
  for (const pid of playerIds) {
    const player = state.players.find(p => p.id === pid);
    const baseAvg    = parseFloat(player?.base_avg ?? player?.avg_score ?? 40);
    const baseRounds = player?.base_rounds || 0;

    const { data: remaining } = await db
      .from('round_players')
      .select('score')
      .eq('player_id', pid)
      .not('score', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    const appScores = (remaining || []).map(r => r.score).filter(s => s !== null && !isNaN(s));
    const n = appScores.length;
    const rounds_played = baseRounds + n;

    let avg_score;
    if (n === 0) {
      avg_score = baseAvg;
    } else if (n >= 10) {
      avg_score = appScores.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    } else if (baseAvg != null && baseRounds > 0) {
      avg_score = (appScores.reduce((a, b) => a + b, 0) + baseAvg * (10 - n)) / 10;
    } else {
      avg_score = appScores.reduce((a, b) => a + b, 0) / n;
    }

    await db.from('players').update({
      rounds_played,
      avg_score: parseFloat(avg_score.toFixed(2)),
    }).eq('id', pid);
  }

  toast('Round deleted and stats updated.');

  // If deleted round was the active round, clear it
  if (state.currentRoundId === roundId) {
    state.currentRound    = null;
    state.currentRoundId  = null;
    localStorage.removeItem('whg_round_id');
    localStorage.removeItem('whg_team_scores');
  }

  // Reload players and re-render
  await loadPlayers();
  await renderHistory();
}

async function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;

  list.innerHTML = '<div class="loading">Loading rounds…</div>';

  if (!db) {
    list.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Connect Supabase to see round history.</p></div>';
    return;
  }

  const { data: rounds, error } = await db
    .from('rounds')
    .select('*, lead_commish:players!lead_commish_id(name)')
    .eq('status', 'complete')
    .order('date', { ascending: false });

  if (error) {
    list.innerHTML = '<p style="color:var(--text-muted)">Error loading history.</p>';
    return;
  }

  if (!rounds?.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🏌️</div>
        <p>No completed rounds yet. Finish your first round and it'll appear here!</p>
      </div>
    `;
    return;
  }

  state.historyRounds = rounds;

  list.innerHTML = rounds.map(r => {
    const dateObj  = new Date(r.date + 'T12:00:00');
    const dateFmt  = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
    return `
      <div class="history-card" id="hcard-${r.id}">
        <div class="history-card-header" onclick="toggleHistoryCard('${r.id}', document.getElementById('hcard-${r.id}'))" style="cursor:pointer;">
          <div>
            <div class="history-date">${dateFmt}</div>
            <div class="history-meta">${r.course}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button title="Copy link to this round" onclick="event.stopPropagation();shareRound('${r.id}')"
              style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:13px;cursor:pointer;color:var(--text-muted);">🔗</button>
            ${state.isCommish ? `<button class="btn btn-danger btn-sm commish-only" onclick="event.stopPropagation();deleteRound('${r.id}')" style="font-size:11px;padding:3px 8px;">Delete</button>` : ''}
            <span class="history-expand">▼</span>
          </div>
        </div>
        <div class="history-body" id="hbody-${r.id}">
          <div class="loading">Loading…</div>
        </div>
      </div>
    `;
  }).join('');

  // Auto-open deep-linked round
  if (_pendingRoundOpen) {
    const pendingId = _pendingRoundOpen;
    _pendingRoundOpen = null;
    const el   = document.getElementById('hcard-' + pendingId);
    const body = document.getElementById('hbody-' + pendingId);
    if (el && body) {
      el.classList.add('open');
      setTimeout(async () => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        await loadHistoryRoundData(pendingId, body);
      }, 100);
    }
  }
}

function shareRound(roundId) {
  const url = `${window.location.origin}${window.location.pathname}?round=${roundId}`;
  navigator.clipboard.writeText(url).then(() => toast('Round link copied!'));
}

async function toggleHistoryCard(roundId, el) {
  el.classList.toggle('open');
  const body    = document.getElementById('hbody-' + roundId);
  const isOpen  = el.classList.contains('open');
  if (isOpen && body.innerHTML.includes('Loading')) {
    await loadHistoryRoundData(roundId, body);
  }
}

async function loadHistoryRoundData(roundId, container) {
  const round = state.historyRounds.find(r => r.id === roundId);

  const [{ data: rps }, { data: results }] = await Promise.all([
    db.from('round_players').select('*, players(name)').eq('round_id', roundId),
    db.from('round_results').select('*, players(name)').eq('round_id', roundId).order('total_winnings', { ascending: false }),
  ]);

  if (!rps?.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No data found.</p>';
    return;
  }

  // Group by team
  const teams = {};
  rps.forEach(rp => {
    if (!teams[rp.team]) teams[rp.team] = [];
    teams[rp.team].push(rp);
  });

  // Determine winning teams from round_results (team_winnings > 0)
  const winnerPlayerIds = new Set(
    (results || []).filter(r => r.team_winnings > 0).map(r => r.player_id)
  );
  const winTeams = [...new Set(
    rps.filter(rp => winnerPlayerIds.has(rp.player_id)).map(rp => rp.team)
  )];

  const totalPot   = rps.length * (parseFloat(round?.buyin_per_player) || 0);
  const numPlayers = rps.length;

  const commishName = round?.lead_commish?.name;
  let html = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);">
        ${numPlayers} players · $${totalPot.toFixed(0)} pot${commishName ? ` · commish: ${commishName}` : ''}
      </span>
    </div>
    <div class="teams-grid">
  `;

  const savedTeamScores = round?.team_scores || {};
  Object.entries(teams).sort().forEach(([t, tRps]) => {
    const isWin = winTeams.includes(t);
    const tScore = savedTeamScores[t];
    html += `
      <div class="team-card ${isWin ? 'winning' : ''}">
        <div class="team-card-header">
          <span class="team-label" style="color:${TEAM_COLORS[t] || 'var(--green)'}">Team ${t}</span>
          ${tScore != null ? `<span class="team-score-badge${isWin ? ' winner' : ''}">${isWin ? '🏆 ' : ''}${tScore}</span>` : (isWin ? `<span class="team-score-badge winner">🏆</span>` : '')}
        </div>
        ${tRps.map(rp => `
          <div class="team-member">
            <span class="member-name">${rp.players?.name || '?'}</span>
            <span style="font-family:'DM Mono',monospace;font-size:12px;color:var(--text-muted);">${rp.score !== null && rp.score !== undefined ? rp.score : '—'}</span>
          </div>
        `).join('')}
      </div>
    `;
  });

  html += '</div>';

  // Tiebreaker summary (if applicable)
  const tbScores   = round?.round_state?.tiebreakerScores || {};
  const savedTS    = round?.team_scores || {};
  const tsVals     = Object.values(savedTS).filter(s => typeof s === 'number');
  if (tsVals.length) {
    const minTS    = Math.min(...tsVals);
    const tiedTeamsList = Object.entries(savedTS).filter(([, s]) => s === minTS).map(([t]) => t);
    if (tiedTeamsList.length > 1 && Object.keys(tbScores).length) {
      let teamsInPlay = [...tiedTeamsList];
      let resolvedHole = null, resolvedWinners = null;
      for (let h = 9; h >= 1; h--) {
        const hScores = teamsInPlay.map(t => tbScores[t]?.[h]);
        if (hScores.some(s => s === undefined)) break;
        const minH = Math.min(...hScores);
        const resolved = teamsInPlay.filter(t => tbScores[t][h] === minH);
        if (resolved.length < teamsInPlay.length) { resolvedHole = h; resolvedWinners = resolved; break; }
      }
      if (resolvedHole !== null) {
        const holeDetail = tiedTeamsList.map(t => `${t}:${tbScores[t]?.[resolvedHole] ?? '?'}`).join('  ');
        html += `
          <div style="margin:12px 0;padding:10px 14px;background:#fdf3d8;border:1px solid var(--gold);border-radius:8px;font-size:13px;">
            ⚔️ <strong>Tiebreaker</strong> — Teams ${tiedTeamsList.join(' & ')} tied at ${minTS}.
            Team ${resolvedWinners.join(' & ')} won on hole ${resolvedHole}
            <span style="font-family:'DM Mono',monospace;color:var(--text-muted);margin-left:6px;">(${holeDetail})</span>
          </div>
        `;
      }
    }
  }

  // Payouts table
  const payoutRows = results?.filter(r => r.total_winnings > 0) || [];
  if (payoutRows.length) {
    html += `<div class="section-label">Payouts</div>`;
    html += `<table class="lb-table"><tbody>`;
    payoutRows.forEach(r => {
      html += `
        <tr>
          <td style="font-weight:500">${r.players?.name || '?'}</td>
          <td style="font-family:'DM Mono',monospace;color:var(--green);font-weight:500;">
            $${parseFloat(r.total_winnings).toFixed(2)}
          </td>
        </tr>
      `;
    });
    html += '</tbody></table>';
  }

  container.innerHTML = html;
}

// ===== TIEBREAKER =====
function renderTiebreaker(tiedTeams, winningTeams) {
  const card = document.getElementById('tiebreaker-card');
  const content = document.getElementById('tiebreaker-content');
  if (!card || !content) return;
  card.style.display = '';

  const stillTied = winningTeams.length > 1;
  let html = `<p style="font-size:14px;color:var(--text-muted);margin-bottom:16px;">
    Teams ${tiedTeams.join(' & ')} are tied at the same score.
    Enter each team's score per hole starting from hole 9 — lowest score wins.
  </p>`;

  let teamsInPlay = [...tiedTeams];
  let resolvedHole = null;

  for (let h = 9; h >= 1; h--) {
    const scores = teamsInPlay.map(t => ({ team: t, score: state.tiebreakerScores[t]?.[h] }));
    const allEntered = scores.every(s => s.score !== undefined);

    const isWinnerHole = resolvedHole === null && allEntered && (() => {
      const min = Math.min(...scores.map(s => s.score));
      return scores.filter(s => s.score === min).length < scores.length;
    })();

    html += `
      <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);">
        <div class="section-label" style="margin-top:0;margin-bottom:8px;">Hole ${h}${resolvedHole !== null ? ' (not needed)' : ''}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
    `;

    scores.forEach(({ team, score }) => {
      const color = TEAM_COLORS[team] || 'var(--green)';
      const disabled = resolvedHole !== null ? 'disabled style="opacity:0.4;"' : '';
      html += `
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="tag" style="background:${color}22;color:${color};font-size:13px;">Team ${team}</span>
          <input type="number" inputmode="decimal" min="-20" max="20" ${disabled}
            style="width:60px;height:44px;text-align:center;font-size:22px;font-family:'DM Mono',monospace;font-weight:500;border:2px solid ${score !== undefined && isWinnerHole ? 'var(--gold)' : 'var(--border)'};border-radius:8px;background:var(--warm-white);"
            value="${score !== undefined ? score : ''}"
            oninput="updateTiebreakerScore('${team}', ${h}, this.value)">
        </div>
      `;
    });

    html += '</div>';

    if (allEntered) {
      const min = Math.min(...scores.map(s => s.score));
      const winners = scores.filter(s => s.score === min).map(s => s.team);
      if (winners.length < teamsInPlay.length) {
        resolvedHole = h;
        html += `<div style="margin-top:8px;padding:8px 12px;background:#e8f4ec;border-radius:6px;border:1px solid #a8d4b0;font-size:13px;font-weight:600;color:var(--green);">
          ✓ Team ${winners.join(' & ')} wins hole ${h} — tiebreaker resolved
        </div>`;
        teamsInPlay = winners;
      }
    }

    html += '</div>';
    if (!allEntered && resolvedHole === null) break; // don't show holes we can't reach yet
  }

  content.innerHTML = html;
}

function updateTiebreakerScore(team, hole, val) {
  const parsed = parseInt(val);
  if (!state.tiebreakerScores[team]) state.tiebreakerScores[team] = {};
  if (!isNaN(parsed)) {
    state.tiebreakerScores[team][hole] = parsed;
  } else {
    delete state.tiebreakerScores[team][hole];
  }
  saveRoundState();
  calcAndRenderPayouts();
}

// ===== RSVP =====
function showRsvpLink(roundId) {
  const section = document.getElementById('rsvp-link-section');
  if (!section) return;
  const url = `${window.location.origin}/rsvp.html?round=${roundId}`;
  document.getElementById('rsvp-link-text').textContent = url;
  section.style.display = '';
}

function copyRsvpLink() {
  const url = document.getElementById('rsvp-link-text').textContent;
  navigator.clipboard.writeText(url).then(() => toast('RSVP link copied!'));
}

async function renderRsvpSummary() {
  const card = document.getElementById('rsvp-summary-card');
  const content = document.getElementById('rsvp-list-content');
  if (!card || !content || !db) return;

  const { data: rsvps, error } = await db
    .from('rsvps')
    .select('name, email, phone, created_at')
    .eq('round_id', state.currentRound.id)
    .order('created_at');

  if (error) { content.textContent = 'Error loading RSVPs.'; card.style.display = ''; return; }

  if (!rsvps || !rsvps.length) {
    content.innerHTML = '<span style="color:var(--text-muted);">No RSVPs yet.</span>';
    card.style.display = '';
    return;
  }

  state._rsvps = rsvps; // cache for copyRsvpList()

  content.innerHTML = `
    <table class="lb-table" style="margin-top:8px;">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Phone</th>
        </tr>
      </thead>
      <tbody>
        ${rsvps.map(r => `
          <tr>
            <td style="font-weight:500">${r.name}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px;">${r.email}</td>
            <td style="font-family:'DM Mono',monospace;font-size:12px;">${r.phone}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);margin-top:8px;">${rsvps.length} RSVP${rsvps.length !== 1 ? 's' : ''}</div>
  `;
  card.style.display = '';
}

function copyRsvpList() {
  const rsvps = state._rsvps;
  if (!rsvps || !rsvps.length) { toast('No RSVPs to copy.'); return; }
  const r = state.currentRound;
  const dateStr = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const lines = [
    `RSVPs — ${r.course} · ${dateStr}`,
    ...rsvps.map((p, i) => `${i + 1}. ${p.name}`),
    `(${rsvps.length} player${rsvps.length !== 1 ? 's' : ''})`,
  ];
  navigator.clipboard.writeText(lines.join('\n')).then(() => toast('RSVP list copied!'));
}

async function importRsvps() {
  if (!db || !state.currentRound) return;

  const { data: rsvps, error } = await db
    .from('rsvps')
    .select('player_id')
    .eq('round_id', state.currentRound.id);

  if (error) { toast('Error loading RSVPs.'); return; }
  if (!rsvps || !rsvps.length) { toast('No RSVPs to import.'); return; }

  let imported = 0;
  rsvps.forEach(r => {
    if (r.player_id && state.players.find(p => p.id === r.player_id)) {
      state.checkedIn.add(r.player_id);
      if (!state.teamAssignments[r.player_id]) state.teamAssignments[r.player_id] = '';
      imported++;
    }
  });

  renderPlayerAssignList();
  renderTeamPreview();
  updateCalc();
  toast(`Imported ${imported} RSVP${imported !== 1 ? 's' : ''} as checked in.`);
}

// ===== UTIL =====
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}
