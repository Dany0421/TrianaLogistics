let allProcesses = [];
let procUsers = [];
let _notifications = [];
let _notifOpen = false;
let _overdueCount = 0;

// ── Notifications ──
async function loadNotifications() {
  _notifications = await API.getMyNotifications();
  const unread = _notifications.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (badge) { badge.textContent = unread; badge.style.display = unread ? '' : 'none'; }
}

function toggleNotifPanel() {
  _notifOpen = !_notifOpen;
  const wrap = document.getElementById('notifWrap');
  document.getElementById('notifPanel')?.remove();
  if (!_notifOpen) return;
  const unread = _notifications.filter(n => !n.read);
  const panel = document.createElement('div');
  panel.className = 'notif-panel';
  panel.id = 'notifPanel';
  const header = document.createElement('div');
  header.className = 'notif-panel-header';
  const title = document.createElement('span');
  title.className = 'notif-panel-title';
  title.textContent = 'Notifica\u00e7\u00f5es';
  header.appendChild(title);
  if (unread.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Marcar lidas';
    btn.addEventListener('click', (e) => { e.stopPropagation(); markAllRead(); });
    header.appendChild(btn);
  }
  panel.appendChild(header);
  if (!_notifications.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'Sem notifica\u00e7\u00f5es.';
    panel.appendChild(empty);
  } else {
    for (const n of _notifications) {
      const item = document.createElement('div');
      item.className = 'notif-item' + (n.read ? '' : ' unread');
      const pid = n.process_id || '';
      item.addEventListener('click', () => goNotif(pid));
      const tEl = document.createElement('div');
      tEl.className = 'notif-item-title';
      tEl.textContent = n.title || '';
      item.appendChild(tEl);
      if (n.body) {
        const bEl = document.createElement('div');
        bEl.className = 'notif-item-body';
        bEl.textContent = n.body;
        item.appendChild(bEl);
      }
      const timeEl = document.createElement('div');
      timeEl.className = 'notif-item-time';
      timeEl.textContent = timeAgoNotif(n.created_at);
      item.appendChild(timeEl);
      panel.appendChild(item);
    }
  }
  wrap.appendChild(panel);
  if (unread.length) markAllRead();
  setTimeout(() => document.addEventListener('click', closeNotifOutside, { once: true }), 0);
}

function closeNotifOutside(e) {
  if (!document.getElementById('notifPanel')?.contains(e.target) &&
      !document.getElementById('notifWrap')?.contains(e.target)) {
    document.getElementById('notifPanel')?.remove();
    _notifOpen = false;
  }
}

async function markAllRead() {
  try {
    await API.markNotificationsRead();
    _notifications = _notifications.map(n => ({ ...n, read: true }));
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    const panel = document.getElementById('notifPanel');
    if (panel) panel.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
    const hdr = panel?.querySelector('.notif-panel-header button');
    if (hdr) hdr.remove();
  } catch(_) {}
}

function goNotif(processId) {
  document.getElementById('notifPanel')?.remove();
  _notifOpen = false;
  if (processId && UUID_RE.test(processId)) window.location.href = `process.html?id=${processId}`;
}

function timeAgoNotif(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d)) / 60000);
  if (diff < 1) return 'agora';
  if (diff < 60) return `${diff}m atr\u00e1s`;
  if (diff < 1440) return `${Math.floor(diff/60)}h atr\u00e1s`;
  return `${Math.floor(diff/1440)}d atr\u00e1s`;
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('searchInput').addEventListener('input', renderList);
  document.getElementById('filterStatus').addEventListener('change', renderList);
  document.getElementById('filterPriority').addEventListener('change', renderList);
  document.getElementById('chartsToggleRow').addEventListener('click', toggleCharts);
});

window.addEventListener('load', async () => {
  const auth = await requireAuth('index.html');
  if (!auth) return;
  // Bind early — do not wait for network; otherwise a hung/failed fetch blocks the button forever
  const createBtn = document.getElementById('createProcessBtn');
  if (createBtn) createBtn.addEventListener('click', () => openCreateModal());

  mountSidebar(document.getElementById('appSidebar'));
  const notifWrap = document.createElement('div');
  notifWrap.id = 'notifWrap';
  notifWrap.style.cssText = 'position:relative;display:inline-flex;margin-bottom:4px';
  const bell = document.createElement('div');
  bell.className = 'notif-bell';
  bell.title = 'Notifica\u00e7\u00f5es';
  bell.appendChild(licon('bell', 18));
  bell.addEventListener('click', toggleNotifPanel);
  const badge = document.createElement('span');
  badge.className = 'notif-badge';
  badge.id = 'notifBadge';
  badge.style.display = 'none';
  bell.appendChild(badge);
  notifWrap.appendChild(bell);
  const sidebarFooter = document.querySelector('.sidebar-footer');
  if (sidebarFooter) sidebarFooter.prepend(notifWrap);
  let topSuppliers = [];
  [procUsers, allProcesses] = await Promise.all([
    API.getProcurementUsers(),
    API.getProcesses(),
  ]);
  renderStats();
  renderList();
  const uniqueNames = [...new Set(allProcesses.map(p => p.procurement_name || p.assignee?.name).filter(Boolean))];
  if (hasRole('admin') && uniqueNames.length) {
    const filterBar = document.querySelector('.filter-bar');
    const newBtn = filterBar?.querySelector('#createProcessBtn')?.parentElement;
    if (filterBar && newBtn) {
      const sel = document.createElement('select');
      sel.id = 'filterAssignee';
      sel.style.maxWidth = '160px';
      sel.addEventListener('change', renderList);
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Todos os respons\u00e1veis';
      sel.appendChild(defaultOpt);
      for (const name of uniqueNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      filterBar.insertBefore(sel, newBtn);
    }
  }
  try { topSuppliers = await API.getTopSuppliers(); } catch(_) {}
  renderCharts(allProcesses, topSuppliers);
  if (!hasRole('commercial')) {
    try { renderFollowupAlerts(await API.getOverdueFollowups()); } catch(_) {}
    try { renderMarginAlerts(await API.getPendingMarginAlerts()); } catch(_) {}
  }
  try { await loadNotifications(); } catch(_) {}
});

async function loadProcesses() {
  try {
    allProcesses = await API.getProcesses();
    renderStats(); renderList();
  } catch(e) { showToast('Erro ao carregar processos: ' + e.message, true); }
}

// ── Charts ──
let _charts = {};
let chartsExpanded = false;
function toggleCharts() {
  chartsExpanded = !chartsExpanded;
  document.getElementById('chartsArrow').textContent = chartsExpanded ? '\u25bc' : '\u25b6';
  document.getElementById('chartsSection').style.display = chartsExpanded ? '' : 'none';
}
function renderCharts(processes, topSuppliers) {
  if (typeof Chart === 'undefined') return;
  if (!processes.length && !topSuppliers.length) return;
  document.getElementById('chartsToggleRow').style.display = 'flex';

  Chart.defaults.color = '#64748b';
  Chart.defaults.borderColor = '#1a2235';
  Chart.defaults.font.family = "'Figtree', sans-serif";

  const statuses = ['Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Pending margin','Closed','Cancelled'];
  const statusColors = ['#2563eb','#f59e0b','#22d3ee','#10b981','#7c3aed','#f97316','#64748b','#f87171'];
  const statusCounts = statuses.map(s => processes.filter(p => p.status === s).length);

  const priorities = ['Low','Medium','High','Urgent'];
  const priorityColors = ['#475569','#2563eb','#f59e0b','#f87171'];
  const priorityCounts = priorities.map(pr => processes.filter(p => p.priority === pr && p.status !== 'Closed' && p.status !== 'Cancelled').length);

  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - 3);

  function mondayOfWeekContaining(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const dow = x.getDay();
    const toMon = dow === 0 ? -6 : 1 - dow;
    x.setDate(x.getDate() + toMon);
    return x;
  }
  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  let mon = mondayOfWeekContaining(cutoff);

  const trendPeriods = [];
  while (mon.getTime() <= now.getTime()) {
    const endExclusive = addDays(mon, 14);
    trendPeriods.push({ start: new Date(mon.getTime()), endExclusive });
    mon = endExclusive;
  }

  const fmtDay = (d) => d.toLocaleString('pt-PT', { day: 'numeric', month: 'short' });
  const trendBuckets = trendPeriods.map((period) => {
    const lastSunday = addDays(period.start, 13);
    lastSunday.setHours(23, 59, 59, 999);
    return { label: `${fmtDay(period.start)} \u2013 ${fmtDay(lastSunday)}`, period };
  });
  const trendCounts = trendBuckets.map(({ period }) =>
    processes.filter((p) => {
      const t = new Date(p.created_at).getTime();
      if (t < cutoff.getTime() || t > now.getTime()) return false;
      return t >= period.start.getTime() && t < period.endExclusive.getTime();
    }).length
  );

  function destroyChart(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

  destroyChart('status');
  _charts.status = new Chart(document.getElementById('chartStatus'), {
    type: 'doughnut',
    data: { labels: statuses, datasets: [{ data: statusCounts, backgroundColor: statusColors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 }, padding: 10 } } },
    },
  });

  destroyChart('priority');
  _charts.priority = new Chart(document.getElementById('chartPriority'), {
    type: 'bar',
    data: { labels: priorities, datasets: [{ data: priorityCounts, backgroundColor: priorityColors, borderRadius: 6, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { ticks: { stepSize: 1 }, grid: { color: '#1a2235' } } },
    },
  });

  destroyChart('trend');
  _charts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels: trendBuckets.map((b) => b.label),
      datasets: [{
        data: trendCounts,
        borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)',
        fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#2563eb',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { ticks: { stepSize: 1 }, grid: { color: '#1a2235' }, beginAtZero: true },
      },
    },
  });

  destroyChart('suppliers');
  _charts.suppliers = new Chart(document.getElementById('chartSuppliers'), {
    type: 'bar',
    data: {
      labels: topSuppliers.map(s => s.name.length > 18 ? s.name.slice(0, 17) + '\u2026' : s.name),
      datasets: [{ data: topSuppliers.map(s => s.count), backgroundColor: '#7c3aed', borderRadius: 6, borderSkipped: false }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { stepSize: 1 }, grid: { color: '#1a2235' }, beginAtZero: true }, y: { grid: { display: false } } },
    },
  });
}

// ── Follow-up Alerts ──
let followupCollapsed = false;
function renderFollowupAlerts(data) {
  _overdueCount = data.length;
  renderStats();
  const banner = document.getElementById('followupBanner');
  if (!data.length) { banner.style.display = 'none'; return; }
  const today = new Date(); today.setHours(0,0,0,0);
  banner.style.display = '';
  banner.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'followup-banner';

  const hdr = document.createElement('div');
  hdr.className = 'followup-banner-header';
  hdr.addEventListener('click', () => {
    followupCollapsed = !followupCollapsed;
    const fr = document.getElementById('followupRows');
    if (fr) fr.style.display = followupCollapsed ? 'none' : '';
  });
  const title = document.createElement('div');
  title.className = 'followup-banner-title';
  title.appendChild(document.createTextNode('\u26A0 Follow-ups em atraso '));
  const cnt = document.createElement('span');
  cnt.className = 'followup-count';
  cnt.textContent = String(data.length);
  title.appendChild(cnt);
  const caret = document.createElement('span');
  caret.style.cssText = "font-size:11px;color:var(--muted);font-family:'DM Mono',monospace";
  caret.textContent = '\u25BE';
  hdr.appendChild(title);
  hdr.appendChild(caret);

  const byProc = new Map();
  for (const s of data) {
    const pid = s.processes?.id || '__none__';
    if (!byProc.has(pid)) byProc.set(pid, { proc: s.processes, suppliers: [] });
    byProc.get(pid).suppliers.push(s);
  }

  const rowsEl = document.createElement('div');
  rowsEl.className = 'followup-rows';
  rowsEl.id = 'followupRows';

  for (const [pid, group] of byProc) {
    const procRow = document.createElement('div');
    procRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-radius:6px;background:var(--surface2);user-select:none';

    const procArrow = document.createElement('span');
    procArrow.style.cssText = "font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;flex-shrink:0";
    procArrow.textContent = '\u25B6';

    const procName = document.createElement('span');
    procName.style.cssText = 'font-size:13px;font-weight:600;color:#fff;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    procName.textContent = (group.proc?.project_name || '\u2014') + (group.proc?.client_name ? ' \u00b7 ' + group.proc.client_name : '');

    const procBadge = document.createElement('span');
    procBadge.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:#fbbf24;flex-shrink:0";
    procBadge.textContent = group.suppliers.length + ' forn.';

    procRow.appendChild(procArrow);
    procRow.appendChild(procName);
    procRow.appendChild(procBadge);

    const suppList = document.createElement('div');
    suppList.style.cssText = 'display:none;flex-direction:column;gap:4px;margin:4px 0 6px 12px';

    for (const s of group.suppliers) {
      const due = new Date(s.next_followup_at);
      const days = Math.round((today - due) / 86400000);
      const label = days === 0 ? 'hoje' : days + 'd em atraso';
      const row = document.createElement('div');
      row.className = 'followup-row';
      row.addEventListener('click', e => {
        e.stopPropagation();
        if (pid !== '__none__' && /^[0-9a-f-]{36}$/i.test(pid))
          window.location.href = 'process.html?id=' + pid;
      });
      const sp1 = document.createElement('span');
      sp1.className = 'followup-supplier';
      sp1.textContent = s.name || '';
      const sp3 = document.createElement('span');
      sp3.className = 'followup-overdue';
      sp3.textContent = label;
      row.appendChild(sp1);
      row.appendChild(sp3);
      suppList.appendChild(row);
    }

    let expanded = false;
    procRow.addEventListener('click', () => {
      expanded = !expanded;
      procArrow.textContent = expanded ? '\u25BC' : '\u25B6';
      suppList.style.display = expanded ? 'flex' : 'none';
    });

    rowsEl.appendChild(procRow);
    rowsEl.appendChild(suppList);
  }

  wrap.appendChild(hdr);
  wrap.appendChild(rowsEl);
  banner.appendChild(wrap);
}

// ── Pending Margin Alerts ──
let marginAlertCollapsed = false;
function renderMarginAlerts(data) {
  const banner = document.getElementById('marginAlertBanner');
  if (!data.length) { banner.style.display = 'none'; return; }
  banner.style.display = '';
  banner.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'margin-alert-banner';

  const hdr = document.createElement('div');
  hdr.className = 'followup-banner-header';
  hdr.addEventListener('click', () => {
    marginAlertCollapsed = !marginAlertCollapsed;
    rowsEl.style.display = marginAlertCollapsed ? 'none' : '';
  });

  const title = document.createElement('div');
  title.className = 'margin-alert-title';
  title.appendChild(document.createTextNode('⏳ Margin pendente — follow-up '));
  const cnt = document.createElement('span');
  cnt.className = 'margin-alert-count';
  cnt.textContent = String(data.length);
  title.appendChild(cnt);

  const caret = document.createElement('span');
  caret.style.cssText = "font-size:11px;color:var(--muted);font-family:'DM Mono',monospace";
  caret.textContent = '▾';

  hdr.appendChild(title);
  hdr.appendChild(caret);

  const rowsEl = document.createElement('div');
  rowsEl.className = 'followup-rows';

  for (const p of data) {
    const row = document.createElement('div');
    row.className = 'margin-alert-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'margin-alert-name';
    nameEl.textContent = (p.project_name || '—') + (p.client_name ? ' · ' + p.client_name : '');

    const ageEl = document.createElement('span');
    ageEl.className = 'margin-alert-age';
    const ref = p.last_margin_followup_at ? new Date(p.last_margin_followup_at) : null;
    if (ref) {
      const hours = Math.floor((Date.now() - ref) / 3600000);
      ageEl.textContent = hours >= 48 ? Math.floor(hours / 24) + 'd sem follow-up' : hours + 'h sem follow-up';
    } else {
      ageEl.textContent = 'sem follow-up';
    }

    const btn = document.createElement('button');
    btn.className = 'margin-followup-btn';
    btn.type = 'button';
    btn.textContent = 'Já fiz follow-up';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = '✓ Registado';
      try {
        await API.markMarginFollowup(p.id);
        const fresh = await API.getPendingMarginAlerts();
        renderMarginAlerts(fresh);
      } catch(_) { btn.disabled = false; btn.textContent = 'Já fiz follow-up'; }
    });

    row.addEventListener('click', () => {
      if (UUID_RE.test(p.id)) window.location.href = 'process.html?id=' + p.id;
    });

    row.appendChild(nameEl);
    row.appendChild(ageEl);
    row.appendChild(btn);
    rowsEl.appendChild(row);
  }

  wrap.appendChild(hdr);
  wrap.appendChild(rowsEl);
  banner.appendChild(wrap);
}

// ── Stats ──
function renderStats() {
  const total    = allProcesses.length;
  const active   = allProcesses.filter(p => p.status !== 'Closed' && p.status !== 'Cancelled').length;
  const waiting  = allProcesses.filter(p => p.status === 'Waiting for suppliers' || p.status === 'Waiting for internal info').length;
  const ready    = allProcesses.filter(p => p.status === 'Ready for Excel').length;
  const urgent   = allProcesses.filter(p => p.priority === 'Urgent').length;

  const statsGrid = document.getElementById('statsGrid');
  statsGrid.replaceChildren();
  function addStatCard(onClick, num, label, numStyle, cardStyle) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    if (cardStyle) card.style.cssText = cardStyle;
    card.addEventListener('click', onClick);
    const numEl = document.createElement('div');
    numEl.className = 'stat-number';
    if (numStyle) numEl.style.cssText = numStyle;
    numEl.textContent = String(num);
    const lbl = document.createElement('div');
    lbl.className = 'stat-label';
    lbl.textContent = label;
    card.appendChild(numEl);
    card.appendChild(lbl);
    statsGrid.appendChild(card);
  }
  addStatCard(() => setFilter(''), total, 'Total', '', '');
  addStatCard(() => setFilter(''), active, 'Em aberto', 'color:var(--accent)', '');
  addStatCard(() => setFilter('Waiting for internal info'), waiting, 'A aguardar', 'color:#4fc3f7', '');
  addStatCard(() => setFilter('Ready for Excel'), ready, 'Prontos Excel', 'color:var(--accent)', '');
  addStatCard(() => setFilterPriority('Urgent'), urgent, 'Urgentes', 'color:var(--danger)', '');
  addStatCard(
    () => document.getElementById('followupBanner').scrollIntoView({ behavior: 'smooth' }),
    _overdueCount,
    'Follow-ups',
    'color:' + (_overdueCount > 0 ? '#fbbf24' : 'var(--muted)'),
    'cursor:' + (_overdueCount > 0 ? 'pointer' : 'default')
  );
  renderUserStats();
}

function renderUserStats() {
  const section = document.getElementById('userStatsSection');
  const statNames = [...new Set(allProcesses.map(p => p.procurement_name || p.assignee?.name).filter(Boolean))];
  if (!section || !hasRole('admin') || !statNames.length) { if (section) section.style.display = 'none'; return; }

  const openByUser = {};
  for (const p of allProcesses) {
    const name = p.procurement_name || p.assignee?.name;
    if (!name || p.status === 'Closed' || p.status === 'Cancelled') continue;
    openByUser[name] = (openByUser[name] || 0) + 1;
  }

  const avgByUser = {};
  for (const p of allProcesses) {
    const name = p.procurement_name || p.assignee?.name;
    if (p.status !== 'Closed' || !p.closed_at || !name) continue;
    const hours = (new Date(p.closed_at) - new Date(p.created_at)) / 3600000;
    if (hours < 0 || hours > 730 * 24) continue;
    if (!avgByUser[name]) avgByUser[name] = [];
    avgByUser[name].push(hours);
  }

  section.style.display = '';
  while (section.firstChild) section.removeChild(section.firstChild);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:20px';

  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 6px;cursor:pointer;color:var(--muted);border-top:1px solid var(--border);user-select:none';

  const arrow = document.createElement('span');
  arrow.style.cssText = 'font-size:10px';
  arrow.textContent = userStatsExpanded ? '\u25bc' : '\u25b6';

  const label = document.createElement('span');
  label.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.5px;text-transform:uppercase";
  label.textContent = 'Carga por Respons\u00e1vel (' + statNames.length + ')';

  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  grid.style.cssText = 'margin-bottom:0;margin-top:6px;' + (userStatsExpanded ? '' : 'display:none');

  toggleRow.addEventListener('click', () => {
    userStatsExpanded = !userStatsExpanded;
    arrow.textContent = userStatsExpanded ? '\u25bc' : '\u25b6';
    grid.style.display = userStatsExpanded ? '' : 'none';
  });

  toggleRow.appendChild(arrow);
  toggleRow.appendChild(label);

  for (const name of statNames) {
    const open = openByUser[name] || 0;
    const closedVals = avgByUser[name] || [];
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.style.cursor = 'pointer';
    card.title = 'Filtrar por ' + name;
    card.addEventListener('click', () => {
      const sel = document.getElementById('filterAssignee');
      if (sel) { sel.value = name; renderList(); }
    });

    const numDiv = document.createElement('div');
    numDiv.className = 'stat-number';
    numDiv.style.color = 'var(--text)';
    numDiv.textContent = String(open);

    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-label';
    labelDiv.textContent = name;

    const subDiv = document.createElement('div');
    subDiv.style.cssText = "font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:4px";
    if (closedVals.length) {
      const avg = closedVals.reduce((a, b) => a + b, 0) / closedVals.length;
      subDiv.textContent = 'm\u00e9dia ' + Math.round(avg) + 'h \u00b7 ' + closedVals.length + ' fechados';
    } else {
      subDiv.textContent = 'sem hist\u00f3rico';
    }

    card.appendChild(numDiv);
    card.appendChild(labelDiv);
    card.appendChild(subDiv);
    grid.appendChild(card);
  }

  wrap.appendChild(toggleRow);
  wrap.appendChild(grid);
  section.appendChild(wrap);
}

function setFilter(val) {
  document.getElementById('filterStatus').value = val;
  renderList();
}
function setFilterPriority(val) {
  document.getElementById('filterPriority').value = val;
  renderList();
}

// ── Process list ──
const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
let closedExpanded = false;
let userStatsExpanded = false;

function buildProcessRow(p) {
  const row = document.createElement('div');
  row.className = 'process-row';
  row.addEventListener('click', () => goToProcess(p.id));
  const col = document.createElement('div');
  const pn = document.createElement('div');
  pn.className = 'process-name';
  pn.textContent = p.project_name || '';
  const pc = document.createElement('div');
  pc.className = 'process-client';
  pc.textContent = p.client_name || '';
  col.appendChild(pn);
  col.appendChild(pc);
  const pri = document.createElement('span');
  if (p.status === 'Closed' || !p.priority) {
    pri.style.cssText = 'font-size:12px;color:var(--muted)';
    pri.textContent = '\u2014';
  } else {
    pri.className = 'priority-' + p.priority.toLowerCase();
    pri.style.cssText = "font-family:'DM Mono',monospace;font-size:12px";
    pri.textContent = p.priority;
  }
  const st = document.createElement('span');
  applyStatusBadge(st, p.status, p.status_color);
  st.textContent = p.status || 'Active';
  const dl = document.createElement('span');
  dl.className = 'deadline-chip ' + deadlineClass(p.deadline);
  dl.textContent = p.deadline ? fmtDate(p.deadline) : '\u2014';
  const procName = p.procurement_name || p.assignee?.name || null;
  let assigneeEl;
  if (procName) {
    assigneeEl = document.createElement('span');
    assigneeEl.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.25);border-radius:4px;padding:2px 9px";
    assigneeEl.textContent = procName;
  } else {
    assigneeEl = document.createElement('span');
    assigneeEl.style.cssText = 'font-size:11px;color:var(--muted)';
    assigneeEl.textContent = '\u2014';
  }
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px';
  actions.addEventListener('click', (e) => e.stopPropagation());
  const b1 = document.createElement('button');
  b1.type = 'button';
  b1.className = 'btn btn-ghost btn-sm';
  b1.textContent = 'Editar';
  b1.addEventListener('click', () => openCreateModal(p.id));
  const b2 = document.createElement('button');
  b2.type = 'button';
  b2.className = 'btn btn-ghost btn-sm';
  b2.textContent = 'Clone';
  b2.addEventListener('click', () => openCloneModal(p.id));
  const b3 = document.createElement('button');
  b3.type = 'button';
  b3.className = 'btn btn-danger btn-sm';
  b3.textContent = '\u00d7';
  b3.addEventListener('click', () => confirmDelete(p.id));
  actions.appendChild(b1);
  actions.appendChild(b2);
  actions.appendChild(b3);
  row.appendChild(col);
  row.appendChild(pri);
  row.appendChild(st);
  row.appendChild(dl);
  row.appendChild(assigneeEl);
  row.appendChild(actions);
  return row;
}

function renderList() {
  const q  = document.getElementById('searchInput').value.toLowerCase().trim();
  const fs = document.getElementById('filterStatus').value;
  const fp = document.getElementById('filterPriority').value;

  let list = [...allProcesses];
  if (q)  list = list.filter(p => p.client_name?.toLowerCase().includes(q) || p.project_name?.toLowerCase().includes(q));
  if (fs) list = list.filter(p => p.status === fs);
  if (fp) list = list.filter(p => p.priority === fp);
  const fa = document.getElementById('filterAssignee')?.value || '';
  if (fa) list = list.filter(p => (p.procurement_name || p.assignee?.name || '') === fa);

  const activePart = list.filter(p => p.status !== 'Closed' && p.status !== 'Cancelled');
  const closedPart = list.filter(p => p.status === 'Closed' || p.status === 'Cancelled');

  activePart.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) || new Date(a.deadline||'9999') - new Date(b.deadline||'9999'));
  closedPart.sort((a, b) => new Date(b.closed_at || b.created_at) - new Date(a.closed_at || a.created_at));

  const el = document.getElementById('processList');
  el.replaceChildren();

  if (!activePart.length && !closedPart.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.appendChild(document.createTextNode('Sem processos encontrados.'));
    empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('Clica em "+ Novo Processo" para come\u00e7ar.'));
    el.appendChild(empty);
    return;
  }

  const listWrap = document.createElement('div');
  listWrap.className = 'process-list';
  for (const p of activePart) listWrap.appendChild(buildProcessRow(p));
  el.appendChild(listWrap);

  if (closedPart.length) {
    const closedSection = document.createElement('div');
    closedSection.style.cssText = 'margin-top:12px';

    const toggleRow = document.createElement('div');
    toggleRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 6px;cursor:pointer;color:var(--muted);border-top:1px solid var(--border);user-select:none';
    toggleRow.addEventListener('click', () => {
      closedExpanded = !closedExpanded;
      arrow.textContent = closedExpanded ? '\u25bc' : '\u25b6';
      closedList.style.display = closedExpanded ? '' : 'none';
    });
    const arrow = document.createElement('span');
    arrow.style.cssText = 'font-size:10px';
    arrow.textContent = closedExpanded ? '\u25bc' : '\u25b6';
    const label = document.createElement('span');
    label.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.5px;text-transform:uppercase";
    label.textContent = 'Fechados / Cancelados (' + closedPart.length + ')';
    toggleRow.appendChild(arrow);
    toggleRow.appendChild(label);

    const closedList = document.createElement('div');
    closedList.className = 'process-list';
    closedList.style.cssText = 'margin-top:6px;opacity:.7;' + (closedExpanded ? '' : 'display:none');
    for (const p of closedPart) closedList.appendChild(buildProcessRow(p));

    closedSection.appendChild(toggleRow);
    closedSection.appendChild(closedList);
    el.appendChild(closedSection);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function goToProcess(id) {
  if (!UUID_RE.test(id)) return;
  window.location.href = `process.html?id=${id}`;
}

// ── Process tag input (categories) ──
let _pendingProcCats = null;
function renderProcTagBox(boxId, arr) {
  const box = document.getElementById(boxId);
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  arr.forEach((c, i) => {
    const span = document.createElement('span');
    span.className = 'tag-chip';
    span.textContent = c;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '\u00d7';
    btn.onclick = () => removeProcTag(boxId, i);
    span.appendChild(btn);
    box.appendChild(span);
  });
  const inp = document.createElement('input');
  inp.className = 'tag-input-field';
  inp.placeholder = 'Adicionar, Enter para confirmar...';
  inp.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = this.value.trim().replace(/,/g, '');
      if (!val || pendingProcessCategories.includes(val)) return;
      pendingProcessCategories.push(val);
      renderProcTagBox(boxId, pendingProcessCategories);
      document.querySelector('#' + boxId + ' .tag-input-field')?.focus();
    }
  };
  box.appendChild(inp);
}
function removeProcTag(boxId, idx) {
  pendingProcessCategories.splice(idx, 1);
  renderProcTagBox(boxId, pendingProcessCategories);
}

// ── Create / Edit modal ──
let editingProcessId = null;
let pendingProcessCategories = [];

function openCreateModal(id = null) {
  if (id && !UUID_RE.test(id)) return;
  editingProcessId = id;
  const p = id ? allProcesses.find(x => x.id === id) : null;
  pendingProcessCategories = p ? [...(p.categories || [])] : [];
  showModal(`
    <div class="modal-tag">${p ? 'Editar Processo' : 'Novo Processo'}</div>
    <div class="modal-title">${p ? esc(p.project_name) : 'Criar Processo'}</div>
    <div class="form-grid-2">
      <div><label>Nome do Cliente</label><input id="f_client" value="" placeholder="Ex: Banco BCI"></div>
      <div><label>Nome do Projeto</label><input id="f_project" value="" placeholder="Ex: Upgrade Server Room"></div>
    </div>
    <div class="form-grid-2">
      <div><label>Deadline</label><input type="date" id="f_deadline" value="${esc(p?.deadline||'')}"></div>
      <div><label>Prioridade</label>
        ${(p?.status === 'Closed' || p?.status === 'Cancelled')
          ? `<input type="hidden" id="f_priority" value=""><div style="padding:10px 13px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;color:var(--muted);font-size:14px">\u2014</div>`
          : `<select id="f_priority">${['Low','Medium','High','Urgent'].map(v => `<option ${(p?.priority||'Medium')===v?'selected':''}>${v}</option>`).join('')}</select>`}
      </div>
    </div>
    ${p ? `<div class="form-row"><label>Estado</label>
      <select id="f_status">
        ${STANDARD_STATUSES.map(v=>`<option ${p.status===v?'selected':''}>${v}</option>`).join('')}
        ${!STANDARD_STATUSES.includes(p.status) ? `<option value="${esc(p.status)}" selected>${esc(p.status)}</option>` : ''}
        <option value="__custom__">+ Criar estado...</option>
      </select>
      <div id="f_custom_row" style="display:${!STANDARD_STATUSES.includes(p.status)?'flex':'none'};gap:8px;margin-top:6px;align-items:center">
        <input type="text" id="f_custom_name" placeholder="Nome do estado" style="flex:1" value="${!STANDARD_STATUSES.includes(p.status)?esc(p.status):''}">
        <input type="color" id="f_custom_color" value="${p.status_color||'#2563eb'}" style="width:40px;height:36px;padding:2px;cursor:pointer">
      </div></div>` : ''}
    <div class="form-row"><label>Procurement respons\u00e1vel</label><input type="text" id="f_procurement" placeholder="Nome do respons\u00e1vel" value="${esc(p?.procurement_name || p?.assignee?.name || '')}"></div>
    <div class="form-row"><label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipo de projeto \u2014 opcional)</span></label><div class="tag-input-box" id="f_catBox"></div></div>
    <div class="form-row"><label>Comercial respons\u00e1vel</label><input type="text" id="f_commercial" placeholder="Nome do comercial" value="${esc(p?.commercial_name||'')}"></div>
    <div class="form-row"><label>Notas</label><textarea id="f_notes" placeholder="Observa\u00e7\u00f5es..."></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost">Cancelar</button>
      <button class="btn btn-primary">Guardar</button>
    </div>
  `);
  const actions = document.querySelector('#modalRoot .modal-actions');
  actions.querySelector('.btn-ghost').addEventListener('click', closeModal);
  actions.querySelector('.btn-primary').addEventListener('click', saveProcess);

  const _fc = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v == null ? '' : String(v); };
  _fc('f_client', p?.client_name || '');
  _fc('f_project', p?.project_name || '');
  _fc('f_notes', p?.notes || '');
  renderProcTagBox('f_catBox', pendingProcessCategories);
  const fStatusSel = document.getElementById('f_status');
  if (fStatusSel) {
    fStatusSel.addEventListener('change', function() {
      document.getElementById('f_custom_row').style.display = this.value === '__custom__' ? 'flex' : 'none';
    });
  }
}

async function saveProcess() {
  const fields = {
    client_name:  document.getElementById('f_client').value.trim(),
    project_name: document.getElementById('f_project').value.trim(),
    deadline:     document.getElementById('f_deadline').value || null,
    priority:     document.getElementById('f_priority').value || null,
    notes:        document.getElementById('f_notes').value.trim(),
    commercial_name: document.getElementById('f_commercial')?.value.trim() || null,
    procurement_name: document.getElementById('f_procurement')?.value.trim() || null,
    assigned_to: null,
    categories:   pendingProcessCategories,
  };
  const statusEl = document.getElementById('f_status');
  if (statusEl) {
    if (statusEl.value === '__custom__' || !STANDARD_STATUSES.includes(statusEl.value)) {
      fields.status = statusEl.value === '__custom__'
        ? (document.getElementById('f_custom_name').value.trim() || 'Custom').slice(0, 100)
        : statusEl.value;
      fields.status_color = document.getElementById('f_custom_color').value;
    } else {
      fields.status = statusEl.value;
      fields.status_color = null;
    }
  }
  if (fields.status === 'Closed' || fields.status === 'Cancelled') {
    if (fields.status === 'Closed') {
      const prev = editingProcessId ? allProcesses.find(x => x.id === editingProcessId) : null;
      if (!prev || prev.status !== 'Closed') fields.closed_at = new Date().toISOString();
    }
    fields.priority = null;
  }
  if (fields.status === 'Pending margin') {
    const prev = editingProcessId ? allProcesses.find(x => x.id === editingProcessId) : null;
    if (!prev || prev.status !== 'Pending margin') fields.last_margin_followup_at = new Date().toISOString();
  }

  if (!fields.client_name || !fields.project_name) { showToast('Cliente e Projeto s\u00e3o obrigat\u00f3rios.', true); return; }
  if (fields.client_name.length > 200 || fields.project_name.length > 200) { showToast('Nome demasiado longo (m\u00e1x 200 caracteres).', true); return; }
  if (fields.notes && fields.notes.length > 5000) { showToast('Notas demasiado longas (m\u00e1x 5000 caracteres).', true); return; }

  try {
    if (editingProcessId) {
      await API.updateProcess(editingProcessId, fields);
      showToast('Processo atualizado.');
    } else {
      const proc = await API.createProcess(fields);
      showToast('Processo criado.');
      closeModal();
      await loadProcesses();
      window.location.href = `process.html?id=${proc.id}&new=1`;
      return;
    }
    closeModal();
    await loadProcesses();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

async function confirmDelete(id) {
  if (!UUID_RE.test(id)) return;
  const p = allProcesses.find(x => x.id === id);
  showModal(`
    <div class="modal-tag">Confirmar</div>
    <div class="modal-title">Apagar Processo</div>
    <div style="color:var(--muted);font-size:14px;margin-bottom:24px">Apagar "<strong style="color:#fff">${esc(p?.project_name)}</strong>"? Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost">Cancelar</button>
      <button class="btn btn-danger">Apagar</button>
    </div>
  `);
  const actions = document.querySelector('#modalRoot .modal-actions');
  actions.querySelector('.btn-ghost').addEventListener('click', closeModal);
  actions.querySelector('.btn-danger').addEventListener('click', () => doDelete(id));
}

async function doDelete(id) {
  if (!UUID_RE.test(id)) return;
  try {
    await API.deleteProcess(id);
    closeModal();
    showToast('Processo apagado.');
    await loadProcesses();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Clone ──
function openCloneModal(id) {
  if (!UUID_RE.test(id)) return;
  const p = allProcesses.find(x => x.id === id);
  showModal(`
    <div class="modal-tag">Clonar Processo</div>
    <div class="modal-title">Duplicar "${esc(p.project_name)}"</div>
    <div class="form-grid-2">
      <div><label>Nome do Projeto</label><input id="cl_project" value=""></div>
      <div><label>Cliente</label><input id="cl_client" value=""></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;margin:16px 0">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
        <input type="checkbox" id="cl_bom" checked> Copiar itens do BOM
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
        <input type="checkbox" id="cl_sup" checked> Copiar fornecedores
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)" id="cl_quot_row">
        <input type="checkbox" id="cl_quot" checked> Copiar cota\u00e7\u00f5es e pre\u00e7os
      </label>
    </div>
    <div class="form-row" style="margin-top:4px">
      <label>Procurement respons\u00e1vel (opcional)</label>
      <input type="text" id="cl_procurement" placeholder="Nome do respons\u00e1vel" value="${esc(p?.procurement_name || p?.assignee?.name || '')}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost">Cancelar</button>
      <button class="btn btn-primary">Clonar</button>
    </div>
  `);
  document.getElementById('cl_bom').addEventListener('change', updateCloneUI);
  document.getElementById('cl_sup').addEventListener('change', updateCloneUI);
  const actions = document.querySelector('#modalRoot .modal-actions');
  actions.querySelector('.btn-ghost').addEventListener('click', closeModal);
  actions.querySelector('.btn-primary').addEventListener('click', () => doClone(id));

  const clp = document.getElementById('cl_project');
  const clc = document.getElementById('cl_client');
  if (clp) clp.value = (p.project_name || '') + ' [Clone]';
  if (clc) clc.value = p.client_name || '';
}

function updateCloneUI() {
  const supChecked = document.getElementById('cl_sup').checked;
  const quotRow = document.getElementById('cl_quot_row');
  const quotCb  = document.getElementById('cl_quot');
  quotRow.style.opacity       = supChecked ? '1' : '.35';
  quotRow.style.pointerEvents = supChecked ? '' : 'none';
  if (!supChecked) quotCb.checked = false;
}

async function doClone(sourceId) {
  if (!UUID_RE.test(sourceId)) return;
  const project_name   = document.getElementById('cl_project').value.trim();
  const client_name    = document.getElementById('cl_client').value.trim();
  const copyBom        = document.getElementById('cl_bom').checked;
  const copySuppliers  = document.getElementById('cl_sup').checked;
  const copyQuotations = document.getElementById('cl_quot').checked;

  if (!project_name || !client_name) { showToast('Preenche nome e cliente.', true); return; }
  if (project_name.length > 200 || client_name.length > 200) { showToast('Nome demasiado longo.', true); return; }

  const src = allProcesses.find(x => x.id === sourceId);
  const fields = {
    project_name,
    client_name,
    priority: src.priority || 'Medium',
    status:   'Active',
    notes:    src.notes || null,
    deadline: null,
    procurement_name: document.getElementById('cl_procurement')?.value.trim() || null,
  };

  try {
    const newProc = await API.cloneProcess(sourceId, fields, { copyBom, copySuppliers, copyQuotations });
    closeModal();
    showToast('Processo clonado.');
    window.location.href = `process.html?id=${newProc.id}`;
  } catch(e) { showToast('Erro ao clonar: ' + e.message, true); }
}

// ── Modal helpers ──
function showModal(html) {
  const root = document.getElementById('modalRoot');
  root.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const box = document.createElement('div');
  box.className = 'modal-box';
  box.appendChild(document.createRange().createContextualFragment(html));
  overlay.appendChild(box);
  root.appendChild(overlay);
}
function closeModal() {
  document.getElementById('modalRoot').replaceChildren();
}

// ── Helpers ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d) { if (!d) return '\u2014'; const dt = new Date(d); return dt.toLocaleDateString('pt-PT'); }
function deadlineClass(d) {
  if (!d) return '';
  const diff = (new Date(d) - new Date()) / 86400000;
  if (diff < 0) return 'overdue';
  if (diff < 5) return 'soon';
  return '';
}
const STANDARD_STATUSES = ['Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Pending margin','Closed','Cancelled'];
function statusBadgeClass(s) {
  const map = {
    'Active':'badge-active','Waiting for suppliers':'badge-waiting','Waiting for internal info':'badge-waiting',
    'Partial responses':'badge-partial','Ready for Excel':'badge-ready','Pending margin':'badge-pending-margin','Closed':'badge-closed','Cancelled':'badge-cancelled'
  };
  return map[s] || 'badge-active';
}
function applyStatusBadge(el, status, color) {
  if (color) {
    const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
    el.className = 'badge';
    el.style.background = `rgba(${r},${g},${b},.1)`;
    el.style.color = color;
    el.style.border = `1px solid rgba(${r},${g},${b},.3)`;
  } else {
    el.className = 'badge ' + statusBadgeClass(status);
    el.style.background = '';
    el.style.color = '';
    el.style.border = '';
  }
}
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
  el.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}
document.addEventListener('DOMContentLoaded', () => lucide.createIcons());
