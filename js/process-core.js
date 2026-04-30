// ── Global State ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_BOM_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const ALLOWED_QUOT_TYPES = [
  ...ALLOWED_BOM_TYPES,
  'application/pdf',
];

let processId = null;
let process   = null;
let bomItems  = [];
let suppliers = [];
let bomVersions = [];
let pendingBomItems = []; // items waiting for validation before saving
let pendingDiff = null;   // diff result when uploading a BOM revision
let _bomValFilter = '';   // search filter active in the BOM validation modal
let _quotValFilter = '';  // search filter active in the quotation validation modal
let pendingBomFile = null;  // File object held between handleBomUpload and confirmBom
let _bomModalEl = null;     // reference to the open BOM validation modal element
let histCatData = null;  // lazy-fetched once; { category, supplier_name }[]
let pendingQuotFile = null; // File object held between handleQuotationUpload and confirmQuotation
let quotationFilesMap = {}; // supplierId → latest quotation_files row
let quotationMap = {};    // supplierId → items[]
let matches = [];
let matchExtraItems = [];
let selectedOffers = [];
let pendingQuotItems = [];
let currentQuotSuppId = null;
let matchingView = 'matching'; // 'matching' | 'comparacao' | 'resumo'
let matchingFilter = 'all';   // 'all' | 'unmatched'
let matchingSearch = '';       // text filter
let showSupplierDescs = false; // comparação: toggle supplier raw_description under each price
let supplierHistory = {}; // normalised name → { email, email_cc }
let globalSuppliersList = [];
let priceAnomalies = {};   // modal: itemIndex → { type, median, ratio }
let savedAnomalyMap = {};  // supplier cards: qi.id → { type, median, ratio }
let quotGlobalDiscount = 0;
let quotGlobalEta = { value: '', unit: 'dias' };
let pendingProcessCategories = [];
let rejectedAutoMatch = []; // persisted rejections: never auto-recreate these matches

// ── Init ──
window.addEventListener('load', async () => {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
  await requireAuth('index.html');
  mountSidebar(document.getElementById('appSidebar'));
  renderTabs();

  const params = new URLSearchParams(location.search);
  processId = params.get('id');
  if (!processId || !UUID_RE.test(processId)) { window.location.href = 'dashboard.html'; return; }

  await loadAll();

  // If new process, prompt BOM upload
  if (params.get('new') === '1') {
    showToast('Processo criado! Carrega o BOM agora.');
    document.getElementById('bomFileInput').click();
  }
});

async function loadAll() {
  try {
    [process, bomVersions, suppliers] = await Promise.all([
      API.getProcess(processId),
      API.getBomVersions(processId),
      API.getSuppliers(processId),
    ]);
    renderHeader();
    loadDurationEstimate();
    if (bomVersions.length) {
      bomItems = await API.getBomItems(processId, bomVersions[0].id);
      renderBomTable(bomItems);
      const v = bomVersions[0];
      document.getElementById('bomVersionLabel').textContent = `BOM v${v.version_number} — ${v.original_name||''} (${bomItems.length} itens)`;
      // Show "Nova Revisão" button + "Ver ficheiro" if BOM already exists
      const bomBtn = document.querySelector('#tab-bom .section-header > div');
      if (bomBtn) {
        bomBtn.replaceChildren();
        const finp = document.createElement('input');
        finp.type = 'file';
        finp.id = 'bomFileInput';
        finp.accept = '.xlsx,.xls';
        finp.style.display = 'none';
        finp.addEventListener('change', function() { handleBomUpload(this); });
        bomBtn.appendChild(finp);
        if (v.file_path) {
          const bView = document.createElement('button');
          bView.type = 'button';
          bView.className = 'btn btn-ghost btn-sm';
          lbtn(bView, 'file-text', 'Ver ficheiro');
          bView.addEventListener('click', () => viewBomFile(v.file_path));
          bomBtn.appendChild(bView);
        }
        if (bomVersions.length >= 2) {
          const bHist = document.createElement('button');
          bHist.type = 'button';
          bHist.className = 'btn btn-ghost btn-sm';
          lbtn(bHist, 'history', 'Histórico');
          bHist.addEventListener('click', () => openBomHistoryModal());
          bomBtn.appendChild(bHist);
        }
        const bEdit = document.createElement('button');
        bEdit.type = 'button';
        bEdit.className = 'btn btn-ghost btn-sm';
        lbtn(bEdit, 'pencil', 'Editar BOM');
        bEdit.addEventListener('click', () => openManualBomEntry());
        bomBtn.appendChild(bEdit);
        const bRev = document.createElement('button');
        bRev.type = 'button';
        bRev.className = 'btn btn-ghost btn-sm';
        bRev.style.borderColor = '#ff8800';
        bRev.style.color = '#ff8800';
        lbtn(bRev, 'folder-sync', 'Nova Revisão (v' + (v.version_number + 1) + ')');
        bRev.addEventListener('click', () => document.getElementById('bomFileInput').click());
        bomBtn.appendChild(bRev);
      }
    }
    if (!hasRole('commercial')) {
      const supplierIds = suppliers.map(s => s.id);
      const currentBomItemIds = bomItems.map(bi => bi.id);
      const [allQFlat, mtch, selOfrs, qFiles, rejAuto] = await Promise.all([
        API.getQuotationItemsForSuppliers(supplierIds),
        API.getMatches(processId, currentBomItemIds),
        API.getSelectedOffers(processId),
        API.getQuotationFiles(supplierIds),
        API.getRejectedAutoMatch(processId),
      ]);
      // Group quotation items by supplier
      quotationMap = {};
      for (const qi of allQFlat) {
        if (!quotationMap[qi.supplier_id]) quotationMap[qi.supplier_id] = [];
        quotationMap[qi.supplier_id].push(qi);
      }
      matches = mtch;
      const currentBomIds = new Set(currentBomItemIds);
      selectedOffers = selOfrs.filter(o => currentBomIds.has(o.bom_item_id));
      rejectedAutoMatch = rejAuto;
      matchExtraItems = await API.getMatchExtraItems(matches.map(m => m.id));
      quotationFilesMap = {};
      for (const f of qFiles) {
        if (!quotationFilesMap[f.supplier_id]) quotationFilesMap[f.supplier_id] = f;
      }
      renderSuppliers();
      renderInstallTab();
      // Matching tab is rendered lazily on first switch
    }
    // Load supplier history for auto-fill (best-effort)
    try {
      const known = await API.getKnownSuppliers();
      supplierHistory = {};
      for (const s of known) supplierHistory[s.name.trim().toLowerCase()] = s;
    } catch(_) {}
    // Load global suppliers for suggestions (best-effort)
    try {
      globalSuppliersList = await API.getGlobalSuppliers();
    } catch(_) {}
    renderSupplierSuggestions();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

async function loadMatchData() {
  const currentBomItemIds = bomItems.map(bi => bi.id);
  const currentBomIds = new Set(currentBomItemIds);
  const [mtch, selOfrs, rejAuto] = await Promise.all([
    API.getMatches(processId, currentBomItemIds),
    API.getSelectedOffers(processId),
    API.getRejectedAutoMatch(processId),
  ]);
  matches = mtch;
  selectedOffers = selOfrs.filter(o => currentBomIds.has(o.bom_item_id));
  rejectedAutoMatch = rejAuto;
  matchExtraItems = await API.getMatchExtraItems(matches.map(m => m.id));
}

// ── Header ──
function renderHeader() {
  document.getElementById('procTitle').textContent   = process.project_name;
  document.getElementById('procClient').textContent  = process.client_name;
  const assigneeName = process.assignee?.name;
  const meta = document.getElementById('procMeta');
  meta.replaceChildren();
  const stBadge = document.createElement('span');
  applyStatusBadge(stBadge, process.status, process.status_color);
  stBadge.textContent = process.status || '';
  meta.appendChild(stBadge);
  const pri = document.createElement('span');
  pri.className = 'priority-' + (process.priority || 'medium').toLowerCase();
  pri.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px";
  pri.textContent = process.priority || '';
  meta.appendChild(pri);
  if (process.deadline) {
    const dl = document.createElement('span');
    dl.className = 'deadline-chip ' + deadlineClass(process.deadline);
    dl.appendChild(licon('calendar', 12));
    dl.appendChild(document.createTextNode('\u00a0' + fmtDate(process.deadline)));
    meta.appendChild(dl);
  }
  if (process.commercial_name) {
    const cm = document.createElement('span');
    cm.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:2px 9px";
    cm.title = 'Comercial responsável';
    cm.textContent = process.commercial_name;
    meta.appendChild(cm);
  }
  const procName = process.procurement_name || assigneeName;
  if (procName) {
    const as = document.createElement('span');
    as.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;color:var(--accent);background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.25);border-radius:4px;padding:2px 9px";
    as.textContent = procName;
    meta.appendChild(as);
  }
  const edBtn = document.createElement('button');
  edBtn.type = 'button';
  edBtn.className = 'btn btn-ghost btn-sm';
  edBtn.textContent = 'Editar';
  edBtn.addEventListener('click', () => openEditModal());
  meta.appendChild(edBtn);
  document.title = `${process.project_name} — Procurement`;
}

// ── Tabs ──
function renderTabs() {
  const isCommercial = hasRole('commercial');
  const tabs = isCommercial
    ? [['bom', 'BOM']]
    : [['bom', 'BOM'], ['suppliers', 'Fornecedores'], ['matching', 'Matching'], ['install', 'Instalação']];
  const tabBar = document.getElementById('tabBar');
  tabBar.replaceChildren();
  tabs.forEach(([id, label], i) => {
    const d = document.createElement('div');
    d.className = 'tab' + (i === 0 ? ' active' : '');
    d.dataset.tab = id;
    d.textContent = label;
    d.addEventListener('click', () => switchTab(id));
    tabBar.appendChild(d);
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'matching') renderMatchingTab();
}

// ── File path security helper (used by bom + suppliers) ──
function _isValidFilePath(p) {
  return typeof p === 'string' && p.length < 500 && !p.includes('..') && (p.startsWith('bom/') || p.startsWith('quotations/'));
}

// ── Duration Estimate Banner ──
async function loadDurationEstimate() {
  const banner = document.getElementById('durationBanner');
  if (!banner) return;
  const cats = process.categories || [];
  if (!cats.length) { banner.style.display = 'none'; return; }
  const key = 'dur_closed_' + processId;
  if (sessionStorage.getItem(key)) { banner.style.display = 'none'; return; }
  try {
    const est = await API.getDurationEstimates(cats);
    if (!est || est.sample_count < 2) { banner.style.display = 'none'; return; }
    banner.style.display = '';
    const d = document.createElement('div');
    d.className = 'duration-banner';
    const icon = document.createElement('span');
    icon.className = 'dur-icon';
    icon.appendChild(licon('timer', 15));
    const body = document.createElement('div');
    body.className = 'dur-body';
    const main = document.createElement('div');
    main.className = 'dur-main';
    main.textContent = `Estimativa: ~${est.avg_days} dias`;
    const sub = document.createElement('div');
    sub.className = 'dur-sub';
    sub.textContent = `mín ${est.min_days} — máx ${est.max_days}  ·  baseado em ${est.sample_count} processo${est.sample_count !== 1 ? 's' : ''} similar${est.sample_count !== 1 ? 'es' : ''}`;
    body.appendChild(main);
    body.appendChild(sub);
    const close = document.createElement('button');
    close.className = 'dur-close';
    close.title = 'Fechar';
    close.appendChild(licon('x', 14));
    close.onclick = () => { sessionStorage.setItem(key, '1'); banner.style.display = 'none'; };
    d.appendChild(icon);
    d.appendChild(body);
    d.appendChild(close);
    while (banner.firstChild) banner.removeChild(banner.firstChild);
    banner.appendChild(d);
  } catch(_) { banner.style.display = 'none'; }
}

// ── Edit process modal ──
async function openEditModal() {
  const p = process;
  pendingProcessCategories = [...(p.categories || [])];

  const el = document.createElement('div');
  // Static skeleton — no user data
  el.appendChild(document.createRange().createContextualFragment(`
    <div class="modal-tag">Editar Processo</div>
    <div class="form-grid-2">
      <div><label>Cliente</label><input id="ep_client"></div>
      <div><label>Projeto</label><input id="ep_project"></div>
    </div>
    <div class="form-grid-2">
      <div><label>Deadline</label><input type="date" id="ep_deadline"></div>
      <div><label>Prioridade</label>
        <select id="ep_priority">
          <option>Low</option><option>Medium</option><option>High</option><option>Urgent</option>
        </select>
      </div>
    </div>
    <div class="form-row"><label>Estado</label>
      <select id="ep_status">
        <option value="__custom__">+ Criar estado...</option>
      </select>
      <div id="ep_custom_row" style="display:none;gap:8px;margin-top:6px;align-items:center">
        <input type="text" id="ep_custom_name" placeholder="Nome do estado" style="flex:1">
        <input type="color" id="ep_custom_color" style="width:40px;height:36px;padding:2px;cursor:pointer">
      </div>
    </div>
    <div class="form-row">
      <label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipo de projeto — opcional)</span></label>
      <div class="tag-input-box" id="ep_catBox"></div>
    </div>
    <div class="form-row"><label>Notas</label><textarea id="ep_notes"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ep_cancel">Cancelar</button>
      <button class="btn btn-primary" id="ep_save">Guardar</button>
    </div>
  `));

  // Fill user data via DOM queries on el (works on detached elements)
  const _ep = (id, v) => { const inp = el.querySelector('#' + id); if (inp) inp.value = v == null ? '' : String(v); };
  _ep('ep_client', p.client_name || '');
  _ep('ep_project', p.project_name || '');
  _ep('ep_deadline', p.deadline || '');
  _ep('ep_notes', p.notes || '');
  _ep('ep_custom_color', p.status_color || '#2563eb');

  // Priority
  el.querySelectorAll('#ep_priority option').forEach(opt => { if (opt.value === p.priority) opt.selected = true; });

  // Status — insert options before __custom__
  const statusSel = el.querySelector('#ep_status');
  const customOpt = statusSel.lastChild;
  STANDARD_STATUSES.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    if (p.status === v) opt.selected = true;
    statusSel.insertBefore(opt, customOpt);
  });
  if (!STANDARD_STATUSES.includes(p.status)) {
    const opt = document.createElement('option');
    opt.value = p.status; opt.textContent = p.status; opt.selected = true;
    statusSel.insertBefore(opt, customOpt);
    el.querySelector('#ep_custom_row').style.display = 'flex';
    _ep('ep_custom_name', p.status);
  }

  statusSel.addEventListener('change', function() {
    el.querySelector('#ep_custom_row').style.display = this.value === '__custom__' ? 'flex' : 'none';
  });

  el.querySelector('#ep_cancel').addEventListener('click', closeModal);
  el.querySelector('#ep_save').addEventListener('click', saveEditProcess);

  // Commercial + Procurement responsible text inputs
  const commRow = document.createElement('div'); commRow.className = 'form-row'; commRow.style.marginBottom = '12px';
  const commLbl = document.createElement('label'); commLbl.textContent = 'Comercial responsável';
  const commInp = document.createElement('input'); commInp.type = 'text'; commInp.id = 'ep_commercial';
  commInp.placeholder = 'Nome do comercial'; commInp.style.width = '100%';
  commInp.value = p.commercial_name || '';
  commRow.appendChild(commLbl); commRow.appendChild(commInp);
  el.querySelector('.modal-actions').before(commRow);

  const procRow = document.createElement('div'); procRow.className = 'form-row'; procRow.style.marginBottom = '12px';
  const procLbl = document.createElement('label'); procLbl.textContent = 'Procurement responsável';
  const procInp = document.createElement('input'); procInp.type = 'text'; procInp.id = 'ep_procurement';
  procInp.placeholder = 'Nome do responsável'; procInp.style.width = '100%';
  procInp.value = p.procurement_name || p.assignee?.name || '';
  procRow.appendChild(procLbl); procRow.appendChild(procInp);
  el.querySelector('.modal-actions').before(procRow);

  showModal(el);
  renderTagBox('ep_catBox', pendingProcessCategories, 'pcat');
}

async function saveEditProcess() {
  const fields = {
    client_name:     document.getElementById('ep_client').value.trim(),
    project_name:    document.getElementById('ep_project').value.trim(),
    deadline:        document.getElementById('ep_deadline').value || null,
    priority:        document.getElementById('ep_priority').value,
    notes:           document.getElementById('ep_notes').value.trim(),
    categories:      pendingProcessCategories,
    commercial_name: document.getElementById('ep_commercial')?.value.trim() || null,
    procurement_name: document.getElementById('ep_procurement')?.value.trim() || null,
    assigned_to: null,
  };
  const epStatusVal = document.getElementById('ep_status').value;
  if (epStatusVal === '__custom__' || !STANDARD_STATUSES.includes(epStatusVal)) {
    fields.status = epStatusVal === '__custom__'
      ? (document.getElementById('ep_custom_name').value.trim() || 'Custom').slice(0, 100)
      : epStatusVal;
    fields.status_color = document.getElementById('ep_custom_color').value;
  } else {
    fields.status = epStatusVal;
    fields.status_color = null;
  }
  if (fields.status === 'Closed' && process.status !== 'Closed') fields.closed_at = new Date().toISOString();
  if (!fields.client_name || !fields.project_name) { showToast('Cliente e Projeto são obrigatórios.', true); return; }
  if (fields.client_name.length > 200 || fields.project_name.length > 200) { showToast('Nome demasiado longo (máx 200 caracteres).', true); return; }
  if (fields.notes && fields.notes.length > 5000) { showToast('Notas demasiado longas (máx 5000 caracteres).', true); return; }
  try {
    process = await API.updateProcess(processId, fields);
    renderHeader();
    closeModal();
    loadDurationEstimate();
    showToast('Processo atualizado.');
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Modal helpers ──
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
  document.body.style.overflow = 'hidden';
}
function showModalLg(el) {
  const root = document.getElementById('modalRoot');
  root.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const box = document.createElement('div');
  box.className = 'modal-box-lg';
  box.appendChild(el);
  overlay.appendChild(box);
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}
function closeModal() { document.getElementById('modalRoot').replaceChildren(); document.body.style.overflow = ''; }

// ── Helpers ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('pt-PT'); }
function formatResponseTime(hours) { if (!hours || hours <= 0) return '—'; return hours < 24 ? Math.round(hours) + 'h' : (hours / 24).toFixed(1) + ' dias'; }
function fmtPrice(p) {
  if (p == null || p === '') return '—';
  let n;
  if (typeof p === 'number') {
    n = p;
  } else {
    const t = String(p).trim().replace(/\s/g, '');
    if (/,\d+$/.test(t) && t.lastIndexOf(',') > t.lastIndexOf('.'))
      n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    else if (/\.\d+$/.test(t) && t.lastIndexOf('.') > t.lastIndexOf(','))
      n = parseFloat(t.replace(/,/g, ''));
    else
      n = parseFloat(t.replace(/[,.]/g, ''));
  }
  if (isNaN(n)) return '—';
  const [i, d] = n.toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '.' + d;
}
function deadlineClass(d) { if (!d) return ''; const diff = (new Date(d)-new Date())/86400000; return diff < 0 ? 'overdue' : diff < 5 ? 'soon' : ''; }
const STANDARD_STATUSES = ['Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Pending margin','Closed','Cancelled'];
function statusBadgeClass(s) {
  const map = { 'Active':'badge-active','Waiting for suppliers':'badge-waiting','Waiting for internal info':'badge-waiting','Partial responses':'badge-partial','Ready for Excel':'badge-ready','Pending margin':'badge-pending-margin','Closed':'badge-closed','Cancelled':'badge-cancelled' };
  return map[s] || 'badge-active';
}
function applyStatusBadge(el, status, color) {
  if (color) {
    const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
    el.className = 'badge';
    el.style.background = `rgba(${r},${g},${b},.1)`;
    el.style.color = color;
    el.style.borderColor = `rgba(${r},${g},${b},.3)`;
    el.style.border = `1px solid rgba(${r},${g},${b},.3)`;
  } else {
    el.className = 'badge ' + statusBadgeClass(status);
    el.style.background = '';
    el.style.color = '';
    el.style.border = '';
  }
}
function suppStatusClass(s) {
  if (['Replied complete'].includes(s)) return 'badge-ready';
  if (['Replied partial'].includes(s)) return 'badge-partial';
  if (['Follow-up needed'].includes(s)) return 'badge-warn' ;
  if (['No stock','Not available','Ignored / no response'].includes(s)) return 'badge-blocked';
  return 'badge-waiting';
}
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', isError ? '(erro)' : '', msg);
    return;
  }
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
  el.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}
