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
  const safeRole = ['commercial', 'procurement', 'admin', 'finance'].includes(role) ? role : 'procurement';
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

function mountSidebar(el) {
  // Brand
  const brand = document.createElement('a');
  brand.className = 'sidebar-brand';
  brand.href = 'dashboard.html';
  const logo = document.createElement('div');
  logo.className = 'sidebar-logo';
  logo.textContent = 'T';
  const brandName = document.createElement('span');
  brandName.textContent = 'Triana';
  brand.appendChild(logo);
  brand.appendChild(brandName);

  // Nav items
  const nav = document.createElement('nav');
  nav.className = 'sidebar-nav';
  const navItems = [
    { label: 'Dashboard',    icon: 'layout-dashboard', href: 'dashboard.html',    match: ['dashboard', ''] },
  ];
  if (!hasRole('commercial')) {
    navItems.push({ label: 'Fornecedores', icon: 'users',   href: 'suppliers.html', match: ['suppliers', 'supplier-detail'] });
    navItems.push({ label: 'Preços',       icon: 'search',  href: 'prices.html',    match: ['prices'] });
  }
  if (hasRole('admin')) navItems.push({ label: 'Admin', icon: 'settings', href: 'admin.html', match: ['admin'] });

  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || '';
  for (const item of navItems) {
    const a = document.createElement('a');
    a.className = 'sidebar-nav-item' + (item.match.includes(currentPage) ? ' active' : '');
    a.href = item.href;
    a.addEventListener('click', e => {
      const modalOpen = document.querySelector('.modal-overlay, [id$="Modal"][style*="flex"]');
      if (modalOpen) {
        e.preventDefault();
        if (confirm('Tens alterações não guardadas. Sair mesmo assim?')) {
          window.location.href = item.href;
        }
      }
    });
    const iconEl = document.createElement('i');
    iconEl.setAttribute('data-lucide', item.icon);
    const labelEl = document.createElement('span');
    labelEl.textContent = item.label;
    a.appendChild(iconEl);
    a.appendChild(labelEl);
    nav.appendChild(a);
  }

  // Footer: user + logout
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  mountUserChip(footer);

  el.appendChild(brand);
  el.appendChild(nav);
  el.appendChild(footer);

  // Render Lucide icons
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 0);
}
