/* ============================================================
   Whitehaven Golf League — RSVP Page Logic
   Standalone (no app.js dependency)
   ============================================================ */

let db;
let currentRound = null;

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

  // Check cutoff: reject if round date is today or earlier (cutoff = midnight before round day)
  const today = new Date().toISOString().split('T')[0];
  if (round.date <= today) {
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
  const { count } = await db.from('rsvps').select('id', { count: 'exact', head: true }).eq('round_id', roundId);
  document.getElementById('rsvp-count-display').textContent = `${count ?? 0} RSVP${count !== 1 ? 's' : ''} so far`;

  // Load players for dropdown
  const { data: players } = await db.from('players').select('id, name').eq('active', true).order('name');
  const sel = document.getElementById('rsvp-player-select');
  (players || []).forEach(p => {
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
  const newNameGroup = document.getElementById('new-name-group');
  if (val === '__new__') {
    newNameGroup.style.display = '';
  } else {
    newNameGroup.style.display = 'none';
    document.getElementById('rsvp-new-name').value = '';
  }
  clearError();
}

async function submitRsvp() {
  clearError();

  const playerSelect = document.getElementById('rsvp-player-select').value;
  const newName = document.getElementById('rsvp-new-name').value.trim();
  const email = document.getElementById('rsvp-email').value.trim();
  const phone = document.getElementById('rsvp-phone').value.trim();

  // Validation
  if (!playerSelect) { showError('Please select your name.'); return; }
  if (playerSelect === '__new__' && !newName) { showError('Please enter your full name.'); return; }
  if (!email || !email.includes('@')) { showError('Please enter a valid email address.'); return; }
  if (!phone) { showError('Please enter your phone number.'); return; }

  const btn = document.querySelector('button[onclick="submitRsvp()"]');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  let playerId = playerSelect === '__new__' ? null : playerSelect;
  let displayName = newName;

  // If existing player, get their name for the success message
  if (playerId) {
    const opt = document.querySelector(`#rsvp-player-select option[value="${playerId}"]`);
    displayName = opt ? opt.textContent : 'You';
  }

  // Upsert new player if needed
  if (playerSelect === '__new__' && newName) {
    const { data: newPlayer, error: playerError } = await db
      .from('players')
      .upsert({ name: newName, avg_score: 40, rounds_played: 0 }, { onConflict: 'name' })
      .select('id')
      .single();

    if (playerError) {
      showError('Error creating player: ' + playerError.message);
      btn.disabled = false;
      btn.textContent = 'RSVP for This Round →';
      return;
    }
    playerId = newPlayer.id;
  }

  // Insert RSVP
  const { error: rsvpError } = await db.from('rsvps').insert({
    round_id: currentRound.id,
    player_id: playerId,
    name: displayName,
    email,
    phone,
  });

  if (rsvpError) {
    if (rsvpError.code === '23505') {
      // Duplicate — already RSVPd with this email
      hide('rsvp-main');
      show('rsvp-success');
      document.getElementById('success-title').textContent = 'Already RSVPd!';
      document.getElementById('success-detail').textContent = `${email} is already on the list for this round.`;
    } else {
      showError('Error saving RSVP: ' + rsvpError.message);
      btn.disabled = false;
      btn.textContent = 'RSVP for This Round →';
    }
    return;
  }

  hide('rsvp-main');
  show('rsvp-success');
  document.getElementById('success-title').textContent = `You're in, ${displayName}!`;
  const dateStr = new Date(currentRound.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('success-detail').textContent = `See you at ${currentRound.course} on ${dateStr}.`;
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
