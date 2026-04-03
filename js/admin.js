let logOffset = 0;
const LOG_LIMIT = 100;
let filterTimeout = null;
let allEntries = [];

// ── Time helpers ──
function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)     return `há ${diff}s`;
  if (diff < 3600)   return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400)  return `há ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `há ${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fullDate(iso) {
  return new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Badge ──
function badgeClass(table) {
  if (table === 'processes')                               return 'log-badge-process';
  if (table === 'suppliers' || table === 'quotation_items') return 'log-badge-supplier';
  if (table === 'bom_versions' || table === 'bom_items')   return 'log-badge-bom';
  if (table === 'item_matches' || table === 'selected_offers') return 'log-badge-offer';
  if (table === 'profiles')                                return 'log-badge-profile';
  return 'log-badge-process';
}

function badgeLabel(table) {
  const map = {
    processes:       'Processo',
    suppliers:       'Fornecedor',
    quotation_items: 'Cotação',
    bom_versions:    'BOM',
    bom_items:       'BOM Item',
    item_matches:    'Match',
    selected_offers: 'Oferta',
    profiles:        'Perfil',
  };
  return map[table] || table;
}

// ── Event descriptions (PT) ──
function esc(v) {
  if (v == null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtPrice(val, currency) {
  if (val == null) return '—';
  const fmt = Number(val).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${fmt} ${currency}` : fmt;
}

function diffFields(old_, new_, fields) {
  const parts = [];
  for (const [key, label] of fields) {
    const ov = old_?.[key];
    const nv = new_?.[key];
    if (ov !== nv && (ov != null || nv != null)) {
      parts.push(`${label}: <strong>${esc(ov) || '—'}</strong> → <strong>${esc(nv) || '—'}</strong>`);
    }
  }
  return parts;
}

function describeEvent(log) {
  const { action, table_name: t, old_data: old_, new_data: new_ } = log;
  const d = action === 'DELETE' ? old_ : new_;

  if (t === 'processes') {
    if (action === 'INSERT') {
      return `Criou o processo <strong>${esc(d?.project_name)}</strong> para o cliente <strong>${esc(d?.client_name)}</strong>`;
    }
    if (action === 'DELETE') {
      return `Apagou o processo <strong>${esc(d?.project_name)}</strong> (cliente: ${esc(d?.client_name)})`;
    }
    if (action === 'UPDATE') {
      const diffs = diffFields(old_, new_, [
        ['status',      'Estado'],
        ['priority',    'Prioridade'],
        ['deadline',    'Prazo'],
        ['notes',       'Notas'],
        ['project_name','Nome do projeto'],
        ['client_name', 'Cliente'],
      ]);
      if (diffs.length) return `Atualizou processo <strong>${esc(new_?.project_name || old_?.project_name)}</strong>: ${diffs.join('; ')}`;
      return `Atualizou processo <strong>${esc(new_?.project_name || old_?.project_name)}</strong>`;
    }
  }

  if (t === 'suppliers') {
    if (action === 'INSERT') return `Adicionou fornecedor <strong>${esc(d?.name)}</strong>${d?.email ? ` (${esc(d.email)})` : ''}`;
    if (action === 'DELETE') return `Removeu fornecedor <strong>${esc(d?.name)}</strong>`;
    if (action === 'UPDATE') {
      const diffs = diffFields(old_, new_, [
        ['name',       'Nome'],
        ['email',      'Email'],
        ['status',     'Estado'],
        ['is_foreign', 'Estrangeiro'],
        ['cambio',     'Câmbio'],
        ['transport',  'Transporte'],
      ]);
      if (diffs.length) return `Atualizou fornecedor <strong>${esc(new_?.name || old_?.name)}</strong>: ${diffs.join('; ')}`;
      return `Atualizou fornecedor <strong>${esc(new_?.name || old_?.name)}</strong>`;
    }
  }

  if (t === 'bom_versions') {
    if (action === 'INSERT') return `Carregou BOM versão <strong>v${esc(d?.version_number)}</strong> — ficheiro: <strong>${esc(d?.original_name)}</strong>`;
    if (action === 'DELETE') return `Removeu BOM versão <strong>v${esc(d?.version_number)}</strong>`;
    return `Atualizou BOM versão <strong>v${esc(d?.version_number)}</strong>`;
  }

  if (t === 'bom_items') {
    if (action === 'INSERT') return `Adicionou item BOM: <strong>${esc(d?.description)}</strong> (Ref: ${esc(d?.part_number)}, Qtd: ${esc(d?.quantity)})`;
    if (action === 'DELETE') return `Removeu item BOM: <strong>${esc(d?.description)}</strong>`;
    if (action === 'UPDATE') return `Atualizou item BOM: <strong>${esc(new_?.description || old_?.description)}</strong>`;
  }

  if (t === 'quotation_items') {
    if (action === 'INSERT') return `Adicionou cotação: <strong>${esc(d?.description)}</strong> — ${fmtPrice(d?.price, d?.currency)}`;
    if (action === 'DELETE') return `Removeu cotação: <strong>${esc(d?.description)}</strong>`;
    if (action === 'UPDATE') {
      const diffs = diffFields(old_, new_, [['price','Preço'],['currency','Moeda'],['description','Descrição']]);
      if (diffs.length) return `Atualizou cotação <strong>${esc(new_?.description || old_?.description)}</strong>: ${diffs.join('; ')}`;
      return `Atualizou cotação <strong>${esc(new_?.description || old_?.description)}</strong>`;
    }
  }

  if (t === 'item_matches') {
    if (action === 'INSERT') return `Criou correspondência entre item BOM e cotação de fornecedor`;
    if (action === 'DELETE') return `Removeu correspondência entre item BOM e cotação`;
    return `Atualizou correspondência item BOM`;
  }

  if (t === 'selected_offers') {
    if (action === 'INSERT') return `Selecionou oferta de fornecedor para item BOM`;
    if (action === 'DELETE') return `Removeu oferta selecionada de item BOM`;
    return `Atualizou oferta selecionada`;
  }

  if (t === 'profiles') {
    if (action === 'UPDATE') {
      const diffs = diffFields(old_, new_, [['name','Nome'],['role','Papel']]);
      if (diffs.length) return `Atualizou perfil <strong>${esc(new_?.name || old_?.name)}</strong>: ${diffs.join('; ')}`;
      return `Atualizou perfil <strong>${esc(new_?.name || old_?.name)}</strong>`;
    }
    if (action === 'INSERT') return `Criou perfil <strong>${esc(d?.name)}</strong> (${esc(d?.role)})`;
    if (action === 'DELETE') return `Removeu perfil <strong>${esc(d?.name)}</strong>`;
  }

  return `${action} em ${t}`;
}

// ── Render ──
function renderEntry(log) {
  const actor = log.actor;
  const actorName = actor ? esc(actor.name) : '<span style="color:var(--muted)">Sistema</span>';
  const actorRole = actor ? `<div class="log-actor-role">${esc(actor.role)}</div>` : '';

  return `
    <div class="log-entry">
      <div class="log-time" title="${fullDate(log.created_at)}">${timeAgo(log.created_at)}</div>
      <div>
        <div class="log-actor">${actorName}</div>
        ${actorRole}
      </div>
      <div><span class="log-badge ${badgeClass(log.table_name)}">${badgeLabel(log.table_name)}</span></div>
      <div class="log-desc">${describeEvent(log)}</div>
    </div>`;
}

function renderEntries(entries, append = false) {
  const list = document.getElementById('logList');
  if (!append) list.innerHTML = '';

  if (!entries.length && !append) {
    list.innerHTML = '<div class="empty-state"><span>Nenhuma atividade encontrada.</span></div>';
    return;
  }

  list.insertAdjacentHTML('beforeend', entries.map(renderEntry).join(''));
}

// ── Load ──
async function loadLog(append = false) {
  if (!append) {
    logOffset = 0;
    allEntries = [];
    document.getElementById('logList').innerHTML = '<div class="empty-state"><span>A carregar...</span></div>';
    document.getElementById('loadMoreWrap').style.display = 'none';
  }

  const processSearch = document.getElementById('filterProcess').value;
  const userId = document.getElementById('filterUser').value;
  const eventType = document.getElementById('filterType').value;
  const { dateFrom, dateTo } = getDateRange();

  try {
    const entries = await API.getAuditLog({ limit: LOG_LIMIT, offset: logOffset, processSearch, userId, eventType, dateFrom, dateTo });
    allEntries = append ? [...allEntries, ...entries] : entries;
    renderEntries(append ? entries : allEntries, append);
    document.getElementById('logCount').textContent = allEntries.length > 0 ? `(${allEntries.length}${entries.length === LOG_LIMIT ? '+' : ''})` : '';
    document.getElementById('loadMoreWrap').style.display = entries.length === LOG_LIMIT ? '' : 'none';
    logOffset += entries.length;
  } catch (e) {
    document.getElementById('logList').innerHTML = `<div class="empty-state"><span style="color:var(--danger)">${e.message}</span></div>`;
  }
}

async function loadMore() {
  await loadLog(true);
}

function reloadLog() {
  loadLog(false);
}

function onFilterChange() {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => loadLog(false), 400);
}

function onDateRangeChange() {
  const v = document.getElementById('filterDateRange').value;
  document.getElementById('customDateWrap').style.display = v === 'custom' ? '' : 'none';
  if (v !== 'custom') loadLog(false);
}

function getDateRange() {
  const v = document.getElementById('filterDateRange').value;
  const now = new Date();
  if (v === 'week') {
    const from = new Date(now); from.setDate(from.getDate() - 7);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  if (v === 'month') {
    return { dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), dateTo: now.toISOString() };
  }
  if (v === 'last_month') {
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    return { dateFrom: new Date(y, m, 1).toISOString(), dateTo: new Date(y, m + 1, 0, 23, 59, 59).toISOString() };
  }
  if (v === '3months') {
    const from = new Date(now); from.setMonth(from.getMonth() - 3);
    return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
  }
  if (v === 'custom') {
    const df = document.getElementById('dateFrom').value;
    const dt = document.getElementById('dateTo').value;
    return { dateFrom: df ? new Date(df).toISOString() : '', dateTo: dt ? new Date(dt + 'T23:59:59').toISOString() : '' };
  }
  return { dateFrom: '', dateTo: '' };
}

async function exportPDF() {
  const btn = document.getElementById('exportBtn');
  const orig = btn.textContent;
  btn.textContent = 'A carregar...'; btn.disabled = true;
  try {
    const { dateFrom, dateTo } = getDateRange();
    const processSearch = document.getElementById('filterProcess').value;
    const userId = document.getElementById('filterUser').value;
    const eventType = document.getElementById('filterType').value;
    const entries = await API.getAuditLog({ limit: 10000, offset: 0, processSearch, userId, eventType, dateFrom, dateTo });
    openPrintWindow(entries, { dateFrom, dateTo });
  } catch (e) {
    alert('Erro ao exportar: ' + e.message);
  } finally {
    btn.textContent = orig; btn.disabled = false;
  }
}

function openPrintWindow(entries, { dateFrom, dateTo }) {
  const fmt = iso => iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const genDate = new Date().toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const periodoLabel = (dateFrom || dateTo) ? `${fmt(dateFrom)} \u2192 ${fmt(dateTo)}` : 'Todo o período';

  const badgeColors = {
    processes:       { bg: '#dbeafe', color: '#1d4ed8', label: 'Processo' },
    suppliers:       { bg: '#fef3c7', color: '#b45309', label: 'Fornecedor' },
    quotation_items: { bg: '#fef3c7', color: '#b45309', label: 'Cotação' },
    bom_versions:    { bg: '#ede9fe', color: '#6d28d9', label: 'BOM' },
    bom_items:       { bg: '#ede9fe', color: '#6d28d9', label: 'BOM Item' },
    item_matches:    { bg: '#d1fae5', color: '#065f46', label: 'Match' },
    selected_offers: { bg: '#d1fae5', color: '#065f46', label: 'Oferta' },
    profiles:        { bg: '#fee2e2', color: '#991b1b', label: 'Perfil' },
  };

  const rows = entries.map((log, i) => {
    const bc = badgeColors[log.table_name] || { bg: '#e2e8f0', color: '#334155', label: log.table_name };
    const actor = log.actor ? log.actor.name : 'Sistema';
    const role = log.actor ? log.actor.role : '';
    const dateStr = new Date(log.created_at).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const desc = describeEvent(log).replace(/<strong>/g, '').replace(/<\/strong>/g, '');
    const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    return '<tr style="background:' + rowBg + '">'
      + '<td style="padding:7px 10px;white-space:nowrap;color:#475569;font-size:10px">' + dateStr + '</td>'
      + '<td style="padding:7px 10px;font-weight:600;color:#1e293b">' + actor + '</td>'
      + '<td style="padding:7px 10px;color:#64748b;font-size:10px">' + role + '</td>'
      + '<td style="padding:7px 10px"><span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:' + bc.bg + ';color:' + bc.color + '">' + bc.label + '</span></td>'
      + '<td style="padding:7px 10px;color:#334155">' + desc + '</td>'
      + '</tr>';
  }).join('');

  const css = [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'body { font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#334155; background:#fff; }',
    '.doc-header { background:#1e3a5f; color:#fff; padding:18px 28px; display:flex; justify-content:space-between; align-items:center; }',
    '.doc-logo { display:flex; align-items:center; gap:12px; }',
    '.doc-logo-mark { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,#3b82f6,#7c3aed); display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; color:#fff; }',
    '.doc-logo-text { font-size:15px; font-weight:700; letter-spacing:-.3px; }',
    '.doc-logo-sub { font-size:10px; color:rgba(255,255,255,.6); margin-top:2px; }',
    '.doc-title { font-size:13px; font-weight:600; color:rgba(255,255,255,.9); text-align:right; }',
    '.doc-subheader { background:#f1f5f9; border-bottom:1px solid #e2e8f0; padding:9px 28px; display:flex; gap:32px; font-size:10px; color:#64748b; }',
    '.doc-subheader strong { color:#334155; }',
    'table { width:100%; border-collapse:collapse; }',
    'thead tr { background:#1e3a5f; }',
    'thead th { padding:9px 10px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#fff; }',
    'tbody tr:last-child td { border-bottom:none; }',
    'td { border-bottom:1px solid #e2e8f0; }',
    '.doc-footer { position:fixed; bottom:0; left:0; right:0; padding:6px 28px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; font-size:9px; color:#94a3b8; background:#fff; }',
    '@media print { .doc-footer { position:fixed; } thead { display:table-header-group; } tbody tr { page-break-inside:avoid; } }',
  ].join('\n');

  const html = '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">'
    + '<title>Registo de Atividade - Triana</title>'
    + '<style>' + css + '</style></head><body>'
    + '<div class="doc-header"><div class="doc-logo"><div class="doc-logo-mark">T</div><div>'
    + '<div class="doc-logo-text">Triana</div>'
    + '<div class="doc-logo-sub">Log\u00edstica &amp; Procurement</div>'
    + '</div></div>'
    + '<div class="doc-title">Registo de Atividade<br><span style="font-size:11px;font-weight:400;opacity:.7">Documento confidencial</span></div></div>'
    + '<div class="doc-subheader">'
    + '<span><strong>Gerado em:</strong> ' + genDate + '</span>'
    + '<span><strong>Per\u00edodo:</strong> ' + periodoLabel + '</span>'
    + '<span><strong>Total de entradas:</strong> ' + entries.length + '</span>'
    + '</div>'
    + '<table><thead><tr>'
    + '<th style="width:110px">Data/Hora</th>'
    + '<th style="width:120px">Utilizador</th>'
    + '<th style="width:80px">Cargo</th>'
    + '<th style="width:80px">Tipo</th>'
    + '<th>Descri\u00e7\u00e3o</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>'
    + '<div class="doc-footer">'
    + '<span>Triana \u00b7 Sistema interno \u00b7 Acesso restrito</span>'
    + '<span>Gerado em ' + genDate + '</span>'
    + '</div></body></html>';

  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) win.addEventListener('load', () => { win.print(); URL.revokeObjectURL(url); });
}

// ── Init ──
window.addEventListener('load', async () => {
  await requireAuth('index.html');
  if (!hasRole('admin')) { window.location.href = 'dashboard.html'; return; }

  document.getElementById('topbarRight').innerHTML =
    `<a href="dashboard.html" class="btn btn-ghost btn-sm" style="margin-right:4px">Dashboard</a>` + renderUserChip();

  try {
    const users = await API.getAuditUsers();
    const sel = document.getElementById('filterUser');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.role})`;
      sel.appendChild(opt);
    });
  } catch (_) {}

  loadLog(false);
});
