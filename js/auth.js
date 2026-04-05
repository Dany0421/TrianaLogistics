// ── Auth helpers ──

let currentUser = null;
let currentProfile = null;

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
let _inactivityTimer = null;

async function requireAuth(redirectTo = 'index.html') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = redirectTo; return null; }

  // Check absolute session age
  const issuedAt = session.access_token
    ? JSON.parse(atob(session.access_token.split('.')[1])).iat * 1000
    : 0;
  if (issuedAt && Date.now() - issuedAt > SESSION_TIMEOUT_MS) {
    await supabase.auth.signOut();
    window.location.href = redirectTo;
    return null;
  }

  currentUser = session.user;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();

  if (!profile) {
    await supabase.auth.signOut();
    window.location.href = redirectTo;
    return null;
  }

  currentProfile = profile;
  _startInactivityTimer(redirectTo);

  return { user: currentUser, profile };
}

function _startInactivityTimer(redirectTo) {
  const reset = () => {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(async () => {
      await supabase.auth.signOut();
      window.location.href = redirectTo;
    }, INACTIVITY_TIMEOUT_MS);
  };
  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, reset, { passive: true })
  );
  reset();
}

async function logout() {
  clearTimeout(_inactivityTimer);
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

/** Appends user chip + logout. Caller should clear the container first when replacing bar contents. */
function mountUserChip(container) {
  const name = currentProfile?.name || currentUser?.email?.split('@')[0] || '—';
  const role = currentProfile?.role || 'procurement';
  const safeRole = ['commercial', 'procurement', 'admin'].includes(role) ? role : 'procurement';
  const spanName = document.createElement('span');
  spanName.className = 'user-chip';
  spanName.textContent = name;
  const spanRole = document.createElement('span');
  spanRole.className = 'role-chip role-' + safeRole;
  spanRole.textContent = safeRole;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = 'Sair';
  btn.addEventListener('click', () => { logout(); });
  container.appendChild(spanName);
  container.appendChild(spanRole);
  container.appendChild(btn);
}

function hasRole(...roles) {
  return roles.includes(currentProfile?.role);
}
