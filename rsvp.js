/* ============================================================
   Whitehaven Golf League — RSVP Page Logic
   Standalone (no app.js dependency)
   ============================================================ */

let db;
let currentRound = null;
let playersMap   = {}; // id -> player object (includes email/phone)

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

  // Check cutoff: reject if round date is today or earlier
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

  // Load players (include email + phone for smart pre-fill)
  const { data: players } = await db
    .from('players')
    .select('id, name, email, phone')
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
  const val    = document.getElementById('rsvp-player-select').value;
  const player = playersMap[val];

  // New name field
  document.getElementById('new-name-group').style.display = val === '__new__' ? '' : 'none';
  if (val !== '__new__') document.getElementById('rsvp-new-name').value = '';

  const emailGroup = document.getElementById('email-group');
  const phoneGroup = document.getElementById('phone-group');
  const onFileNote = document.getElementById('contact-on-file');

  if (player && player.email && player.phone) {
    // Contact already on file — hide fields, show note
    emailGroup.style.display = 'none';
    phoneGroup.style.display = 'none';
    onFileNote.style.display = '';
    onFileNote.textContent   = `📋 Using ${player.email} · ${player.phone}`;
  } else {
    // Need to collect contact info
    emailGroup.style.display = '';
    phoneGroup.style.display = '';
    onFileNote.style.display = 'none';
    // Pre-fill whatever we do have
    if (player?.email) document.getElementById('rsvp-email').value = player.email;
    if (player?.phone) document.getElementById('rsvp-phone').value = player.phone;
  }

  clearError();
}

async function submitRsvp() {
  clearError();

  const playerSelect = document.getElementById('rsvp-player-select').value;
  const newName      = document.getElementById('rsvp-new-name').value.trim();
  const player       = playersMap[playerSelect];
  const hasContact   = player?.email && player?.phone;

  const emailEl = document.getElementById('rsvp-email');
  const phoneEl = document.getElementById('rsvp-phone');
  const email   = hasContact ? player.email : emailEl.value.trim();
  const phone   = hasContact ? player.phone : phoneEl.value.trim();

  // Validation
  if (!playerSelect)                                  { showError('Please select your name.'); return; }
  if (playerSelect === '__new__' && !newName)          { showError('Please enter your full name.'); return; }
  if (!hasContact && (!email || !email.includes('@'))) { showError('Please enter a valid email address.'); return; }
  if (!hasContact && !phone)                           { showError('Please enter your phone number.'); return; }

  const btn = document.querySelector('button[onclick="submitRsvp()"]');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  let playerId    = playerSelect === '__new__' ? null : playerSelect;
  let displayName = player ? player.name : newName;

  // Upsert new player if needed
  if (playerSelect === '__new__' && newName) {
    const { data: newPlayer, error: playerError } = await db
      .from('players')
      .upsert({ name: newName, avg_score: 40, rounds_played: 0, email, phone }, { onConflict: 'name' })
      .select('id')
      .single();

    if (playerError) {
      showError('Error creating player: ' + playerError.message);
      btn.disabled = false;
      btn.textContent = 'RSVP for This Round →';
      return;
    }
    playerId    = newPlayer.id;
    displayName = newName;
  } else if (playerId && !hasContact) {
    // Save contact info back to this player for next time
    await db.from('players').update({ email, phone }).eq('id', playerId);
  }

  // Insert RSVP
  const { error: rsvpError } = await db.from('rsvps').insert({
    round_id:  currentRound.id,
    player_id: playerId,
    name:      displayName,
    email,
    phone,
  });

  if (rsvpError) {
    if (rsvpError.code === '23505') {
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
