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
  if (table === 'suppliers' || table === 'quotation_items' || table === 'global_suppliers') return 'log-badge-supplier';
  if (table === 'bom_versions' || table === 'bom_items')   return 'log-badge-bom';
  if (table === 'item_matches' || table === 'selected_offers') return 'log-badge-offer';
  if (table === 'profiles')                                return 'log-badge-profile';
  return 'log-badge-process';
}

function badgeLabel(table) {
  const map = {
    processes:       'Processo',
    suppliers:       'Fornecedor',
    global_suppliers:'Fornecedor Global',
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

  if (t === 'global_suppliers') {
    if (action === 'INSERT') return `Adicionou fornecedor <strong>${esc(d?.name)}</strong>${d?.email ? ` (${esc(d.email)})` : ''}`;
    if (action === 'DELETE') return `Removeu fornecedor <strong>${esc(d?.name)}</strong>`;
    if (action === 'UPDATE') {
      const diffs = diffFields(old_, new_, [['name','Nome'],['email','Email'],['categories','Categorias'],['brands','Marcas']]);
      if (diffs.length) return `Atualizou fornecedor <strong>${esc(new_?.name || old_?.name)}</strong>: ${diffs.join('; ')}`;
      return `Atualizou fornecedor <strong>${esc(new_?.name || old_?.name)}</strong>`;
    }
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

// ── Collapse bulk operations into summary entries ──
const COLLAPSIBLE = new Set(['bom_items', 'quotation_items', 'item_matches', 'selected_offers']);
const COLLAPSE_MIN = 3;      // min entries to trigger collapse
const COLLAPSE_WINDOW = 15;  // seconds

function collapseEntries(entries) {
  const summaryDesc = (t, action, count) => {
    if (t === 'bom_items') {
      if (action === 'INSERT') return `Carregou BOM: <strong>${count} itens</strong> adicionados`;
      if (action === 'DELETE') return `Removeu <strong>${count} itens</strong> do BOM`;
      return `Atualizou <strong>${count} itens</strong> do BOM`;
    }
    if (t === 'quotation_items') {
      if (action === 'INSERT') return `Carregou cotação: <strong>${count} itens</strong> adicionados`;
      if (action === 'DELETE') return `Removeu cotação anterior (<strong>${count} itens</strong>)`;
      return `Atualizou <strong>${count} itens</strong> de cotação`;
    }
    if (t === 'item_matches') {
      if (action === 'INSERT') return `Auto-match: <strong>${count} correspondências</strong> criadas`;
      if (action === 'DELETE') return `Removeu <strong>${count} correspondências</strong>`;
    }
    if (t === 'selected_offers') {
      if (action === 'INSERT') return `Selecionou ofertas para <strong>${count} itens</strong>`;
      if (action === 'DELETE') return `Removeu ofertas de <strong>${count} itens</strong>`;
    }
    return `${action} em ${t}: <strong>${count} entradas</strong>`;
  };

  const result = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (!COLLAPSIBLE.has(e.table_name)) { result.push(e); i++; continue; }

    // Collect matching consecutive entries within time window
    const group = [e];
    const t0 = new Date(e.created_at).getTime();
    let j = i + 1;
    while (j < entries.length) {
      const nx = entries[j];
      const dt = Math.abs(new Date(nx.created_at).getTime() - t0) / 1000;
      if (nx.table_name === e.table_name && nx.action === e.action && nx.user_id === e.user_id && dt <= COLLAPSE_WINDOW) {
        group.push(nx); j++;
      } else break;
    }

    if (group.length >= COLLAPSE_MIN) {
      result.push({ ...e, _summary: summaryDesc(e.table_name, e.action, group.length) });
      i = j;
    } else {
      result.push(e); i++;
    }
  }
  return result;
}

// ── Render ──
function createLogEntryEl(log) {
  const wrap = document.createElement('div');
  wrap.className = 'log-entry';
  const timeEl = document.createElement('div');
  timeEl.className = 'log-time';
  timeEl.title = fullDate(log.created_at);
  timeEl.textContent = timeAgo(log.created_at);
  const col2 = document.createElement('div');
  if (log.actor) {
    const n = document.createElement('div');
    n.className = 'log-actor';
    n.textContent = log.actor.name;
    const r = document.createElement('div');
    r.className = 'log-actor-role';
    r.textContent = log.actor.role;
    col2.appendChild(n);
    col2.appendChild(r);
  } else {
    const n = document.createElement('div');
    n.className = 'log-actor';
    const sp = document.createElement('span');
    sp.style.color = 'var(--muted)';
    sp.textContent = 'Sistema';
    n.appendChild(sp);
    col2.appendChild(n);
  }
  const bd = document.createElement('div');
  const badge = document.createElement('span');
  badge.className = 'log-badge ' + badgeClass(log.table_name);
  badge.textContent = badgeLabel(log.table_name);
  bd.appendChild(badge);
  const desc = document.createElement('div');
  desc.className = 'log-desc';
  desc.appendChild(document.createRange().createContextualFragment(log._summary || describeEvent(log)));
  wrap.appendChild(timeEl);
  wrap.appendChild(col2);
  wrap.appendChild(bd);
  wrap.appendChild(desc);
  return wrap;
}

function renderEntries(entries, append = false) {
  const list = document.getElementById('logList');
  if (!append) list.replaceChildren();

  if (!entries.length && !append) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const sp = document.createElement('span');
    sp.textContent = 'Nenhuma atividade encontrada.';
    empty.appendChild(sp);
    list.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const log of entries) frag.appendChild(createLogEntryEl(log));
  list.appendChild(frag);
}

// ── Load ──
async function loadLog(append = false) {
  if (!append) {
    logOffset = 0;
    allEntries = [];
    const loadList = document.getElementById('logList');
    loadList.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'empty-state';
    const spLoad = document.createElement('span');
    spLoad.textContent = 'A carregar...';
    loading.appendChild(spLoad);
    loadList.appendChild(loading);
    document.getElementById('loadMoreWrap').style.display = 'none';
  }

  const processSearch = document.getElementById('filterProcess').value;
  const userId = document.getElementById('filterUser').value;
  const eventType = document.getElementById('filterType').value;
  const { dateFrom, dateTo } = getDateRange();

  try {
    const entries = await API.getAuditLog({ limit: LOG_LIMIT, offset: logOffset, processSearch, userId, eventType, dateFrom, dateTo });
    allEntries = append ? [...allEntries, ...entries] : entries;
    renderEntries(collapseEntries(append ? entries : allEntries), append);
    document.getElementById('logCount').textContent = allEntries.length > 0 ? `(${allEntries.length}${entries.length === LOG_LIMIT ? '+' : ''})` : '';
    document.getElementById('loadMoreWrap').style.display = entries.length === LOG_LIMIT ? '' : 'none';
    logOffset += entries.length;
  } catch (e) {
    const errList = document.getElementById('logList');
    errList.replaceChildren();
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    const errSp = document.createElement('span');
    errSp.style.color = 'var(--danger)';
    errSp.textContent = e.message;
    errBox.appendChild(errSp);
    errList.appendChild(errBox);
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
    '.doc-logo-mark { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,#2563eb,#7c3aed); display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; color:#fff; }',
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
// ── Modal / Toast ──
function showModal(el) {
  const root = document.getElementById('modalRoot');
  root.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const box = document.createElement('div');
  box.className = 'modal-box';
  box.appendChild(el);
  overlay.appendChild(box);
  root.appendChild(overlay);
}
function closeModal() { document.getElementById('modalRoot').replaceChildren(); }
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
  el.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Tab switching ──
function switchTab(tab) {
  document.getElementById('sectionUsers').style.display = tab === 'users' ? '' : 'none';
  document.getElementById('sectionLog').style.display   = tab === 'log'   ? '' : 'none';
  document.getElementById('tabUsers').classList.toggle('active', tab === 'users');
  document.getElementById('tabLog').classList.toggle('active', tab === 'log');
  if (tab === 'log' && !logInitialized) { logInitialized = true; initLog(); }
}

// ── User Management ──
const roleLabels = { admin: 'Admin', procurement: 'Procurement', commercial: 'Commercial' };
const roleColors = { admin: '#34d399', procurement: '#38bdf8', commercial: '#fbbf24' };
const roleBg     = { admin: 'rgba(16,185,129,.15)', procurement: 'rgba(37,99,235,.15)', commercial: 'rgba(245,158,11,.15)' };

function roleBadge(role) {
  const c = roleColors[role] || 'var(--muted)';
  const bg = roleBg[role] || 'var(--surface2)';
  const span = document.createElement('span');
  span.style.cssText = `display:inline-block;padding:2px 9px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-family:'DM Mono',monospace;background:${bg};color:${c}`;
  span.textContent = roleLabels[role] || role;
  return span;
}

async function loadUsers() {
  const userList = document.getElementById('userList');
  userList.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'empty-state';
  const spL = document.createElement('span');
  spL.textContent = 'A carregar...';
  loading.appendChild(spL);
  userList.appendChild(loading);
  try {
    const users = await API.getUsers();
    document.getElementById('userCount').textContent = '(' + users.length + ')';
    userList.replaceChildren();
    if (!users.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const spE = document.createElement('span');
      spE.textContent = 'Nenhum utilizador encontrado.';
      empty.appendChild(spE);
      userList.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    users.forEach(u => frag.appendChild(createUserRowEl(u)));
    userList.appendChild(frag);
  } catch (e) {
    userList.replaceChildren();
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    const spErr = document.createElement('span');
    spErr.style.color = 'var(--danger)';
    spErr.textContent = e.message;
    errBox.appendChild(spErr);
    userList.appendChild(errBox);
  }
}

function createUserRowEl(u) {
  const row = document.createElement('div');
  row.className = 'user-row';
  const nameDiv = document.createElement('div');
  nameDiv.className = 'user-name';
  nameDiv.appendChild(document.createTextNode(u.name || '—'));
  if (currentProfile && u.id === currentProfile.id) {
    const you = document.createElement('span');
    you.className = 'user-name-you';
    you.textContent = 'tu';
    nameDiv.appendChild(you);
  }
  const emailDiv = document.createElement('div');
  emailDiv.className = 'user-email';
  emailDiv.textContent = u.email || '';
  const roleCell = document.createElement('div');
  roleCell.appendChild(roleBadge(u.role));
  const seen = document.createElement('div');
  seen.className = 'user-last-seen';
  seen.textContent = u.last_sign_in_at ? timeAgo(u.last_sign_in_at) : 'Nunca';
  const actions = document.createElement('div');
  actions.className = 'user-actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = 'Editar';
  btn.addEventListener('click', () => openEditUserModal(u));
  actions.appendChild(btn);
  row.appendChild(nameDiv);
  row.appendChild(emailDiv);
  row.appendChild(roleCell);
  row.appendChild(seen);
  row.appendChild(actions);
  return row;
}

function openEditUserModal(u) {
  const isSelf = currentProfile && u.id === currentProfile.id;

  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = 'Utilizador'; el.appendChild(tag);

  const title = document.createElement('div'); title.className = 'modal-title';
  title.textContent = 'Editar ' + (u.name || u.email); el.appendChild(title);

  const nameRow = document.createElement('div'); nameRow.className = 'form-row';
  const nameLbl = document.createElement('label'); nameLbl.textContent = 'Nome'; nameRow.appendChild(nameLbl);
  const nameInp = document.createElement('input'); nameInp.id = 'eu_name'; nameInp.maxLength = 100; nameInp.value = u.name || ''; nameRow.appendChild(nameInp);
  el.appendChild(nameRow);

  const roleRow = document.createElement('div'); roleRow.className = 'form-row';
  const roleLbl = document.createElement('label'); roleLbl.textContent = 'Cargo'; roleRow.appendChild(roleLbl);
  if (isSelf) {
    const roleInfo = document.createElement('div'); roleInfo.style.marginTop = '6px';
    roleInfo.appendChild(roleBadge(u.role));
    const note = document.createElement('span'); note.style.cssText = 'font-size:12px;color:var(--muted);margin-left:8px'; note.textContent = 'Não podes mudar o teu próprio cargo'; roleInfo.appendChild(note);
    roleRow.appendChild(roleInfo);
  } else {
    const roleSel = document.createElement('select'); roleSel.id = 'eu_role';
    ['commercial', 'procurement', 'admin'].forEach(r => { const opt = document.createElement('option'); opt.value = r; opt.textContent = roleLabels[r]; if (u.role === r) opt.selected = true; roleSel.appendChild(opt); });
    roleRow.appendChild(roleSel);
  }
  el.appendChild(roleRow);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Guardar'; saveBtn.addEventListener('click', () => saveUserEdit(u.id, isSelf)); actions.appendChild(saveBtn);
  el.appendChild(actions);

  showModal(el);
}

async function saveUserEdit(userId, isSelf) {
  const newName = document.getElementById('eu_name').value.trim();
  const newRole = isSelf ? null : document.getElementById('eu_role').value;

  if (!newName) { showToast('O nome não pode estar vazio.', true); return; }

  try {
    await API.adminUpdateUserName(userId, newName);
    if (newRole) await API.adminUpdateUserRole(userId, newRole);
    closeModal();
    showToast('Utilizador atualizado.');
    loadUsers();
  } catch (e) {
    showToast(e.message, true);
  }
}

// ── Log init ──
let logInitialized = false;

async function initLog() {
  try {
    const users = await API.getAuditUsers();
    const sel = document.getElementById('filterUser');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name + ' (' + u.role + ')';
      sel.appendChild(opt);
    });
  } catch (_) {}
  loadLog(false);
}

// ── Init ──
window.addEventListener('load', async () => {
  await requireAuth('index.html');
  if (!hasRole('admin')) { window.location.href = 'dashboard.html'; return; }

  mountSidebar(document.getElementById('appSidebar'));

  loadUsers();
});
