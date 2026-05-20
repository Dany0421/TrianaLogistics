let allSuppliers = [];
let activeCat = '';
let editingId = null;
let pendingCats = [];
let pendingBrands = [];
let selectedIds = new Set();
let supplierStatsMap = {};
let currentVisible = [];
let _gsGetCc = () => [];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatResponseTime(h) { if (!h || h <= 0) return '\u2014'; return h < 24 ? Math.round(h) + 'h' : (h / 24).toFixed(1) + ' dias'; }
function showToast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' toast-error' : ' toast-success') + ' show';
  setTimeout(() => t.className = 'toast', 3000);
}
function showModal(html) {
  closeModal();
  const root = document.getElementById('modalRoot');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
  const box = document.createElement('div');
  box.className = 'modal-box';
  const frag = document.createRange().createContextualFragment(html);
  box.appendChild(frag);
  overlay.appendChild(box);
  root.appendChild(overlay);
}
function closeModal() {
  const root = document.getElementById('modalRoot');
  while (root.firstChild) root.removeChild(root.firstChild);
}

document.addEventListener('DOMContentLoaded', () => {
  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.addEventListener('click', () => { window.location.href = 'dashboard.html'; });
  document.getElementById('reportBtn').addEventListener('click', exportSupplierReport);
  document.getElementById('addBtn').addEventListener('click', () => openSupplierModal());
  document.getElementById('searchInput').addEventListener('input', filterSuppliers);
  document.getElementById('clearBtn').addEventListener('click', clearSearch);
});

window.addEventListener('load', async () => {
  await requireAuth('index.html');
  if (hasRole('commercial')) { window.location.href = 'dashboard.html'; return; }
  mountSidebar(document.getElementById('appSidebar'));
  document.getElementById('addBtn').style.display = hasRole('admin') || hasRole('procurement') ? '' : 'none';
  await loadSuppliers();
});

async function loadSuppliers() {
  try {
    [allSuppliers] = await Promise.all([API.getGlobalSuppliers()]);
    try {
      const allStats = await API.getAllSupplierStats();
      const raw = {};
      for (const row of allStats) {
        const key = (row.name || '').trim().toLowerCase();
        if (!raw[key]) raw[key] = { pids: new Set(), hours: [] };
        if (row.process_id) raw[key].pids.add(row.process_id);
        if (row.contacted_at && row.replied_at) {
          const h = (new Date(row.replied_at) - new Date(row.contacted_at)) / 3600000;
          if (h > 0 && h < 8760) raw[key].hours.push(h);
        }
      }
      supplierStatsMap = {};
      for (const k of Object.keys(raw)) {
        const s = raw[k];
        supplierStatsMap[k] = { processCount: s.pids.size, avgHours: s.hours.length ? s.hours.reduce((a,b)=>a+b,0)/s.hours.length : 0, sampleCount: s.hours.length };
      }
    } catch(_) {}
    renderCatChips();
    filterSuppliers();
  } catch(e) {
    const area = document.getElementById('suppArea');
    area.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.style.color = 'var(--danger)';
    msg.textContent = e.message;
    wrap.appendChild(msg);
    area.appendChild(wrap);
  }
}

function renderCatChips() {
  const all = new Set();
  allSuppliers.forEach(s => (s.categories||[]).forEach(c => all.add(c)));
  const chips = document.getElementById('catChips');
  chips.replaceChildren();
  const allSpan = document.createElement('span');
  allSpan.className = 'cat-chip-filter' + (!activeCat ? ' active' : '');
  allSpan.textContent = 'Todos';
  allSpan.addEventListener('click', () => setCatFilter(''));
  chips.appendChild(allSpan);
  [...all].sort().forEach(c => {
    const s = document.createElement('span');
    s.className = 'cat-chip-filter' + (activeCat === c ? ' active' : '');
    s.textContent = c;
    s.addEventListener('click', () => setCatFilter(c));
    chips.appendChild(s);
  });
}

function setCatFilter(cat) {
  activeCat = cat;
  renderCatChips();
  filterSuppliers();
}

function filterSuppliers() {
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  document.getElementById('clearBtn').style.display = q ? '' : 'none';
  let list = allSuppliers;
  if (q) list = list.filter(s =>
    _fuzzySearchScore(q, s.name || '') >= 0.35 ||
    (s.categories||[]).some(c => _fuzzySearchScore(q, c) >= 0.35) ||
    (s.brands||[]).some(b => _fuzzySearchScore(q, b) >= 0.35)
  );
  if (activeCat) list = list.filter(s => (s.categories||[]).includes(activeCat));
  currentVisible = list;
  document.getElementById('resultsInfo').textContent = list.length + ' fornecedor' + (list.length !== 1 ? 'es' : '');
  renderTable(list, q);
  updateReportBtn();
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  filterSuppliers();
}

function appendHighlightedName(el, text, q) {
  if (!q) { el.textContent = text; return; }
  const lower = text.toLowerCase();
  const qq = q.toLowerCase();
  let idx = 0;
  while (idx < text.length) {
    const i = lower.indexOf(qq, idx);
    if (i < 0) { el.appendChild(document.createTextNode(text.slice(idx))); break; }
    if (i > idx) el.appendChild(document.createTextNode(text.slice(idx, i)));
    const mark = document.createElement('mark');
    mark.style.cssText = 'background:rgba(251,191,36,.2);color:#fcd34d;border-radius:2px;padding:0 1px';
    mark.textContent = text.slice(i, i + qq.length);
    el.appendChild(mark);
    idx = i + qq.length;
  }
}

function renderTable(list, q) {
  const area = document.getElementById('suppArea');
  if (!list.length) {
    area.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = '\u{1F465}';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = 'Nenhum fornecedor encontrado.';
    wrap.appendChild(icon);
    wrap.appendChild(msg);
    area.appendChild(wrap);
    return;
  }
  const canEdit = hasRole('admin') || hasRole('procurement');
  const table = document.createElement('table');
  table.className = 'supp-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const thCb = document.createElement('th');
  thCb.style.cssText = 'width:32px;padding:8px 8px 8px 12px';
  const headerCb = document.createElement('input');
  headerCb.type = 'checkbox';
  headerCb.id = 'selectAllCb';
  headerCb.title = 'Selecionar todos';
  headerCb.addEventListener('change', () => {
    if (headerCb.checked) { currentVisible.forEach(s => selectedIds.add(s.id)); }
    else { currentVisible.forEach(s => selectedIds.delete(s.id)); }
    updateReportBtn();
    table.querySelectorAll('tbody input[type=checkbox]').forEach(cb => { cb.checked = headerCb.checked; });
  });
  thCb.appendChild(headerCb);
  hr.appendChild(thCb);
  ['Fornecedor', 'Categorias', 'Marcas', 'Tempo M\u00e9dio', ''].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const s of list) {
    const tr = document.createElement('tr');
    const tdCb = document.createElement('td');
    tdCb.style.cssText = 'width:32px;padding:9px 8px 9px 12px;vertical-align:middle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedIds.has(s.id);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(s.id); else selectedIds.delete(s.id);
      updateReportBtn();
      const allChecked = currentVisible.every(v => selectedIds.has(v.id));
      const anyChecked = currentVisible.some(v => selectedIds.has(v.id));
      const hcb = document.getElementById('selectAllCb');
      if (hcb) { hcb.checked = allChecked; hcb.indeterminate = !allChecked && anyChecked; }
    });
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);
    const tdName = document.createElement('td');
    const nameDiv = document.createElement('div');
    nameDiv.className = 'supp-name';
    appendHighlightedName(nameDiv, s.name || '', q);
    tdName.appendChild(nameDiv);
    if (s.email) {
      const em = document.createElement('div');
      em.className = 'supp-email';
      em.textContent = s.email;
      tdName.appendChild(em);
    }
    (s.cc_emails || []).forEach(cc => {
      const emc = document.createElement('div');
      emc.className = 'supp-email';
      emc.style.color = 'var(--muted)';
      emc.textContent = 'cc: ' + cc;
      tdName.appendChild(emc);
    });
    const tdCats = document.createElement('td');
    const cats = s.categories || [];
    if (cats.length) {
      cats.forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = c;
        tdCats.appendChild(chip);
      });
    } else {
      const sp = document.createElement('span');
      sp.style.color = 'var(--muted)';
      sp.style.fontSize = '12px';
      sp.textContent = '\u2014';
      tdCats.appendChild(sp);
    }
    const tdBrands = document.createElement('td');
    const brands = s.brands || [];
    if (brands.length) {
      brands.forEach(b => {
        const chip = document.createElement('span');
        chip.className = 'chip chip-brand';
        chip.textContent = b;
        tdBrands.appendChild(chip);
      });
    } else {
      const sp = document.createElement('span');
      sp.style.color = 'var(--muted)';
      sp.style.fontSize = '12px';
      sp.textContent = '\u2014';
      tdBrands.appendChild(sp);
    }
    const tdTime = document.createElement('td');
    const stats = supplierStatsMap[(s.name||'').trim().toLowerCase()] || { avgHours: 0, sampleCount: 0 };
    if (stats.avgHours > 0) {
      const badge = document.createElement('span');
      badge.className = 'resp-time-badge';
      badge.textContent = '~' + formatResponseTime(stats.avgHours);
      tdTime.appendChild(badge);
      tdTime.appendChild(document.createTextNode(' '));
      const n = document.createElement('span');
      n.style.fontFamily = "'DM Mono',monospace";
      n.style.fontSize = '10px';
      n.style.color = 'var(--muted)';
      n.textContent = '(n=' + stats.sampleCount + ')';
      tdTime.appendChild(n);
    } else {
      const sp = document.createElement('span');
      sp.style.color = 'var(--muted)';
      sp.style.fontSize = '12px';
      sp.textContent = '\u2014';
      tdTime.appendChild(sp);
    }
    const tdAct = document.createElement('td');
    const actDiv = document.createElement('div');
    actDiv.className = 'supp-actions';
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-ghost btn-sm';
    viewBtn.textContent = 'Ver';
    viewBtn.addEventListener('click', () => {
      window.location.href = 'supplier-detail.html?name=' + encodeURIComponent(s.name);
    });
    actDiv.appendChild(viewBtn);
    if (canEdit) {
      const ed = document.createElement('button');
      ed.className = 'btn btn-ghost btn-sm';
      ed.textContent = 'Editar';
      ed.addEventListener('click', () => openSupplierModal(s.id));
      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm';
      del.textContent = '\u00d7';
      del.addEventListener('click', () => confirmDelete(s.id, s.name));
      actDiv.appendChild(ed);
      actDiv.appendChild(del);
    }
    tdAct.appendChild(actDiv);
    tr.appendChild(tdName);
    tr.appendChild(tdCats);
    tr.appendChild(tdBrands);
    tr.appendChild(tdTime);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  area.replaceChildren();
  area.appendChild(table);
}

// ── Tag input helpers ──
function renderTagBox(boxId, arr, type, chipClass) {
  const box = document.getElementById(boxId);
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  arr.forEach((c, i) => {
    const span = document.createElement('span');
    span.className = 'tag-chip' + (chipClass ? ' ' + chipClass : '');
    span.textContent = c;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '\u00d7';
    btn.onclick = () => removeTag(type, i);
    span.appendChild(btn);
    box.appendChild(span);
  });
  const inp = document.createElement('input');
  inp.id = 'tagInput_' + type;
  inp.className = 'tag-input-field';
  inp.placeholder = 'Adicionar, Enter para confirmar...';
  inp.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = this.value.trim().replace(/,/g, '');
      if (!val) return;
      if (type === 'cat') { if (!pendingCats.includes(val)) pendingCats.push(val); renderTagBox(boxId, pendingCats, 'cat', ''); }
      else { if (!pendingBrands.includes(val)) pendingBrands.push(val); renderTagBox(boxId, pendingBrands, 'brand', 'tag-chip-brand'); }
      document.getElementById('tagInput_' + type)?.focus();
    }
  };
  box.appendChild(inp);
}

function removeTag(type, idx) {
  if (type === 'cat') { pendingCats.splice(idx, 1); renderTagBox('gsCatBox', pendingCats, 'cat', ''); }
  else { pendingBrands.splice(idx, 1); renderTagBox('gsBrandBox', pendingBrands, 'brand', 'tag-chip-brand'); }
}

function _buildCcInput(initialValues) {
  const vals = [...(initialValues || [])];
  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;min-height:36px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;cursor:text';
  const inp = document.createElement('input');
  inp.type = 'email'; inp.placeholder = vals.length ? '' : 'cc@fornecedor.com';
  inp.style.cssText = 'border:none;background:transparent;outline:none;font-size:13px;color:var(--text);flex:1;min-width:130px;padding:2px 0';
  function renderChips() {
    while (wrap.firstChild && wrap.firstChild !== inp) wrap.removeChild(wrap.firstChild);
    const frag = document.createDocumentFragment();
    vals.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:11px;color:var(--text);font-family:DM Mono,monospace';
      chip.appendChild(document.createTextNode(v));
      const x = document.createElement('span');
      x.textContent = '×'; x.style.cssText = 'cursor:pointer;color:var(--muted);font-size:14px;line-height:1;padding-left:3px';
      x.addEventListener('click', () => { vals.splice(i, 1); renderChips(); });
      chip.appendChild(x); frag.appendChild(chip);
    });
    wrap.insertBefore(frag, inp);
    inp.placeholder = vals.length ? '' : 'cc@fornecedor.com';
  }
  function tryAdd() {
    const v = inp.value.trim().replace(/,$/,'');
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { showToast('Email CC inválido.', true); return; }
    if (!vals.includes(v)) { vals.push(v); renderChips(); }
    inp.value = '';
  }
  inp.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===','||e.key==='Tab') { e.preventDefault(); tryAdd(); } });
  inp.addEventListener('blur', tryAdd);
  wrap.addEventListener('click', () => inp.focus());
  wrap.appendChild(inp); renderChips();
  return { el: wrap, getValues: () => [...vals] };
}

// ── Modal ──
function openSupplierModal(id = null) {
  editingId = id;
  const s = id ? allSuppliers.find(x => x.id === id) : null;
  pendingCats = s ? [...(s.categories || [])] : [];
  pendingBrands = s ? [...(s.brands || [])] : [];

  showModal(
    '<div class="modal-tag">' + (s ? 'Editar Fornecedor' : 'Novo Fornecedor') + '</div>' +
    '<div class="modal-title">' + (s ? esc(s.name) : 'Adicionar Fornecedor') + '</div>' +
    '<div class="form-grid-2">' +
      '<div><label>Nome</label><input id="gs_name" value="" placeholder="Ex: Tech Solutions"></div>' +
      '<div><label>Email Principal</label><input id="gs_email" value="" placeholder="email@fornecedor.com"></div>' +
    '</div>' +
    '<div class="form-row"><label>Email CC <span style="font-size:11px;color:var(--muted);font-weight:400">(opcional — múltiplos)</span></label>' +
      '<div id="gs_cc_mount"></div></div>' +
    '<div class="form-grid-2">' +
      '<div><label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipos de equipamento)</span></label>' +
        '<div class="tag-input-box" id="gsCatBox"></div></div>' +
      '<div><label>Marcas</label>' +
        '<div class="tag-input-box" id="gsBrandBox"></div></div>' +
    '</div>' +
    '<div class="form-row"><label>Idioma do Email <span style="font-size:11px;color:var(--muted);font-weight:400">(usado no RFQ)</span></label>' +
      '<select id="gs_language"><option value="pt">PT — Português</option><option value="en">EN — English</option></select></div>' +
    '<div class="form-row"><label>Notas</label><textarea id="gs_notes"></textarea></div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost">Cancelar</button>' +
      '<button class="btn btn-primary">Guardar</button>' +
    '</div>'
  );
  const actions = document.querySelector('#modalRoot .modal-actions');
  actions.querySelector('.btn-ghost').addEventListener('click', closeModal);
  actions.querySelector('.btn-primary').addEventListener('click', saveSupplier);

  const _gs = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v == null ? '' : String(v); };
  _gs('gs_name', s?.name || '');
  _gs('gs_email', s?.email || '');
  _gs('gs_notes', s?.notes || '');
  const { el: ccEl, getValues: getCcVals } = _buildCcInput(s?.cc_emails || []);
  document.getElementById('gs_cc_mount')?.replaceChildren(ccEl);
  _gsGetCc = getCcVals;
  const langEl = document.getElementById('gs_language'); if (langEl) langEl.value = s?.language || 'pt';
  renderTagBox('gsCatBox', pendingCats, 'cat', '');
  renderTagBox('gsBrandBox', pendingBrands, 'brand', 'tag-chip-brand');
}

async function saveSupplier() {
  const name = document.getElementById('gs_name').value.trim();
  const email = document.getElementById('gs_email').value.trim() || null;
  const cc_emails = _gsGetCc();
  const notes = document.getElementById('gs_notes').value.trim() || null;

  if (!name) { showToast('Nome obrigat\u00f3rio.', true); return; }
  if (name.length > 200) { showToast('Nome demasiado longo.', true); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Email inv\u00e1lido.', true); return; }

  const language = document.getElementById('gs_language')?.value || 'pt';
  const fields = { name, email, cc_emails: cc_emails.length ? cc_emails : null, categories: pendingCats, brands: pendingBrands, notes, language };
  try {
    if (editingId) {
      await API.updateGlobalSupplier(editingId, fields);
    } else {
      await API.createGlobalSupplier(fields);
    }
    closeModal();
    showToast('Fornecedor guardado.');
    await loadSuppliers();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

function confirmDelete(id, name) {
  if (!UUID_RE.test(id)) return;
  showModal(
    '<div class="modal-tag">Confirmar</div>' +
    '<div class="modal-title">Apagar Fornecedor</div>' +
    '<div style="color:var(--muted);font-size:14px;margin-bottom:24px">Apagar <strong style="color:#fff">' + esc(name) + '</strong>? Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita.</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-ghost">Cancelar</button>' +
      '<button class="btn btn-danger">Apagar</button>' +
    '</div>'
  );
  const actions = document.querySelector('#modalRoot .modal-actions');
  actions.querySelector('.btn-ghost').addEventListener('click', closeModal);
  actions.querySelector('.btn-danger').addEventListener('click', () => doDelete(id));
}

async function doDelete(id) {
  if (!UUID_RE.test(id)) return;
  try {
    await API.deleteGlobalSupplier(id);
    closeModal();
    showToast('Fornecedor apagado.');
    await loadSuppliers();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

function updateReportBtn() {
  const btn = document.getElementById('reportBtn');
  if (!btn) return;
  const n = selectedIds.size;
  btn.style.display = n > 0 ? '' : 'none';
  btn.textContent = '\u2193 Relat\u00f3rio (' + n + ')';
}

async function exportSupplierReport() {
  if (!selectedIds.size) return;
  const selected = allSuppliers.filter(s => selectedIds.has(s.id));
  selected.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Triana Procurement';
  wb.created = new Date();
  const ws = wb.addWorksheet('Fornecedores', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  const FONT = 'Calibri';
  const FONT_DATA = 11;
  const FONT_HEADER = 11;

  const TITLE_BG = 'FF0F1E2E';
  const TITLE_FG = 'FFFFFFFF';
  const TITLE_SUB = 'FFB3C0D1';
  const HDR_BG = 'FF1D2D44';
  const HDR_FG = 'FFFFFFFF';
  const ROW_WHITE = 'FFFFFFFF';
  const ROW_ZEBRA = 'FFF3F4F6';
  const TEXT = 'FF111827';
  const BORDER = 'FFE5E7EB';

  ws.mergeCells('A1:G1');
  const title = ws.getCell('A1');
  title.value = 'Relat\u00f3rio de Fornecedores \u2014 Triana';
  title.font = { name: FONT, bold: true, size: 16, color: { argb: TITLE_FG } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
  title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:G2');
  const sub = ws.getCell('A2');
  const countLabel = selected.length + ' fornecedor' + (selected.length === 1 ? '' : 'es');
  sub.value = 'Gerado em ' + new Date().toLocaleDateString('pt-PT') + '  \u2022  ' + countLabel;
  sub.font = { name: FONT, size: 10, color: { argb: TITLE_SUB } };
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
  sub.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 6;

  const cols = [
    { h: 'Nome',           min: 22, max: 32, align: 'left'   },
    { h: 'Email',          min: 26, max: 36, align: 'left'   },
    { h: 'Email CC',       min: 22, max: 34, align: 'left'   },
    { h: 'Categorias',     min: 22, max: 42, align: 'left'   },
    { h: 'Marcas',         min: 16, max: 30, align: 'left'   },
    { h: 'N\u00ba Processos', min: 13, max: 15, align: 'center' },
    { h: 'Tempo M\u00e9dio',  min: 14, max: 18, align: 'center' },
  ];

  const hRow = ws.getRow(4);
  cols.forEach((cfg, i) => {
    const c = hRow.getCell(i + 1);
    c.value = cfg.h;
    c.font = { name: FONT, bold: true, size: FONT_HEADER, color: { argb: HDR_FG } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
    c.alignment = {
      horizontal: cfg.align,
      vertical: 'middle',
      indent: cfg.align === 'left' ? 1 : 0,
    };
  });
  hRow.height = 26;

  const rows = selected.map(s => {
    const key = (s.name || '').trim().toLowerCase();
    const st = supplierStatsMap[key] || { processCount: 0, avgHours: 0 };
    return [
      s.name || '',
      s.email || '',
      (s.cc_emails || []).join(', '),
      (s.categories || []).join(', '),
      (s.brands || []).join(', '),
      st.processCount || 0,
      st.avgHours > 0 ? formatResponseTime(st.avgHours) : '\u2014',
    ];
  });

  const colWidths = cols.map((cfg, i) => {
    let longest = cfg.h.length;
    for (const r of rows) {
      const v = String(r[i] ?? '');
      for (const line of v.split(/\r?\n/)) {
        if (line.length > longest) longest = line.length;
      }
    }
    const proposed = Math.ceil(longest * 0.55) + 3;
    return Math.min(cfg.max, Math.max(cfg.min, proposed));
  });
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = FONT_DATA + 'pt Calibri, "Segoe UI", Arial, sans-serif';
  const measure = (t) => ctx.measureText(t).width;
  const colToPx = (chars) => Math.trunc(chars * 7 + 5);

  const wrapCount = (text, widthPx) => {
    const str = String(text ?? '');
    if (!str) return 1;
    let total = 0;
    for (const para of str.split(/\r?\n/)) {
      if (!para) { total += 1; continue; }
      const tokens = para.split(/(\s+)/).filter(t => t !== '');
      let line = '';
      let lines = 0;
      for (const tok of tokens) {
        const test = line + tok;
        if (measure(test) <= widthPx) {
          line = test;
        } else {
          if (line) { lines += 1; line = tok.replace(/^\s+/, ''); }
          else { line = tok; }
          if (measure(line) > widthPx) {
            let cur = '';
            for (const ch of line) {
              if (!cur || measure(cur + ch) <= widthPx) cur += ch;
              else { lines += 1; cur = ch; }
            }
            line = cur;
          }
        }
      }
      if (line) lines += 1;
      total += Math.max(1, lines);
    }
    return total;
  };

  const PT_PER_LINE = 14;
  const V_PADDING = 8;

  rows.forEach((vals, idx) => {
    const rn = 5 + idx;
    const bg = idx % 2 === 0 ? ROW_WHITE : ROW_ZEBRA;
    const row = ws.getRow(rn);
    let maxLines = 1;
    vals.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.font = { name: FONT, size: FONT_DATA, color: { argb: TEXT } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = {
        horizontal: cols[i].align,
        vertical: 'middle',
        wrapText: true,
        indent: cols[i].align === 'left' ? 1 : 0,
      };
      c.border = { bottom: { style: 'hair', color: { argb: BORDER } } };
      const widthPx = colToPx(colWidths[i]) - 12;
      const lines = wrapCount(v, widthPx);
      if (lines > maxLines) maxLines = lines;
    });
    row.height = Math.max(22, maxLines * PT_PER_LINE + V_PADDING);
  });

  ws.autoFilter = {
    from: { row: 4, column: 1 },
    to:   { row: 4 + rows.length, column: cols.length },
  };

  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    printTitlesRow: '4:4',
  };

  try {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Fornecedores_Triana_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) { showToast('Erro ao gerar Excel: ' + e.message, true); }
}
