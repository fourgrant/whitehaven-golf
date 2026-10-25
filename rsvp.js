/* ============================================================
   Sheila (Whitehaven Sunday League) — RSVP Page Logic
   Standalone (no app.js dependency)
   ============================================================ */

let db;
let currentRound = null;
let playersMap   = {}; // id -> player object

function initRsvpPage() {
  try {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    showError('Configuration error — please contact the commish.');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const roundId = params.get('round');

  if (!roundId) {
    show('rsvp-not-found');
    hide('rsvp-loading');
    return;
  }

  loadRoundAndPlayers(roundId);
}

async function loadRoundAndPlayers(roundId) {
  const { data: round, error } = await db
    .from('rounds')
    .select('*')
    .eq('id', roundId)
    .single();

  if (error || !round) {
    show('rsvp-not-found');
    hide('rsvp-loading');
    return;
  }

  // RSVPs close at 9 AM Central on round day (tee time), matching Sheila in GroupMe.
  const nowCentral = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  if (nowCentral >= `${round.date} 09:00:00`) {
    show('rsvp-closed');
    hide('rsvp-loading');
    return;
  }

  currentRound = round;

  // Populate round info
  document.getElementById('rsvp-course').textContent = round.course;
  const dateStr = new Date(round.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('rsvp-date-buyin').textContent = `${dateStr} · $${round.buyin_per_player} buy-in`;

  // Load RSVP count
  const { count } = await db.from('rsvps').select('id', { count: 'exact', head: true }).eq('round_id', roundId).eq('waitlisted', false);
  const cap = round.max_players;
  document.getElementById('rsvp-count-display').textContent = cap && count >= cap
    ? `Full (${count}/${cap}) — new RSVPs join the waitlist`
    : `${count ?? 0}${cap ? `/${cap}` : ''} in so far`;

  const { data: players } = await db
    .from('players')
    .select('id, name')
    .eq('active', true)
    .order('name');

  const sel = document.getElementById('rsvp-player-select');
  (players || []).forEach(p => {
    playersMap[p.id] = p;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  const notListed = document.createElement('option');
  notListed.value = '__new__';
  notListed.textContent = 'Not listed — add me';
  sel.appendChild(notListed);

  hide('rsvp-loading');
  show('rsvp-main');
}

function handlePlayerSelectChange() {
  const val = document.getElementById('rsvp-player-select').value;
  document.getElementById('new-name-group').style.display = val === '__new__' ? '' : 'none';
  if (val !== '__new__') document.getElementById('rsvp-new-name').value = '';
  clearError();
}

async function submitRsvp() {
  clearError();

  const playerSelect = document.getElementById('rsvp-player-select').value;
  const newName      = document.getElementById('rsvp-new-name').value.trim();
  const player       = playersMap[playerSelect];

  // Validation
  if (!playerSelect)                         { showError('Please select your name.'); return; }
  if (playerSelect === '__new__' && !newName) { showError('Please enter your full name.'); return; }

  const btn = document.querySelector('button[onclick="submitRsvp()"]');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  let playerId    = playerSelect === '__new__' ? null : playerSelect;
  let displayName = player ? player.name : newName;

  // Add a new player if needed. A name that's already on the roster (even an
  // inactive player not in the dropdown) uses that player instead of resetting
  // their average and round count.
  if (playerSelect === '__new__' && newName) {
    let { data: newPlayer, error: playerError } = await db
      .from('players')
      .insert({ name: newName, avg_score: 40, rounds_played: 0 })
      .select('id, name')
      .single();

    if (playerError?.code === '23505') {
      ({ data: newPlayer, error: playerError } = await db
        .from('players').select('id, name').eq('name', newName).single());
    }

    if (playerError) {
      showError('Error creating player: ' + playerError.message);
      btn.disabled = false;
      btn.textContent = 'RSVP for This Round →';
      return;
    }
    playerId    = newPlayer.id;
    displayName = newPlayer.name;
  }

  // Insert RSVP
  const { data: saved, error: rsvpError } = await db.from('rsvps').insert({
    round_id:  currentRound.id,
    player_id: playerId,
    name:      displayName,
  }).select('waitlisted').single();

  if (rsvpError) {
    if (rsvpError.code === '23505') {
      hide('rsvp-main');
      show('rsvp-success');
      document.getElementById('success-title').textContent = 'Already RSVPd!';
      document.getElementById('success-detail').textContent = `${displayName} is already on the list for this round.`;
    } else {
      showError('Error saving RSVP: ' + rsvpError.message);
      btn.disabled = false;
      btn.textContent = 'RSVP for This Round →';
    }
    return;
  }

  hide('rsvp-main');
  show('rsvp-success');
  const dateStr = new Date(currentRound.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (saved?.waitlisted) {
    document.getElementById('success-title').textContent = `You're on the waitlist, ${displayName}.`;
    document.getElementById('success-detail').textContent = `We're full for ${dateStr}. If a spot opens, Sheila will tag you in the GroupMe.`;
  } else {
    document.getElementById('success-title').textContent = `You're in, ${displayName}!`;
    document.getElementById('success-detail').textContent = `See you at ${currentRound.course} on ${dateStr}.`;
  }
}

// ===== UTIL =====
function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

function showError(msg) {
  const el = document.getElementById('rsvp-error');
  el.textContent = msg;
  el.style.display = '';
}

function clearError() {
  const el = document.getElementById('rsvp-error');
  el.style.display = 'none';
  el.textContent = '';
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

document.addEventListener('DOMContentLoaded', initRsvpPage);
