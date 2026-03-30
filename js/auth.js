// ── Auth helpers ──

let currentUser = null;
let currentProfile = null;

async function requireAuth(redirectTo = 'index.html') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = redirectTo; return null; }
  currentUser = session.user;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  return { user: currentUser, profile };
}

async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

function renderUserChip() {
  const name = currentProfile?.name || currentUser?.email?.split('@')[0] || '—';
  const role = currentProfile?.role || 'procurement';
  return `
    <span class="user-chip">${name}</span>
    <span class="role-chip role-${role}">${role}</span>
    <button class="btn btn-ghost btn-sm" onclick="logout()">Sair</button>
  `;
}

function hasRole(...roles) {
  return roles.includes(currentProfile?.role);
}
