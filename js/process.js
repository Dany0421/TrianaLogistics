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
let pendingBomFile = null;  // File object held between handleBomUpload and confirmBom
let pendingQuotFile = null; // File object held between handleQuotationUpload and confirmQuotation
let quotationFilesMap = {}; // supplierId → latest quotation_files row
let quotationMap = {};    // supplierId → items[]
let matches = [];
let selectedOffers = [];
let pendingQuotItems = [];
let currentQuotSuppId = null;
let matchingView = 'matching'; // 'matching' | 'comparacao'
let supplierHistory = {}; // normalised name → { email, email_cc }
let globalSuppliersList = [];
let priceAnomalies = {};   // modal: itemIndex → { type, median, ratio }
let savedAnomalyMap = {};  // supplier cards: qi.id → { type, median, ratio }
let pendingProcessCategories = [];

// ── Init ──
window.addEventListener('load', async () => {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
  await requireAuth('index.html');
  const trTop = document.getElementById('topbarRight');
  trTop.replaceChildren();
  if (hasRole('admin')) {
    const aAdm = document.createElement('a');
    aAdm.href = 'admin.html';
    aAdm.className = 'btn btn-ghost btn-sm';
    aAdm.style.marginRight = '4px';
    aAdm.style.borderColor = 'rgba(16,185,129,.3)';
    aAdm.style.color = '#34d399';
    aAdm.textContent = 'Admin';
    trTop.appendChild(aAdm);
  }
  mountUserChip(trTop);
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
          bView.textContent = '\u{1F4C4} Ver ficheiro';
          bView.addEventListener('click', () => viewBomFile(v.file_path));
          bomBtn.appendChild(bView);
        }
        if (bomVersions.length >= 2) {
          const bHist = document.createElement('button');
          bHist.type = 'button';
          bHist.className = 'btn btn-ghost btn-sm';
          bHist.textContent = '\u{1F4CB} Histórico';
          bHist.addEventListener('click', () => openBomHistoryModal());
          bomBtn.appendChild(bHist);
        }
        const bEdit = document.createElement('button');
        bEdit.type = 'button';
        bEdit.className = 'btn btn-ghost btn-sm';
        bEdit.textContent = '\u270F Editar BOM';
        bEdit.addEventListener('click', () => openManualBomEntry());
        bomBtn.appendChild(bEdit);
        const bRev = document.createElement('button');
        bRev.type = 'button';
        bRev.className = 'btn btn-ghost btn-sm';
        bRev.style.borderColor = '#ff8800';
        bRev.style.color = '#ff8800';
        bRev.textContent = '\u{1F4C2} Nova Revisão (v' + (v.version_number + 1) + ')';
        bRev.addEventListener('click', () => document.getElementById('bomFileInput').click());
        bomBtn.appendChild(bRev);
      }
    }
    if (!hasRole('commercial')) {
      const supplierIds = suppliers.map(s => s.id);
      const [allQFlat, mtch, selOfrs, qFiles] = await Promise.all([
        API.getQuotationItemsForSuppliers(supplierIds),
        API.getMatches(processId),
        API.getSelectedOffers(processId),
        API.getQuotationFiles(supplierIds),
      ]);
      // Group quotation items by supplier
      quotationMap = {};
      for (const qi of allQFlat) {
        if (!quotationMap[qi.supplier_id]) quotationMap[qi.supplier_id] = [];
        quotationMap[qi.supplier_id].push(qi);
      }
      matches = mtch;
      selectedOffers = selOfrs;
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
  [matches, selectedOffers] = await Promise.all([
    API.getMatches(processId),
    API.getSelectedOffers(processId),
  ]);
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
    dl.textContent = '\u{1F4C5} ' + fmtDate(process.deadline);
    meta.appendChild(dl);
  }
  if (assigneeName) {
    const as = document.createElement('span');
    as.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--accent);background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);border-radius:4px;padding:2px 9px";
    as.textContent = assigneeName;
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

// ── BOM Diff ──
function diffBom(oldItems, newItems) {
  const norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const used = new Set();

  const result = newItems.map(ni => {
    // 1. Part number match
    if (ni.part_number) {
      const m = oldItems.find(oi => !used.has(oi.id) && oi.part_number &&
        norm(oi.part_number) === norm(ni.part_number));
      if (m) {
        used.add(m.id);
        const qtyDiff = Math.abs((m.quantity||0) - (ni.quantity||0)) > 0.001;
        const descDiff = norm(m.description) !== norm(ni.description);
        return { ...ni, _diffStatus: descDiff ? 'changed' : qtyDiff ? 'qty_changed' : 'unchanged', _oldId: m.id, _oldQty: m.quantity };
      }
    }
    // 2. Description match
    const m = oldItems.find(oi => !used.has(oi.id) && norm(oi.description) === norm(ni.description));
    if (m) {
      used.add(m.id);
      const qtyDiff = Math.abs((m.quantity||0) - (ni.quantity||0)) > 0.001;
      return { ...ni, _diffStatus: qtyDiff ? 'qty_changed' : 'unchanged', _oldId: m.id, _oldQty: m.quantity };
    }
    return { ...ni, _diffStatus: 'new', _oldId: null };
  });

  const removed = oldItems.filter(oi => !used.has(oi.id));
  return { result, removed };
}

// ── BOM Upload ──
async function handleBomUpload(input) {
  if (!input.files.length) return;
  const file = input.files[0];
  input.value = '';

  if (file.size > MAX_UPLOAD_SIZE) { showToast(`Ficheiro demasiado grande (máx ${MAX_UPLOAD_SIZE / 1024 / 1024}MB).`, true); return; }
  if (!ALLOWED_BOM_TYPES.includes(file.type) && !file.name.match(/\.xlsx?$/i)) { showToast('Tipo de ficheiro não permitido. Usa .xlsx ou .xls.', true); return; }

  const buf = await file.arrayBuffer();
  const { items } = parseBomFile(buf);

  if (!items.length) { showToast('Não foi possível extrair itens do BOM.', true); return; }

  // Compute diff if this is a revision
  if (bomVersions.length > 0 && bomItems.length > 0) {
    const { result, removed } = diffBom(bomItems, items);
    pendingDiff = { items: result, removed };
    pendingBomItems = result.map(i => ({ ...i }));
  } else {
    pendingDiff = null;
    pendingBomItems = items.map(i => ({ ...i }));
  }

  pendingBomFile = file;
  openBomValidationModal(file.name);
}

function diffStatusBadge(status) {
  if (!status || status === 'unchanged') return '';
  const map = {
    qty_changed: ['#3a3000','#ffcc00','Qty ↑↓'],
    changed:     ['#3a1500','#ff8800','Alterado'],
    new:         ['rgba(59,130,246,.15)','#60a5fa','Novo'],
  };
  const [bg, color, label] = map[status] || ['#333','#aaa', status];
  return `<span style="background:${bg};color:${color};border:1px solid ${color};border-radius:3px;font-size:10px;padding:1px 5px;font-family:'IBM Plex Mono',monospace">${label}</span>`;
}

function openBomValidationModal(fileName) {
  const isRevision = pendingDiff !== null;
  const removed = isRevision ? pendingDiff.removed : [];

  // Count diff stats
  let diffSummary = '';
  if (isRevision) {
    const counts = { unchanged:0, qty_changed:0, changed:0, new:0 };
    pendingBomItems.forEach(i => counts[i._diffStatus] = (counts[i._diffStatus]||0)+1);
    diffSummary = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px">
      ${counts.unchanged ? `<span style="color:var(--muted)">${counts.unchanged} iguais</span>` : ''}
      ${counts.qty_changed ? `<span style="color:#ffcc00">${counts.qty_changed} qty alterada</span>` : ''}
      ${counts.changed ? `<span style="color:#ff8800">${counts.changed} alterados</span>` : ''}
      ${counts.new ? `<span style="color:#60a5fa">${counts.new} novos</span>` : ''}
      ${removed.length ? `<span style="color:#ff4444">${removed.length} removidos</span>` : ''}
    </div>`;
  }

  showModalLg(`
    <div class="modal-tag">${isRevision ? 'Revisão BOM' : 'Validação BOM'}</div>
    <div class="modal-title">${esc(fileName)}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${pendingBomItems.length} linha(s) encontrada(s). Revê e confirma antes de guardar.</div>
    ${diffSummary}
    <div style="max-height:380px;overflow-y:auto;margin-bottom:12px">
      <table class="bom-validate-table">
        <thead><tr>
          ${isRevision ? '<th style="width:7%">Estado</th>' : ''}
          <th style="width:11%">Part #</th>
          <th style="width:${isRevision ? '31%' : '38%'}">Descrição</th>
          <th style="width:7%">Qty</th>
          <th style="width:8%">Unid.</th>
          <th style="width:9%">Categoria</th>
          <th style="width:5%" title="Serviço Triana">Serv.</th>
          <th style="width:7%"></th>
        </tr></thead>
        <tbody id="bomValTbody"></tbody>
      </table>
    </div>
    ${removed.length ? `
    <div style="background:#1a0505;border:1px solid #440000;border-radius:4px;padding:10px;margin-bottom:12px;font-size:12px">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ff4444;letter-spacing:1px;margin-bottom:6px">REMOVIDOS DO BOM (${removed.length})</div>
      ${removed.map(r => `<div style="color:#ff8888;padding:2px 0">${esc(r.part_number ? r.part_number+' — ' : '')}${esc(r.description)}</div>`).join('')}
    </div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="addBomRow()">+ Linha</button>
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmBom()">Confirmar e Guardar</button>
    </div>
  `);
  renderBomValTable();
}

function addBomRow() {
  const last = pendingBomItems[pendingBomItems.length - 1];
  pendingBomItems.push({ part_number: null, description: '', quantity: 1, unit: '', category: last?.category || '', sheet_name: last?.sheet_name || null });
  renderBomValTable();
}

function openManualBomEntry() {
  const stripped = bomItems.map(({ id, process_id, bom_version_id, created_at, sort_order, ...item }) => ({ ...item }));
  pendingBomFile = null;
  if (bomItems.length) {
    const { result, removed } = diffBom(bomItems, stripped);
    pendingDiff = { items: result, removed };
    pendingBomItems = result.map(i => ({ ...i }));
  } else {
    pendingDiff = null;
    pendingBomItems = stripped;
  }
  openBomValidationModal(bomItems.length ? 'Editar BOM' : 'Entrada Manual');
}

function renderBomValTable() {
  const tbody = document.getElementById('bomValTbody');
  if (!tbody) return;
  const isRevision = pendingDiff !== null;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

  // Determine if we should show sheet dividers (more than one unique sheet name)
  const sheetNames = [...new Set(pendingBomItems.map(i => i.sheet_name).filter(Boolean))];
  const showDividers = sheetNames.length > 1;
  let lastSheet = null;
  const colSpan = isRevision ? 8 : 7; // +1 for Serv. column

  pendingBomItems.forEach((item, i) => {
    // Insert sheet divider row when sheet changes
    if (showDividers && item.sheet_name && item.sheet_name !== lastSheet) {
      lastSheet = item.sheet_name;
      const divRow = document.createElement('tr');
      divRow.className = 'sheet-divider-row';
      const divTd = document.createElement('td');
      divTd.colSpan = colSpan;
      divTd.style.cssText = 'padding:6px 8px;background:rgba(99,102,241,.1);border-top:1px solid rgba(99,102,241,.3);border-bottom:1px solid rgba(99,102,241,.3)';
      const label = document.createElement('span');
      label.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:#818cf8;letter-spacing:.8px;text-transform:uppercase";
      label.textContent = '── Sheet: ' + item.sheet_name + ' ──';
      divTd.appendChild(label);
      divRow.appendChild(divTd);
      tbody.appendChild(divRow);
    }

    const tr = document.createElement('tr');

    if (isRevision) {
      const tdStat = document.createElement('td');
      tdStat.style.whiteSpace = 'nowrap';
      const badgeHtml = diffStatusBadge(item._diffStatus);
      if (badgeHtml) tdStat.appendChild(document.createRange().createContextualFragment(badgeHtml));
      tr.appendChild(tdStat);
    }

    const tdPart = document.createElement('td');
    const inPart = document.createElement('input');
    inPart.type = 'text';
    inPart.value = item.part_number == null ? '' : String(item.part_number);
    inPart.style.width = '100%';
    inPart.onchange = function() { pendingBomItems[i].part_number = this.value || null; };
    tdPart.appendChild(inPart);
    tr.appendChild(tdPart);

    const tdDesc = document.createElement('td');
    const inDesc = document.createElement('input');
    inDesc.type = 'text';
    inDesc.value = item.description || '';
    inDesc.style.width = '100%';
    inDesc.onchange = function() { pendingBomItems[i].description = this.value; };
    tdDesc.appendChild(inDesc);
    tr.appendChild(tdDesc);

    const tdQty = document.createElement('td');
    const inQty = document.createElement('input');
    inQty.type = 'number';
    inQty.value = item.quantity;
    inQty.style.width = '55px';
    inQty.onchange = function() { pendingBomItems[i].quantity = parseFloat(this.value) || 1; };
    tdQty.appendChild(inQty);
    tr.appendChild(tdQty);

    const tdUnit = document.createElement('td');
    const inUnit = document.createElement('input');
    inUnit.type = 'text';
    inUnit.value = item.unit || '';
    inUnit.style.width = '66px';
    inUnit.onchange = function() { pendingBomItems[i].unit = this.value || null; };
    tdUnit.appendChild(inUnit);
    tr.appendChild(tdUnit);

    const tdCat = document.createElement('td');
    const inCat = document.createElement('input');
    inCat.type = 'text';
    inCat.placeholder = 'Categoria';
    inCat.value = item.category || '';
    inCat.style.width = '100%';
    inCat.onchange = function() { pendingBomItems[i].category = this.value || null; };
    tdCat.appendChild(inCat);
    tr.appendChild(tdCat);

    const tdSvc = document.createElement('td');
    tdSvc.style.textAlign = 'center';
    const chkSvc = document.createElement('input');
    chkSvc.type = 'checkbox';
    chkSvc.checked = !!item.is_service;
    chkSvc.title = 'Marcar como serviço Triana (aparece em Instalação)';
    chkSvc.onchange = function() { pendingBomItems[i].is_service = this.checked; };
    tdSvc.appendChild(chkSvc);
    tr.appendChild(tdSvc);

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '\u00d7';
    delBtn.onclick = () => { pendingBomItems.splice(i, 1); renderBomValTable(); };
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

async function confirmBom() {
  try {

    const versionNumber = (bomVersions[0]?.version_number || 0) + 1;
    let bomFilePath = null;
    const bomFileName = pendingBomFile?.name || 'bom.xlsx';
    if (pendingBomFile) {
      const ext = bomFileName.split('.').pop();
      bomFilePath = `bom/${processId}/v${versionNumber}_${Date.now()}.${ext}`;
      await API.uploadFile('procurement-files', bomFilePath, pendingBomFile);
      pendingBomFile = null;
    }
    const version = await API.createBomVersion(processId, bomFileName, bomFilePath, versionNumber);

    const itemsToSave = pendingBomItems.map(({ _diffStatus, _oldId, _oldQty, ...item }) => ({
      ...item,
      process_id: processId,
      bom_version_id: version.id,
    }));

    const savedItems = await API.saveBomItems(itemsToSave);

    // Copy matches for unchanged/qty_changed items from previous version
    // Only procurement/admin can write to item_matches and selected_offers
    if (pendingDiff && savedItems?.length && !hasRole('commercial')) {
      const preserved = pendingBomItems
        .map((item, idx) => ({ item, newId: savedItems[idx]?.id }))
        .filter(({ item, newId }) => newId && item._oldId &&
          ['unchanged', 'qty_changed', 'changed'].includes(item._diffStatus));

      await Promise.all(preserved.map(({ item, newId }) =>
        API.copyItemMatches(item._oldId, newId, processId)
      ));
      await Promise.all(preserved.map(({ item, newId }) =>
        API.copySelectedOffer(item._oldId, newId, processId)
      ));

      const preservedCount = preserved.length;
      if (preservedCount) showToast(`BOM v${versionNumber} — ${preservedCount} match${preservedCount!==1?'es':''} preservado${preservedCount!==1?'s':''}.`);
    }

    pendingDiff = null;
    closeModal();
    showToast(`BOM v${versionNumber} guardado — ${itemsToSave.length} itens.`);
    await loadAll();
  } catch(e) { showToast('Erro ao guardar BOM: ' + e.message, true); }
}

// ── BOM Table (saved) ──
function renderBomTable(items) {
  const holder = document.getElementById('bomContent');
  holder.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'BOM sem itens.';
    holder.appendChild(empty);
    return;
  }
  let html = `<table class="bom-table"><thead><tr>
    <th style="width:13%">Part #</th>
    <th style="width:42%">Descrição</th>
    <th style="width:7%">Qty</th>
    <th style="width:7%">Unid.</th>
    <th style="width:19%">Categoria</th>
    <th style="width:5%;text-align:center" title="Serviço Triana">Serv.</th>
  </tr></thead><tbody>`;

  let lastCat = null;
  for (const item of items) {
    if (item.category && item.category !== lastCat) {
      html += `<tr class="category-row"><td colspan="6">${esc(item.category)}</td></tr>`;
      lastCat = item.category;
    }
    html += `<tr>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)">${esc(item.part_number||'—')}</td>
      <td>${esc(item.description)}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="color:var(--muted)">${esc(item.unit||'')}</td>
      <td style="font-size:11px;color:var(--muted)">${esc(item.category||'')}</td>
      <td style="text-align:center"><input type="checkbox" ${item.is_service ? 'checked' : ''} onchange="toggleServiceItem('${item.id}',this.checked)" title="Serviço Triana"></td>
    </tr>`;
  }
  html += '</tbody></table>';
  holder.appendChild(document.createRange().createContextualFragment(html));
}

async function toggleServiceItem(bomItemId, isService) {
  const bi = bomItems.find(b => b.id === bomItemId);
  if (!bi) return;
  bi.is_service = isService;
  renderBomTable(bomItems);
  renderInstallTab();
  try {
    await API.updateBomItemService(bomItemId, isService);
  } catch(e) {
    bi.is_service = !isService;
    renderBomTable(bomItems);
    renderInstallTab();
    showToast('Erro: ' + e.message, true);
  }
}

// ── Suppliers ──
async function checkPriceAnomalies(items) {
  const partNums = items.map(i => i.raw_part_number).filter(Boolean);
  const descs = items.filter(i => !i.raw_part_number).map(i => i.raw_description);
  let history = [];
  try { history = await API.getPriceHistoryBatch(partNums, descs); } catch(_) { return {}; }
  const histMap = {};
  history.forEach(h => {
    const key = h.raw_part_number
      ? h.raw_part_number.trim().toLowerCase() + ':' + (h.currency||'MZN')
      : h.raw_description.trim().toLowerCase().slice(0,40) + ':' + (h.currency||'MZN');
    if (!histMap[key]) histMap[key] = [];
    histMap[key].push(Number(h.price));
  });
  function median(arr) {
    const s = [...arr].sort((a,b) => a-b);
    const m = Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
  }
  const anomalies = {};
  items.forEach((item, idx) => {
    const k = item.raw_part_number
      ? item.raw_part_number.trim().toLowerCase() + ':' + (item.currency||'MZN')
      : item.raw_description.trim().toLowerCase().slice(0,40) + ':' + (item.currency||'MZN');
    const hist = histMap[k];
    if (!hist || hist.length < 3) return;
    const med = median(hist);
    if (!med || med <= 0) return;
    const price = Number(item.price);
    if (price > med * 3) anomalies[idx] = { type:'high', median:med, ratio:(price/med).toFixed(1) };
    else if (price < med / 3) anomalies[idx] = { type:'low', median:med, ratio:(med/price).toFixed(1) };
  });
  return anomalies;
}

function renderSupplierSuggestions() {
  const banner = document.getElementById('suggBanner');
  if (!banner) return;
  while (banner.firstChild) banner.removeChild(banner.firstChild);

  const bomCats = [...new Set(bomItems.map(b => b.category).filter(Boolean))];
  if (!bomCats.length || !globalSuppliersList.length) return;

  const addedNames = new Set(suppliers.map(s => s.name.trim().toLowerCase()));
  const bomCatsLower = new Set(bomCats.map(c => c.toLowerCase()));

  const suggestions = globalSuppliersList.filter(gs => {
    if (addedNames.has(gs.name.trim().toLowerCase())) return false;
    return (gs.categories || []).some(c => bomCatsLower.has(c.toLowerCase()));
  });

  if (!suggestions.length) return;

  const header = document.createElement('div');
  header.className = 'sugg-banner-header';
  const title = document.createElement('span');
  title.textContent = 'Fornecedores sugeridos — categorias do BOM';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => { while (banner.firstChild) banner.removeChild(banner.firstChild); };
  header.appendChild(title);
  header.appendChild(closeBtn);

  const cards = document.createElement('div');
  cards.className = 'sugg-cards';

  suggestions.forEach(gs => {
    const matchedCats = (gs.categories || []).filter(c => bomCatsLower.has(c.toLowerCase()));
    const card = document.createElement('div');
    card.className = 'sugg-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'sugg-card-name';
    nameEl.textContent = gs.name;
    card.appendChild(nameEl);

    if (matchedCats.length) {
      const catsEl = document.createElement('div');
      catsEl.className = 'sugg-card-cats';
      matchedCats.forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'sugg-cat-chip';
        chip.textContent = c;
        catsEl.appendChild(chip);
      });
      card.appendChild(catsEl);
    }

    if (gs.avg_response_hours > 0) {
      const badge = document.createElement('span');
      badge.className = 'resp-time-badge';
      badge.textContent = '~' + formatResponseTime(gs.avg_response_hours);
      card.appendChild(badge);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.textContent = '+ Adicionar';
    addBtn.style.marginTop = '2px';
    addBtn.onclick = () => openSupplierModal(null, { name: gs.name, email: gs.email || '', email_cc: gs.email_cc || '', categories: [...(gs.categories || [])] });
    card.appendChild(addBtn);

    cards.appendChild(card);
  });

  banner.className = 'sugg-banner';
  banner.appendChild(header);
  banner.appendChild(cards);
}

function renderSuppliers() {
  document.getElementById('suppCount').textContent = `${suppliers.length} fornecedor${suppliers.length !== 1 ? 'es' : ''}`;
  const el = document.getElementById('suppliersContent');
  el.replaceChildren();
  if (!suppliers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.appendChild(document.createTextNode('Sem fornecedores.'));
    empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('Adiciona o primeiro fornecedor.'));
    el.appendChild(empty);
    return;
  }
  const suppHtml = suppliers.map((s, i) => {
    const qItems = quotationMap[s.id] || [];
    const qCount = qItems.length;
    const gs = supplierHistory[s.name?.trim().toLowerCase()];
    const avgBadge = gs?.avg_response_hours > 0 ? `<span class="resp-time-badge">~${formatResponseTime(gs.avg_response_hours)}</span>` : '';
    return `
    <div class="supplier-card">
      <div class="supplier-card-header" onclick="toggleSupplier(${i})">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--accent)">${esc(s.name)}</span>
          <span class="badge ${suppStatusClass(s.status)}">${s.status}</span>
          ${s.is_foreign ? '<span class="badge" style="background:#3a2a00;color:#ffaa00;border:1px solid #5a4a00">ESTRANGEIRO</span>' : ''}
          <span class="quot-badge ${qCount?'has-items':''}">${qCount ? `${qCount} itens cotação` : 'sem cotação'}</span>
          ${qItems.some(qi=>savedAnomalyMap[qi.id]) ? '<span class="anomaly-high" title="Preços fora do histórico detectados">&#9888; outlier</span>' : ''}
          ${avgBadge}
        </div>
        <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
          ${s.email ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openRFQModal(${i})">✉ RFQ</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openManualQuotEntry('${s.id}')">✏ Manual</button>
          <button class="btn btn-ghost btn-sm" onclick="uploadQuotation('${s.id}')">📎 Cotação</button>
          <button class="btn btn-ghost btn-sm" onclick="openSupplierModal(${i})">Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${s.id}')">×</button>
        </div>
      </div>
      <div class="supplier-card-body" id="suppBody-${i}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;margin-bottom:${qCount?'12px':'0'}">
          <div><span style="color:var(--muted);font-size:11px">EMAIL</span><br>${esc(s.email||'—')}${s.email_cc?`<br><span style="font-size:11px;color:var(--muted)">CC: ${esc(s.email_cc)}</span>`:''}</div>
          <div><span style="color:var(--muted);font-size:11px">ÚLTIMO CONTACTO</span><br>${s.last_contact_at ? fmtDate(s.last_contact_at) : '—'}</div>
          <div><span style="color:var(--muted);font-size:11px">FOLLOW-UP</span><br>${s.next_followup_at ? fmtDate(s.next_followup_at) : '—'}</div>
          <div><span style="color:var(--muted);font-size:11px">NOTAS</span><br>${esc(s.notes||'—')}</div>
        </div>
        ${qCount ? `
        <div style="border-top:1px solid var(--border);padding-top:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px">COTAÇÃO — ${qCount} ITENS</div>
            ${quotationFilesMap[s.id] ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();viewQuotFile('${quotationFilesMap[s.id].file_path}')">📄 Ver original</button>` : ''}
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            ${qItems.slice(0,6).map(qi=>{
              const anom = savedAnomalyMap[qi.id];
              const priceColor = anom ? (anom.type==='high'?'#fb923c':'#818cf8') : '#fff';
              const priceTitle = anom ? (anom.type==='high'?`${anom.ratio}× acima da mediana histórica`:`${anom.ratio}× abaixo da mediana histórica`) : '';
              return `<tr>
              <td style="padding:2px 0;color:var(--text)">${esc(qi.raw_description.length>55?qi.raw_description.substring(0,55)+'\u2026':qi.raw_description)}</td>
              <td style="text-align:right;font-family:'IBM Plex Mono',monospace;color:${priceColor};white-space:nowrap" title="${esc(priceTitle)}">${fmtPrice(qi.price)} ${qi.currency}${anom?` <span style="font-size:9px">&#9888;</span>`:''}</td>
            </tr>`;}).join('')}
            ${qCount>6?`<tr><td colspan="2" style="color:var(--muted);padding-top:4px">…e mais ${qCount-6} itens</td></tr>`:''}
          </table>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
  el.appendChild(document.createRange().createContextualFragment(suppHtml));
}

function toggleSupplier(i) {
  const el = document.getElementById('suppBody-' + i);
  el.classList.toggle('open');
}

function openRFQModal(supplierIdx) {
  const s = suppliers[supplierIdx];
  // Group items by category for display
  let lastCat = null;
  const itemRows = bomItems.map((bi, idx) => {
    let catHeader = '';
    if (bi.category && bi.category !== lastCat) {
      catHeader = `<div style="background:var(--surface2);padding:5px 12px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:.8px;text-transform:uppercase;border-bottom:1px solid var(--border)">${esc(bi.category)}</div>`;
      lastCat = bi.category;
    }
    return `${catHeader}<label style="display:grid;grid-template-columns:20px 1fr auto;align-items:start;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:.1s" onmouseover="this.style.background='rgba(59,130,246,.05)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="rfq-item-cb" value="${idx}" checked style="margin-top:3px;width:auto">
      <div>
        <div style="font-size:13px;color:var(--text);line-height:1.4">${esc(bi.description)}</div>
        ${bi.part_number ? `<div style="font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">${esc(bi.part_number)}</div>` : ''}
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;padding-top:2px">× ${bi.quantity} ${bi.unit||''}</div>
    </label>`;
  }).join('');

  showModalLg(`
    <div class="modal-tag">Pedido de Cotação — RFQ</div>
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:4px">
      <div class="modal-title" style="margin-bottom:0">${esc(s.name)}</div>
      <div style="font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace">${esc(s.email)}</div>
    </div>
    ${!bomItems.length
      ? `<div style="color:var(--muted);font-size:13px;margin:20px 0">Carrega o BOM primeiro.</div>`
      : `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase">Seleciona os itens a pedir</div>
          <label style="cursor:pointer;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;text-transform:none;letter-spacing:0;font-weight:400;margin-bottom:0">
            <input type="checkbox" id="rfq_all" onchange="toggleAllRFQ(this.checked)" checked style="width:auto"> Selecionar tudo
          </label>
        </div>
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:420px;overflow-y:auto;margin-bottom:16px">
          ${itemRows}
        </div>`}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      ${bomItems.length ? `<button class="btn btn-primary" onclick="sendRFQ(${supplierIdx})">✉ Gerar Email</button>` : ''}
    </div>
  `);
}

function toggleAllRFQ(checked) {
  document.querySelectorAll('.rfq-item-cb').forEach(cb => cb.checked = checked);
}

function buildRFQHtml(selected, supplierName) {
  const td = 'style="border:1px solid #cbd5e1;padding:7px 10px"';
  const tdC = 'style="border:1px solid #cbd5e1;padding:7px 10px;text-align:center"';
  const tdMono = 'style="border:1px solid #cbd5e1;padding:7px 10px;font-family:monospace;font-size:12px"';

  let rows = '';
  let lastCat = undefined;
  for (const bi of selected) {
    if (bi.category !== lastCat) {
      if (bi.category) {
        rows += '<tr style="background:#e8f0fe"><td colspan="4" style="border:1px solid #cbd5e1;padding:5px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#1e40af">' + esc(bi.category) + '</td></tr>';
      }
      lastCat = bi.category;
    }
    rows += '<tr>';
    rows += '<td ' + tdMono + '>' + esc(bi.part_number || '-') + '</td>';
    rows += '<td ' + td + '>' + esc(bi.description || '-') + '</td>';
    rows += '<td ' + tdC + '>' + (bi.quantity || 1) + '</td>';
    rows += '<td ' + td + '>' + esc(bi.unit || 'Unidade') + '</td>';
    rows += '</tr>';
  }

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">'
    + '<p>Boa tarde, Prezados,</p>'
    + '<p>Espero que este e-mail os encontre bem.</p>'
    + '<p>Queria solicitar uma cota&ccedil;&atilde;o para o equipamento abaixo:</p>'
    + '<table border="1" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%;max-width:720px">'
    + '<thead><tr style="background:#f0f4f8">'
    + '<th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;font-weight:600">Artigo</th>'
    + '<th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;font-weight:600">Descri&ccedil;&atilde;o</th>'
    + '<th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:center;font-weight:600">Qtd.</th>'
    + '<th style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;font-weight:600">Unidade</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>'
    + '</div>';
}

async function sendRFQ(supplierIdx) {
  const s = suppliers[supplierIdx];
  const selected = [...document.querySelectorAll('.rfq-item-cb:checked')]
    .map(cb => bomItems[parseInt(cb.value)])
    .filter(Boolean);
  if (!selected.length) { showToast('Seleciona pelo menos um item.', true); return; }

  const subject = 'Pedido de Cotacao - ' + process.project_name + ' - ' + process.client_name;
  const html = buildRFQHtml(selected, s.name);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })
    ]);
  } catch (e) {
    showToast('Nao foi possivel copiar automaticamente.', true);
    return;
  }

  const ccEmails = ['procurement@triana.co.mz', ...(s.email_cc ? [s.email_cc] : [])].map(encodeURIComponent).join(',');
  const mailto = 'mailto:' + encodeURIComponent(s.email) + '?cc=' + ccEmails + '&subject=' + encodeURIComponent(subject);
  window.location.href = mailto;
  closeModal();
  showToast('Email copiado — cola no body do email (Ctrl+V)');
}

function autoFillSupplierEmail(name) {
  const known = supplierHistory[name.trim().toLowerCase()];
  if (!known) return;
  const eEl = document.getElementById('sf_email');
  const ccEl = document.getElementById('sf_email_cc');
  if (eEl && !eEl.value) eEl.value = known.email || '';
  if (ccEl && !ccEl.value) ccEl.value = known.email_cc || '';
}

let editingSupplierIdx = null;
let pendingSupplierCategories = [];
let pendingSupplierBrands = [];

function renderTagBox(boxId, arr, type) {
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
    btn.onclick = () => removeSupplierTag(type, i);
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
      if (type === 'cat') { if (!pendingSupplierCategories.includes(val)) pendingSupplierCategories.push(val); }
      else if (type === 'pcat') { if (!pendingProcessCategories.includes(val)) pendingProcessCategories.push(val); }
      else { if (!pendingSupplierBrands.includes(val)) pendingSupplierBrands.push(val); }
      renderTagBox(boxId, type === 'cat' ? pendingSupplierCategories : type === 'pcat' ? pendingProcessCategories : pendingSupplierBrands, type);
      document.getElementById('tagInput_' + type)?.focus();
    }
  };
  box.appendChild(inp);
}

function removeSupplierTag(type, idx) {
  if (type === 'cat') pendingSupplierCategories.splice(idx, 1);
  else if (type === 'pcat') pendingProcessCategories.splice(idx, 1);
  else pendingSupplierBrands.splice(idx, 1);
  const boxId = type === 'cat' ? 'sfCatBox' : type === 'pcat' ? 'ep_catBox' : 'sfBrandBox';
  const arr = type === 'cat' ? pendingSupplierCategories : type === 'pcat' ? pendingProcessCategories : pendingSupplierBrands;
  renderTagBox(boxId, arr, type);
}

function openSupplierModal(idx = null, prefill = {}) {
  editingSupplierIdx = idx;
  const s = idx !== null ? suppliers[idx] : null;
  const gs = s ? globalSuppliersList.find(g => g.name.trim().toLowerCase() === s.name.trim().toLowerCase()) : null;
  pendingSupplierCategories = gs ? [...(gs.categories || [])] : (prefill.categories || []);
  pendingSupplierBrands = gs ? [...(gs.brands || [])] : [];
  showModal(`
    <div class="modal-tag">${s ? 'Editar Fornecedor' : 'Novo Fornecedor'}</div>
    <div class="modal-title">${s ? esc(s.name) : 'Adicionar Fornecedor'}</div>
    <datalist id="supplierNameList">${Object.values(supplierHistory).map(sh=>`<option value="${esc(sh.name)}">`).join('')}</datalist>
    <div class="form-grid-2">
      <div><label>Nome</label><input id="sf_name" value="" placeholder="Ex: Tech Solutions" list="supplierNameList" oninput="autoFillSupplierEmail(this.value)"></div>
      <div><label>Email Principal</label><input id="sf_email" value="" placeholder="email@fornecedor.com"></div>
    </div>
    <div class="form-grid-2">
      <div><label>Email CC <span style="font-size:11px;color:var(--muted);font-weight:400">(2º contacto — opcional)</span></label><input id="sf_email_cc" value="" placeholder="cc@fornecedor.com"></div>
      <div></div>
    </div>
    <div class="form-grid-2">
      <div><label>Estado</label>
        <select id="sf_status">
          ${['Not contacted','Request sent','Waiting response','Follow-up needed','Replied partial','Replied complete','No stock','Not available','Ignored / no response'].map(v=>`<option ${(s?.status||'Not contacted')===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding-top:20px">
        <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer">
          <input type="checkbox" id="sf_foreign" ${s?.is_foreign?'checked':''} onchange="toggleForeignBox(this.checked)" style="width:auto">
          <span style="font-size:13px;color:var(--text)">Fornecedor Estrangeiro</span>
        </label>
      </div>
    </div>
    <div id="sf_foreignBox" class="${s?.is_foreign?'foreign-box show':'foreign-box'}">
      <div><label>Câmbio (MZN)</label><input type="number" step="0.01" id="sf_cambio" value="${s?.cambio||''}" placeholder="63.5"></div>
      <div><label>Transporte</label><input type="number" step="0.01" id="sf_transport" value="${s?.transport||''}" placeholder="1500.00"></div>
      <div><label>Direitos (%)</label><input type="number" step="0.1" id="sf_direitos" value="${s?.direitos||''}" placeholder="7.5"></div>
    </div>
    <div class="form-grid-2">
      <div><label>Último Contacto</label><input type="date" id="sf_last" value="${s?.last_contact_at||''}"></div>
      <div><label>Próximo Follow-up</label><input type="date" id="sf_followup" value="${s?.next_followup_at||''}"></div>
    </div>
    <div class="form-row"><label>Notas</label><textarea id="sf_notes"></textarea></div>
    <div class="form-grid-2">
      <div>
        <label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipos de equipamento — opcional)</span></label>
        <div class="tag-input-box" id="sfCatBox"></div>
      </div>
      <div>
        <label>Marcas <span style="font-size:11px;color:var(--muted);font-weight:400">(opcional)</span></label>
        <div class="tag-input-box" id="sfBrandBox"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveSupplier()">Guardar</button>
    </div>
  `);
  const _sf = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : String(v); };
  _sf('sf_name', s?.name || prefill.name || '');
  _sf('sf_email', s?.email || prefill.email || '');
  _sf('sf_email_cc', s?.email_cc || prefill.email_cc || '');
  _sf('sf_notes', s?.notes || '');
  renderTagBox('sfCatBox', pendingSupplierCategories, 'cat');
  renderTagBox('sfBrandBox', pendingSupplierBrands, 'brand');
  if (document.getElementById('ep_catBox')) renderTagBox('ep_catBox', pendingProcessCategories, 'pcat');
}

function toggleForeignBox(val) {
  document.getElementById('sf_foreignBox').className = val ? 'foreign-box show' : 'foreign-box';
}

async function saveSupplier() {
  const fields = {
    process_id:       processId,
    name:             document.getElementById('sf_name').value.trim(),
    email:            document.getElementById('sf_email').value.trim() || null,
    status:           document.getElementById('sf_status').value,
    is_foreign:       document.getElementById('sf_foreign').checked,
    cambio:           parseFloat(document.getElementById('sf_cambio')?.value) || null,
    transport:        parseFloat(document.getElementById('sf_transport')?.value) || null,
    direitos:         parseFloat(document.getElementById('sf_direitos')?.value) || 0,
    last_contact_at:  document.getElementById('sf_last').value || null,
    next_followup_at: document.getElementById('sf_followup').value || null,
    notes:            document.getElementById('sf_notes').value.trim() || null,
    email_cc:         document.getElementById('sf_email_cc').value.trim() || null,
  };
  if (!fields.name) { showToast('Nome do fornecedor é obrigatório.', true); return; }
  if (fields.name.length > 200) { showToast('Nome demasiado longo (máx 200 caracteres).', true); return; }
  if (fields.email && (fields.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))) { showToast('Email inválido.', true); return; }
  if (fields.email_cc && (fields.email_cc.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email_cc))) { showToast('Email CC inválido.', true); return; }
  if (fields.notes && fields.notes.length > 5000) { showToast('Notas demasiado longas (máx 5000 caracteres).', true); return; }

  // Response time tracking
  const prev = editingSupplierIdx !== null ? suppliers[editingSupplierIdx] : null;
  const now = new Date().toISOString();
  const repliedStatuses = ['Replied partial', 'Replied complete'];
  if (fields.status === 'Request sent' && prev?.status !== 'Request sent') {
    fields.contacted_at = now;
  }
  let shouldRecordResponse = false;
  let responseHours = 0;
  if (!repliedStatuses.includes(prev?.status) && repliedStatuses.includes(fields.status)) {
    fields.replied_at = now;
    if (prev?.contacted_at) {
      responseHours = (new Date(now) - new Date(prev.contacted_at)) / 3600000;
      if (responseHours > 0 && responseHours < 8760) shouldRecordResponse = true;
    }
  }

  try {
    if (editingSupplierIdx !== null) {
      await API.updateSupplier(suppliers[editingSupplierIdx].id, fields);
    } else {
      await API.createSupplier(fields);
    }
    if (shouldRecordResponse) {
      try { await API.recordSupplierResponse(fields.name, responseHours); } catch(_) {}
    }
    // Silently merge categories/brands into global supplier profile
    try { await API.upsertGlobalSupplier(fields.name, fields.email || '', fields.email_cc || '', pendingSupplierCategories, pendingSupplierBrands); globalSuppliersList = await API.getGlobalSuppliers(); } catch(_) {}
    closeModal();
    suppliers = await API.getSuppliers(processId);
    renderSuppliers();
    renderSupplierSuggestions();
    showToast('Fornecedor guardado.');
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

function deleteSupplier(id) {
  if (!UUID_RE.test(id)) return;
  const s = suppliers.find(x => x.id === id);
  showModal(`
    <div class="modal-tag">Confirmar</div>
    <div class="modal-title">Apagar Fornecedor</div>
    <div style="color:var(--muted);font-size:14px;margin-bottom:24px">Apagar <strong style="color:#fff">${esc(s?.name||'')}</strong>? Esta ação não pode ser desfeita.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="doDeleteSupplier('${id}')">Apagar</button>
    </div>
  `);
}

async function doDeleteSupplier(id) {
  if (!UUID_RE.test(id)) return;
  try {
    await API.deleteSupplier(id);
    suppliers = suppliers.filter(s => s.id !== id);
    closeModal();
    renderSuppliers();
    renderMatchingTab();
    showToast('Fornecedor removido.');
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Quotation Upload ──
function uploadQuotation(supplierId) {
  if (!UUID_RE.test(supplierId)) return;
  currentQuotSuppId = supplierId;
  const input = document.getElementById('quotFileInput');
  input.value = '';
  input.click();
}

function openManualQuotEntry(supplierId) {
  if (!UUID_RE.test(supplierId)) return;
  currentQuotSuppId = supplierId;
  const existing = quotationMap[supplierId] || [];
  pendingQuotItems = existing.map(qi => ({
    raw_part_number: qi.raw_part_number,
    raw_description: qi.raw_description,
    quantity: qi.quantity,
    price: qi.price,
    currency: qi.currency,
  }));
  pendingQuotFile = null;
  openQuotationValModal(existing.length ? 'Editar Cotação' : 'Entrada Manual');
}

function _askReplaceOrAppend(existingItems, newItems, onReplace, onAppend) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--surface);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.4)';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:8px';
  title.textContent = 'Cotação já existente';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:22px;line-height:1.5';
  body.textContent = `Este fornecedor já tem ${existingItems.length} item(ns) guardado(s). O que pretendes fazer com os ${newItems.length} item(ns) novos?`;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'btn btn-ghost btn-sm';
  btnCancel.textContent = 'Cancelar';
  const btnAppend = document.createElement('button');
  btnAppend.className = 'btn btn-secondary btn-sm';
  btnAppend.textContent = 'Adicionar aos existentes';
  const btnReplace = document.createElement('button');
  btnReplace.className = 'btn btn-primary btn-sm';
  btnReplace.textContent = 'Substituir tudo';
  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnAppend);
  btnRow.appendChild(btnReplace);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  btnCancel.addEventListener('click', close);
  btnReplace.addEventListener('click', () => { close(); onReplace(); });
  btnAppend.addEventListener('click', () => { close(); onAppend(); });
}

async function handleQuotationUpload(input) {
  if (!input.files.length || !currentQuotSuppId) return;
  const file = input.files[0];

  if (file.size > MAX_UPLOAD_SIZE) { showToast(`Ficheiro demasiado grande (máx ${MAX_UPLOAD_SIZE / 1024 / 1024}MB).`, true); return; }
  if (!ALLOWED_QUOT_TYPES.includes(file.type) && !file.name.match(/\.(xlsx?|pdf)$/i)) { showToast('Tipo de ficheiro não permitido. Usa .xlsx, .xls ou .pdf.', true); return; }

  pendingQuotFile = file;
  if (file.name.toLowerCase().endsWith('.pdf')) {
    await handlePdfQuotation(file);
  } else {
    const buf = await file.arrayBuffer();
    const { items, detected } = parseQuotationExcel(buf);
    const newItems = detected ? items.map(i => ({...i})) : [];
    if (!detected) showToast('Formato não detetado — adiciona itens manualmente.', true);
    const existing = (quotationMap[currentQuotSuppId] || []).map(qi => ({
      raw_part_number: qi.raw_part_number || null,
      raw_description: qi.raw_description,
      quantity: qi.quantity,
      price: qi.price,
      currency: qi.currency,
    }));
    if (existing.length && newItems.length) {
      _askReplaceOrAppend(existing, newItems,
        () => { pendingQuotItems = newItems; openQuotationValModal(file.name); },
        () => { pendingQuotItems = [...existing, ...newItems]; openQuotationValModal(file.name); }
      );
    } else {
      pendingQuotItems = newItems;
      openQuotationValModal(file.name);
    }
  }
}

function parseQuotationExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const priceKw = ['preço','preco','price','valor','unit','unitár','unitár','custo'];
  const descKw  = ['descri','artigo','produto','item','designa','material','equipment'];
  const qtyKw   = ['qty','quant','quantidade','qnt'];
  const partKw  = ['part','ref','código','codigo','code','p/n'];

  let headerRow = -1, colDesc = -1, colQty = -1, colPrice = -1, colPart = -1;

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(c => String(c||'').toLowerCase().trim());
    let price=-1, desc=-1, qty=-1, part=-1;
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      if (price===-1 && priceKw.some(k=>c.includes(k))) price=j;
      if (desc ===-1 && descKw .some(k=>c.includes(k))) desc=j;
      if (qty  ===-1 && qtyKw  .some(k=>c.includes(k))) qty=j;
      if (part ===-1 && partKw .some(k=>c.includes(k))) part=j;
    }
    if (price !== -1 && desc !== -1) {
      headerRow=i; colPrice=price; colDesc=desc; colQty=qty; colPart=part; break;
    }
  }

  if (headerRow === -1) return { items: [], detected: false };

  const items = [];
  for (let i = headerRow+1; i < rows.length; i++) {
    const row = rows[i];
    const desc  = String(row[colDesc]||'').trim();
    const rawP  = String(row[colPrice]||'').replace(/[^\d.,]/g,'').replace(',','.');
    const price = parseFloat(rawP);
    const qty   = colQty!==-1 ? parseFloat(String(row[colQty]||'').replace(',','.')) : 1;
    const part  = colPart!==-1 ? String(row[colPart]||'').trim() : null;
    if (!desc || isNaN(price) || price <= 0) continue;
    items.push({
      raw_part_number: part||null,
      raw_description: desc,
      quantity: isNaN(qty)||qty<=0 ? 1 : qty,
      price,
      currency: 'MZN',
    });
  }
  return { items, detected: true };
}

function openQuotationValModal(fileName, rawPdfText) {
  const s = suppliers.find(x => x.id === currentQuotSuppId);
  showModalLg(`
    <div class="modal-tag">Cotação — ${esc(s?.name||'')}</div>
    <div class="modal-title">${esc(fileName)}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">${pendingQuotItems.length} linha(s) detetada(s). Revê e confirma antes de guardar.</div>
    <div style="max-height:380px;overflow-y:auto;margin-bottom:12px">
      <table class="bom-validate-table">
        <thead><tr>
          <th style="width:12%">Part #</th>
          <th style="width:42%">Descrição</th>
          <th style="width:8%">Qty</th>
          <th style="width:14%">Preço Unit.</th>
          <th style="width:10%">Moeda</th>
          <th style="width:14%"></th>
        </tr></thead>
        <tbody id="quotValTbody"></tbody>
      </table>
    </div>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="addQuotRow()">+ Linha</button>
      ${rawPdfText ? `<button class="btn btn-ghost btn-sm" onclick="document.getElementById('quotRaw').style.display=document.getElementById('quotRaw').style.display==='none'?'block':'none'">Ver texto extraído</button>` : ''}
    </div>
    ${rawPdfText ? `<div id="quotRaw" style="display:none;margin-bottom:12px"><textarea id="quotRawTa" style="width:100%;min-height:100px;max-height:180px;background:#0a0a0a;border:1px solid var(--border);color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:11px;padding:10px;resize:none;border-radius:4px" readonly></textarea></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="confirmQuotation()">Guardar Cotação</button>
    </div>
  `);
  const _qrt = document.getElementById('quotRawTa');
  if (_qrt && rawPdfText) _qrt.value = rawPdfText;
  priceAnomalies = {};
  renderQuotValTable();
  checkPriceAnomalies(pendingQuotItems).then(a => {
    if (Object.keys(a).length) { priceAnomalies = a; renderQuotValTable(); }
  });
}

function renderQuotValTable() {
  const tbody = document.getElementById('quotValTbody');
  if (!tbody) return;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  pendingQuotItems.forEach((item, i) => {
    const tr = document.createElement('tr');

    // Part #
    const tdPart = document.createElement('td');
    const inPart = document.createElement('input');
    inPart.type = 'text'; inPart.value = item.raw_part_number || ''; inPart.style.width = '100%';
    inPart.onchange = function() { pendingQuotItems[i].raw_part_number = this.value || null; };
    tdPart.appendChild(inPart);

    // Descrição
    const tdDesc = document.createElement('td');
    const inDesc = document.createElement('input');
    inDesc.type = 'text'; inDesc.value = item.raw_description; inDesc.style.width = '100%';
    inDesc.onchange = function() { pendingQuotItems[i].raw_description = this.value; };
    tdDesc.appendChild(inDesc);

    // Qty
    const tdQty = document.createElement('td');
    const inQty = document.createElement('input');
    inQty.type = 'number'; inQty.value = item.quantity; inQty.style.width = '55px';
    inQty.onchange = function() { pendingQuotItems[i].quantity = parseFloat(this.value) || 1; };
    tdQty.appendChild(inQty);

    // Preço + anomaly badge
    const tdPrice = document.createElement('td');
    const inPrice = document.createElement('input');
    inPrice.type = 'number'; inPrice.step = '0.01'; inPrice.value = item.price; inPrice.style.width = '80px';
    inPrice.onchange = function() {
      pendingQuotItems[i].price = parseFloat(this.value) || 0;
      // recheck anomaly for this row on price change
      checkPriceAnomalies(pendingQuotItems).then(a => { priceAnomalies = a; renderQuotValTable(); });
    };
    tdPrice.appendChild(inPrice);
    const a = priceAnomalies[i];
    if (a) {
      const badge = document.createElement('span');
      badge.className = a.type === 'high' ? 'anomaly-high' : 'anomaly-low';
      badge.textContent = a.type === 'high'
        ? '\u26a0 ' + a.ratio + '\u00d7 acima (\u00f8' + fmtPrice(a.median) + ')'
        : '\u26a0 ' + a.ratio + '\u00d7 abaixo (\u00f8' + fmtPrice(a.median) + ')';
      tdPrice.appendChild(badge);
    }

    // Moeda
    const tdCur = document.createElement('td');
    const sel = document.createElement('select');
    sel.style.width = '66px';
    ['MZN','USD','EUR','ZAR'].forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if ((item.currency || 'MZN') === c) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = function() { pendingQuotItems[i].currency = this.value; };
    tdCur.appendChild(sel);

    // Delete
    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm'; delBtn.textContent = '\u00d7';
    delBtn.onclick = () => { pendingQuotItems.splice(i, 1); renderQuotValTable(); };
    tdDel.appendChild(delBtn);

    tr.appendChild(tdPart); tr.appendChild(tdDesc); tr.appendChild(tdQty);
    tr.appendChild(tdPrice); tr.appendChild(tdCur); tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
}

function addQuotRow() {
  pendingQuotItems.push({ raw_part_number: null, raw_description: '', quantity: 1, price: 0, currency: 'MZN' });
  renderQuotValTable();
}

async function confirmQuotation() {
  const valid = pendingQuotItems.filter(i => i.raw_description.trim() && i.price > 0);
  if (!valid.length) { showToast('Adiciona pelo menos um item com preço.', true); return; }
  try {
    await API.deleteQuotationItems(currentQuotSuppId);
    await API.saveQuotationItems(valid.map(i => ({ ...i, supplier_id: currentQuotSuppId })));
    quotationMap[currentQuotSuppId] = await API.getQuotationItems(currentQuotSuppId);

    if (pendingQuotFile) {
      const ext = pendingQuotFile.name.split('.').pop();
      const filePath = `quotations/${currentQuotSuppId}/${Date.now()}.${ext}`;
      await API.uploadFile('procurement-files', filePath, pendingQuotFile);
      await API.saveQuotationFile(currentQuotSuppId, filePath, pendingQuotFile.name);
      quotationFilesMap[currentQuotSuppId] = { file_path: filePath, original_name: pendingQuotFile.name };
      pendingQuotFile = null;
    }

    // Populate savedAnomalyMap for supplier card display
    const savedItems = quotationMap[currentQuotSuppId] || [];
    const anomalyCount = Object.keys(priceAnomalies).length;
    if (anomalyCount) {
      valid.forEach((item, idx) => {
        const saved = savedItems[idx];
        if (saved?.id && priceAnomalies[idx]) savedAnomalyMap[saved.id] = priceAnomalies[idx];
      });
    }

    closeModal();
    if (anomalyCount) {
      const el = document.getElementById('toast');
      el.textContent = `Cotação guardada. ${anomalyCount} item(ns) com preço fora do histórico — verifica os valores.`;
      el.style.color = '#fb923c';
      el.style.borderLeftColor = '#fb923c';
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 4500);
    } else {
      showToast(`${valid.length} itens de cotação guardados.`);
    }
    renderSuppliers();
    renderMatchingTab();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── File View ──
function _isValidFilePath(p) {
  return typeof p === 'string' && p.length < 500 && !p.includes('..') && (p.startsWith('bom/') || p.startsWith('quotations/'));
}

async function viewBomFile(filePath) {
  if (!_isValidFilePath(filePath)) { showToast('Caminho de ficheiro inválido.', true); return; }
  try {
    const url = await API.getSignedUrl('procurement-files', filePath);
    window.open(url, '_blank');
  } catch(e) { showToast('Erro ao abrir ficheiro.', true); }
}

async function viewQuotFile(filePath) {
  if (!_isValidFilePath(filePath)) { showToast('Caminho de ficheiro inválido.', true); return; }
  try {
    const url = await API.getSignedUrl('procurement-files', filePath);
    window.open(url, '_blank');
  } catch(e) { showToast('Erro ao abrir ficheiro.', true); }
}

// ── Matching Tab ──
function switchMatchingView(v) {
  matchingView = v;
  renderMatchingTab();
}

function renderMatchingTab() {
  const el = document.getElementById('matchingContent');
  if (!el) return;
  el.replaceChildren();

  if (!bomItems.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Carrega o BOM primeiro.';
    el.appendChild(d);
    return;
  }
  if (!suppliers.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Adiciona fornecedores primeiro.';
    el.appendChild(d);
    return;
  }

  const equipItems = bomItems.filter(bi => !bi.is_service);
  const serviceItems = bomItems.filter(bi => bi.is_service);

  // Build lookups (shared by both views)
  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }
  const selLookup = {};
  for (const o of selectedOffers) selLookup[o.bom_item_id] = o.supplier_id;

  const covered = equipItems.filter(bi => matchLookup[bi.id] && Object.keys(matchLookup[bi.id]).length > 0).length;
  const pct = equipItems.length ? Math.round(covered / equipItems.length * 100) : 0;
  const pctColor = pct === 100 ? 'var(--accent)' : pct > 50 ? '#4fc3f7' : 'var(--danger)';

  // ── Toggle bar ──
  const toggleBar = document.createElement('div');
  toggleBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px';

  ['matching', 'comparacao'].forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm' + (matchingView === v ? ' btn-primary' : ' btn-ghost');
    btn.textContent = v === 'matching' ? 'Matching' : 'Comparação';
    btn.addEventListener('click', () => switchMatchingView(v));
    toggleBar.appendChild(btn);
  });
  el.appendChild(toggleBar);

  if (matchingView === 'matching') {
    _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems);
  } else {
    _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems);
  }
}

function _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems) {
  const pctColor2 = pctColor;
  let html = `
    <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;flex-wrap:wrap">
      <div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">COBERTURA</div>
        <div style="font-size:28px;font-weight:700;color:${pctColor2}">${pct}%</div>
        <div style="color:var(--muted);font-size:12px">${covered}/${equipItems.length} itens</div>
      </div>
      <div style="flex:1">
        <div class="coverage-bar"><div class="coverage-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="runAutoMatch()">⚡ Auto-Match</button>
    </div>
    <div style="overflow-x:auto">
    <table class="match-table">
      <thead><tr>
        <th style="min-width:260px">Item BOM</th>
        <th style="text-align:center;width:50px">Qty</th>
        ${suppliers.map(s=>`<th style="text-align:center;min-width:140px">${esc(s.name)}</th>`).join('')}
        <th style="text-align:center;width:110px">Escolha</th>
      </tr></thead>
      <tbody>`;

  let lastCat = null;
  for (const bi of equipItems) {
    if (bi.category && bi.category !== lastCat) {
      html += `<tr class="match-cat-row"><td colspan="${3+suppliers.length}">${esc(bi.category)}</td></tr>`;
      lastCat = bi.category;
    }
    const selectedSuppId = selLookup[bi.id];
    let lowestPrice = Infinity;
    for (const s of suppliers) {
      const p = matchLookup[bi.id]?.[s.id]?.quotation_items?.price;
      if (p != null && p < lowestPrice) lowestPrice = p;
    }
    html += `<tr>
      <td>
        <div style="font-size:13px">${esc(bi.description)}</div>
        ${bi.part_number?`<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">${esc(bi.part_number)}</div>`:''}
      </td>
      <td style="text-align:center;color:var(--muted);font-size:12px">${bi.quantity}</td>
      ${suppliers.map(s => {
        const m = matchLookup[bi.id]?.[s.id];
        const isSel = selectedSuppId === s.id;
        const price = m?.quotation_items?.price;
        const isLowest = price != null && price === lowestPrice && lowestPrice < Infinity;
        if (m) {
          return `<td><div class="match-cell${isSel?' match-selected':''}${isLowest&&!isSel?' match-lowest':''}" onclick="openMatchModal('${bi.id}','${s.id}')">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600">${fmtPrice(price)}</div>
            ${isSel?`<div style="font-size:9px;color:var(--accent);letter-spacing:1px">SELECIONADO</div>`:''}
            ${isLowest&&!isSel?`<div style="font-size:9px;color:#4fc3f7;letter-spacing:1px">MAIS BAIXO</div>`:''}
          </div></td>`;
        }
        return `<td><div class="match-cell match-empty" onclick="openMatchModal('${bi.id}','${s.id}')">+</div></td>`;
      }).join('')}
      <td style="text-align:center">
        ${selectedSuppId
          ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent)">${esc(suppliers.find(s=>s.id===selectedSuppId)?.name||'')}</span>`
          : `<span style="color:#333">—</span>`}
      </td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  el.appendChild(document.createRange().createContextualFragment(html));
}

function _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems) {
  const hasServices = serviceItems.length > 0;
  const numCols = suppliers.length + (hasServices ? 1 : 0);

  const suppCoverage = {};
  for (const s of suppliers) suppCoverage[s.id] = equipItems.filter(bi => matchLookup[bi.id]?.[s.id] != null).length;
  const topSupp = suppliers.reduce((best, s) => suppCoverage[s.id] > (suppCoverage[best?.id] || 0) ? s : best, null);

  const colTotals = {};
  for (const s of suppliers) {
    colTotals[s.id] = equipItems.reduce((sum, bi) => {
      const p = matchLookup[bi.id]?.[s.id]?.quotation_items?.price;
      return sum + (p != null ? p : 0);
    }, 0);
  }

  const totalSelected = selectedOffers.reduce((sum, o) => {
    const p = matchLookup[o.bom_item_id]?.[o.supplier_id]?.quotation_items?.price;
    return sum + (p || 0);
  }, 0);

  const serviceTotal = serviceItems.reduce((sum, bi) => sum + ((bi.service_price || 0) * (bi.quantity || 1)), 0);

  let html = `
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px">
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">COBERTURA</div>
        <div style="font-size:24px;font-weight:700;color:${pctColor}">${pct}%</div>
        <div style="color:var(--muted);font-size:12px">${covered}/${equipItems.length} itens</div>
      </div>
      ${topSupp ? `<div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">MAIS COBERTURA</div>
        <div style="font-size:15px;font-weight:600;color:#fff">${esc(topSupp.name)}</div>
        <div style="color:var(--muted);font-size:12px">${suppCoverage[topSupp.id]} itens</div>
      </div>` : ''}
      ${totalSelected > 0 ? `<div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">TOTAL SELECIONADO</div>
        <div style="font-size:15px;font-weight:600;color:var(--accent)">${fmtPrice(totalSelected)}</div>
      </div>` : ''}
      ${serviceTotal > 0 ? `<div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">SERVIÇOS TRIANA</div>
        <div style="font-size:15px;font-weight:600;color:var(--warn)">${fmtPrice(serviceTotal)}</div>
      </div>` : ''}
    </div>
    <div class="comp-wrap">
    <table class="comp-table">
      <thead><tr>
        <th>Item BOM</th>
        ${suppliers.map(s => `<th>${esc(s.name)}</th>`).join('')}
        ${hasServices ? '<th style="color:var(--warn)">Triana</th>' : ''}
      </tr></thead>
      <tbody>`;

  let lastCat = null;
  for (const bi of bomItems) {
    if (bi.category && bi.category !== lastCat) {
      html += `<tr class="comp-cat-row"><td colspan="${1 + numCols}">${esc(bi.category)}</td></tr>`;
      lastCat = bi.category;
    }

    if (bi.is_service) {
      const svcTotal = (bi.service_price || 0) * (bi.quantity || 1);
      html += `<tr>
        <td>
          <div style="font-size:13px;color:var(--warn)">${esc(bi.description)}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--warn);opacity:.6">Qty: ${bi.quantity || 1}</div>
        </td>
        ${suppliers.map(() => '<td></td>').join('')}
        <td><span class="comp-cell" style="color:var(--warn)">${svcTotal > 0 ? fmtPrice(svcTotal) : '—'}<span style="font-size:9px;opacity:.7;margin-left:3px">MZN</span></span></td>
      </tr>`;
    } else {
      let lowestPrice = Infinity;
      for (const s of suppliers) {
        const p = matchLookup[bi.id]?.[s.id]?.quotation_items?.price;
        if (p != null && p < lowestPrice) lowestPrice = p;
      }
      const selectedSuppId = selLookup[bi.id];
      html += `<tr>
        <td>
          <div style="font-size:13px">${esc(bi.description)}</div>
          ${bi.part_number ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)">${esc(bi.part_number)}</div>` : ''}
        </td>
        ${suppliers.map(s => {
          const m = matchLookup[bi.id]?.[s.id];
          const price = m?.quotation_items?.price;
          const currency = m?.quotation_items?.currency || '';
          const isSel = selectedSuppId === s.id;
          const isLow = price != null && price === lowestPrice && lowestPrice < Infinity;
          if (price != null) {
            const cls = isSel && isLow ? 'comp-cell comp-cell-both' : isSel ? 'comp-cell comp-cell-sel' : isLow ? 'comp-cell comp-cell-low' : 'comp-cell';
            return `<td><span class="${cls}">${fmtPrice(price)}<span style="font-size:9px;opacity:.7;margin-left:3px">${esc(currency)}</span></span></td>`;
          }
          return `<td><span class="comp-cell comp-cell-none">—</span></td>`;
        }).join('')}
        ${hasServices ? '<td></td>' : ''}
      </tr>`;
    }
  }

  html += `</tbody>
    <tfoot><tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase">Total Equipamento</td>
      ${suppliers.map(s => `<td>${colTotals[s.id] > 0 ? fmtPrice(colTotals[s.id]) : '<span style="color:#334">—</span>'}</td>`).join('')}
      ${hasServices ? `<td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--warn);font-weight:600">${serviceTotal > 0 ? fmtPrice(serviceTotal) : '—'}</td>` : ''}
    </tr></tfoot>
    </table></div>`;

  el.appendChild(document.createRange().createContextualFragment(html));
}

function openMatchModal(bomItemId, supplierId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId)) return;
  const bi    = bomItems.find(x => x.id === bomItemId);
  const s     = suppliers.find(x => x.id === supplierId);
  const qItems = quotationMap[supplierId] || [];
  const currentMatch = matches.find(m => m.bom_item_id === bomItemId && m.supplier_id === supplierId);
  const selOffer = selectedOffers.find(o => o.bom_item_id === bomItemId);
  const isSelectedSupp = selOffer?.supplier_id === supplierId;

  showModal(`
    <div class="modal-tag">${esc(s?.name||'')}</div>
    <div class="modal-title" style="font-size:15px;margin-bottom:4px">${esc(bi?.description||'')}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:16px">Qty BOM: ${bi?.quantity} ${bi?.unit||''}</div>
    ${!qItems.length ? `<div style="color:var(--muted);font-size:13px;margin-bottom:16px">Este fornecedor não tem cotação carregada.<br><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="closeModal();uploadQuotation('${supplierId}')">📎 Carregar Cotação</button></div>` : `
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:8px">SELECIONA UM ITEM DA COTAÇÃO</div>
      <div style="max-height:300px;overflow-y:auto;margin-bottom:16px">
        ${qItems.map(qi => {
          const isLinked = currentMatch?.quotation_item_id === qi.id;
          return `<div class="match-pick-row${isLinked?' linked':''}" onclick="linkItem('${bomItemId}','${supplierId}','${qi.id}')">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(qi.raw_description)}</div>
              ${qi.raw_part_number?`<div style="font-size:10px;color:var(--muted)">${esc(qi.raw_part_number)}</div>`:''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600">${fmtPrice(qi.price)}</div>
              <div style="font-size:10px;color:var(--muted)">${qi.currency}</div>
            </div>
            ${isLinked?`<div style="font-size:9px;color:var(--accent);letter-spacing:1px;white-space:nowrap">✓${isSelectedSupp?' SEL.':''}</div>`:''}
          </div>`;
        }).join('')}
      </div>
    `}
    <div class="modal-actions">
      ${currentMatch ? `
        <button class="btn btn-ghost btn-sm" onclick="selectOffer('${bomItemId}','${supplierId}','${currentMatch.quotation_item_id}')">✓ Selecionar como melhor oferta</button>
        <button class="btn btn-danger btn-sm" onclick="unlinkItem('${bomItemId}','${supplierId}','${currentMatch.id}')">Remover</button>
      ` : ''}
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
    </div>
  `);
}

async function linkItem(bomItemId, supplierId, quotItemId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId) || !UUID_RE.test(quotItemId)) return;
  try {
    // Optimistic update — reflect change immediately
    const qi = (quotationMap[supplierId] || []).find(q => q.id === quotItemId);
    const existing = matches.findIndex(m => m.bom_item_id === bomItemId && m.supplier_id === supplierId);
    const optimistic = { id: '_tmp', process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotItemId, match_type: 'manual', quotation_items: qi };
    if (existing >= 0) matches[existing] = optimistic;
    else matches.push(optimistic);
    closeModal();
    renderMatchingTab();
    showToast('Item ligado.');
    // Persist and update local id
    const saved = await API.saveMatch({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotItemId, match_type: 'manual' });
    const idx = matches.findIndex(m => m.bom_item_id === bomItemId && m.supplier_id === supplierId);
    if (idx >= 0) matches[idx] = { ...matches[idx], ...saved, quotation_items: qi };
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function unlinkItem(bomItemId, supplierId, matchId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId) || !UUID_RE.test(matchId)) return;
  try {
    const wasSelected = !!selectedOffers.find(o => o.bom_item_id === bomItemId && o.supplier_id === supplierId);
    // Optimistic update
    matches = matches.filter(m => m.id !== matchId);
    if (wasSelected) selectedOffers = selectedOffers.filter(o => !(o.bom_item_id === bomItemId && o.supplier_id === supplierId));
    closeModal();
    renderMatchingTab();
    // Persist
    await API.deleteMatch(matchId);
    if (wasSelected) await API.deleteSelectedOffer(processId, bomItemId);
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function selectOffer(bomItemId, supplierId, quotItemId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId) || !UUID_RE.test(quotItemId)) return;
  try {
    const qi = (quotationMap[supplierId] || []).find(q => q.id === quotItemId);
    // Optimistic update
    selectedOffers = selectedOffers.filter(o => o.bom_item_id !== bomItemId);
    selectedOffers.push({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotItemId, suppliers: suppliers.find(s => s.id === supplierId), quotation_items: qi });
    closeModal();
    renderMatchingTab();
    showToast('Oferta selecionada.');
    // Persist
    await API.selectOffer(processId, bomItemId, supplierId, quotItemId);
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function runAutoMatch() {
  if (!bomItems.length) { showToast('Carrega o BOM primeiro.', true); return; }
  const suppliersWithItems = suppliers.filter(s => (quotationMap[s.id]||[]).length > 0);
  if (!suppliersWithItems.length) { showToast('Nenhum fornecedor com cotação carregada.', true); return; }

  const newMatches = [];
  for (const bi of bomItems) {
    if (bi.is_service) continue;
    const biWords = bi.description.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (!biWords.length) continue;
    for (const s of suppliersWithItems) {
      if (matches.find(m => m.bom_item_id === bi.id && m.supplier_id === s.id)) continue; // already matched
      let bestItem = null, bestScore = 0;
      for (const qi of quotationMap[s.id]) {
        const qWords = qi.raw_description.toLowerCase().split(/\W+/);
        const hits = biWords.filter(w => qWords.some(qw => qw === w || (w.length > 3 && qw.includes(w)))).length;
        const score = hits / biWords.length;
        if (score > bestScore) { bestScore = score; bestItem = qi; }
      }
      if (bestItem && bestScore >= 0.4) {
        newMatches.push({ process_id: processId, bom_item_id: bi.id, supplier_id: s.id, quotation_item_id: bestItem.id, match_type: 'auto', confidence: Math.round(bestScore*100)/100 });
      }
    }
  }

  if (!newMatches.length) { showToast('Nenhum match automático encontrado.'); return; }

  try {
    await Promise.all(newMatches.map(m => API.saveMatch(m)));
    await loadMatchData();
    renderMatchingTab();
    showToast(`${newMatches.length} match(es) automático(s) criado(s).`);
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Comparação de Preços (dead code — integrada no Matching tab) ──
function renderComparacaoTab() {
  // Kept as stub — logic moved to _renderComparacaoView inside renderMatchingTab
  const el = document.getElementById('comparacaoContent');
  if (!el) return;
  if (!bomItems.length) {
    el.replaceChildren();
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Carrega o BOM primeiro.';
    el.appendChild(d);
    return;
  }
  if (!suppliers.length) {
    el.replaceChildren();
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Adiciona fornecedores primeiro.';
    el.appendChild(d);
    return;
  }

  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }
  const selLookup = {};
  for (const o of selectedOffers) selLookup[o.bom_item_id] = o.supplier_id;

  const covered = bomItems.filter(bi => matchLookup[bi.id] && Object.keys(matchLookup[bi.id]).length > 0).length;
  const pct = bomItems.length ? Math.round(covered / bomItems.length * 100) : 0;
  const pctColor = pct === 100 ? 'var(--accent)' : pct > 50 ? '#4fc3f7' : 'var(--danger)';

  const suppCoverage = {};
  for (const s of suppliers) suppCoverage[s.id] = bomItems.filter(bi => matchLookup[bi.id]?.[s.id] != null).length;
  const topSupp = suppliers.reduce((best, s) => suppCoverage[s.id] > (suppCoverage[best?.id] || 0) ? s : best, null);

  const totalSelected = selectedOffers.reduce((sum, o) => sum + (matchLookup[o.bom_item_id]?.[o.supplier_id]?.quotation_items?.price || 0), 0);

  const colTotals = {};
  for (const s of suppliers) {
    colTotals[s.id] = bomItems.reduce((sum, bi) => {
      const p = matchLookup[bi.id]?.[s.id]?.quotation_items?.price;
      return sum + (p != null ? p : 0);
    }, 0);
  }

  let html = `
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px">
      <div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">COBERTURA</div>
        <div style="font-size:24px;font-weight:700;color:${pctColor}">${pct}%</div>
        <div style="color:var(--muted);font-size:12px">${covered}/${bomItems.length} itens</div>
      </div>
      ${topSupp ? `<div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">MAIS COBERTURA</div>
        <div style="font-size:15px;font-weight:600;color:#fff">${esc(topSupp.name)}</div>
        <div style="color:var(--muted);font-size:12px">${suppCoverage[topSupp.id]} itens</div>
      </div>` : ''}
      ${totalSelected > 0 ? `<div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px">TOTAL SELECIONADO</div>
        <div style="font-size:15px;font-weight:600;color:var(--accent)">${fmtPrice(totalSelected)}</div>
      </div>` : ''}
    </div>
    <div class="comp-wrap">
    <table class="comp-table">
      <thead><tr>
        <th>Item BOM</th>
        ${suppliers.map(s => `<th>${esc(s.name)}</th>`).join('')}
      </tr></thead>
      <tbody>`;

  let lastCat = null;
  for (const bi of bomItems) {
    if (bi.category && bi.category !== lastCat) {
      html += `<tr class="comp-cat-row"><td colspan="${1 + suppliers.length}">${esc(bi.category)}</td></tr>`;
      lastCat = bi.category;
    }
    let lowestPrice = Infinity;
    for (const s of suppliers) {
      const p = matchLookup[bi.id]?.[s.id]?.quotation_items?.price;
      if (p != null && p < lowestPrice) lowestPrice = p;
    }
    const selectedSuppId = selLookup[bi.id];
    html += `<tr>
      <td>
        <div style="font-size:13px">${esc(bi.description)}</div>
        ${bi.part_number ? `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted)">${esc(bi.part_number)}</div>` : ''}
      </td>
      ${suppliers.map(s => {
        const m = matchLookup[bi.id]?.[s.id];
        const price = m?.quotation_items?.price;
        const currency = m?.quotation_items?.currency || '';
        const isSel = selectedSuppId === s.id;
        const isLow = price != null && price === lowestPrice && lowestPrice < Infinity;
        if (price != null) {
          const cls = isSel && isLow ? 'comp-cell comp-cell-both' : isSel ? 'comp-cell comp-cell-sel' : isLow ? 'comp-cell comp-cell-low' : 'comp-cell';
          return `<td><span class="${cls}">${fmtPrice(price)}<span style="font-size:9px;opacity:.7;margin-left:3px">${esc(currency)}</span></span></td>`;
        }
        return `<td><span class="comp-cell comp-cell-none">—</span></td>`;
      }).join('')}
    </tr>`;
  }

  html += `</tbody>
    <tfoot><tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase">Total</td>
      ${suppliers.map(s => `<td>${colTotals[s.id] > 0 ? fmtPrice(colTotals[s.id]) : '<span style="color:#334">—</span>'}</td>`).join('')}
    </tr></tfoot>
    </table></div>`;

  el.replaceChildren();
  el.appendChild(document.createRange().createContextualFragment(html));
}

// ── PDF Quotation (ported from planilha-generator) ──
async function extractPdfText(ab){
  const pdf=await pdfjsLib.getDocument({data:ab}).promise;let ft='';
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const lm=new Map();
    for(const item of content.items){if(!item.str.trim())continue;const y=Math.round(item.transform[5]/3)*3;if(!lm.has(y))lm.set(y,[]);lm.get(y).push({x:item.transform[4],w:item.width||0,text:item.str});}
    const sy=[...lm.keys()].sort((a,b)=>b-a);
    for(const y of sy){const cells=lm.get(y).sort((a,b)=>a.x-b.x);let line='',pr=null;for(const cell of cells){if(pr!==null){const g=cell.x-pr;line+=g>8?'\t':(g>0.5?' ':'');}line+=cell.text;pr=cell.x+(cell.w||cell.text.length*5);}if(line.trim())ft+=line+'\n';}
    ft+='\n';
  }
  return ft;
}
function parseNum(s){const t=s.trim().replace(/\s/g,'');if(/,\d+$/.test(t)&&t.lastIndexOf(',')>t.lastIndexOf('.'))return parseFloat(t.replace(/\./g,'').replace(',','.'));if(/\.\d+$/.test(t)&&t.lastIndexOf('.')>t.lastIndexOf(','))return parseFloat(t.replace(/,/g,''));return parseFloat(t.replace(/[,.]/g,''));}
function parsePdf(text){
  const SKIP=/^(total|subtotal|grand total|vat|iva|tax|date|page|invoice|quotation|quote|ref|description|qty|quantity|unit price|unit|price|amount|s\.?no\.?|nr\.?|from|to|tel|email|www|http)/i;
  const items=[];
  for(const raw of text.split('\n')){
    const line=raw.trim();if(line.length<4)continue;if(SKIP.test(line))continue;if(!/[a-zA-Z]/.test(line))continue;if(!/\d/.test(line))continue;
    const cols=line.split('\t').map(c=>c.trim()).filter(c=>c.length>0);if(cols.length<2)continue;
    const UR=/\b(UN|MT|M|PC|KG|L|UNID|PÇ|PCS|CX|RL|ROL|ML|CM|G|T|HR|H)\b/i;
    let qty='1',qci=-1,price='';const nc=[];
    for(let i=0;i<cols.length;i++){const c=cols[i];if(c.includes('%'))continue;const m=c.match(/^([\d.,]+(?:\s[\d.,]+)*)\s*([A-Za-z].*)?$/);if(!m)continue;const np=m[1].trim();const sf=(m[2]||'').trim();const v=parseNum(np);if(isNaN(v)||v<=0)continue;if(sf&&UR.test(sf.split(/\s/)[0])){if(qci===-1){qty=String(Math.round(v));qci=i;}}else{nc.push({i,c,v});}}
    if(!nc.length)continue;const pe=nc[nc.length-1];price=String(pe.v);
    if(qci===-1){for(const n of nc){if(n.i===pe.i)continue;const r=Math.round(n.v);if(r>=1&&r<=9999){qty=String(r);qci=n.i;break;}}}
    const ei=new Set([qci,...nc.map(n=>n.i)]);
    const dc=cols.filter((c,i)=>{if(ei.has(i))return false;if(c.includes('%'))return false;if(UR.test(c.trim())&&!/[a-zA-Z]{4,}/.test(c))return false;return true;});
    if(!dc.length)continue;
    let part='',model=dc.join(' ');const fd=dc[0];
    const lr=!/\s/.test(fd)&&fd.length>=4&&((/\d/.test(fd)&&/[A-Za-z]/.test(fd))||/^\d{5,}$/.test(fd));
    if(lr&&dc.length>1){part=fd;model=dc.slice(1).join(' ').trim();if(model.length<2){model=dc.join(' ');part='';}}
    if(!model||model.length<2)continue;
    items.push({part,model,qty,price});
  }
  return items;
}
async function handlePdfQuotation(file) {
  if (!window.pdfjsLib) { showToast('PDF.js não carregou.', true); return; }
  try {
    const buf = await file.arrayBuffer();
    const rawText = await extractPdfText(buf);
    const parsed = parsePdf(rawText);
    // PDF price = total; convert to unit price
    const newPdfItems = parsed.map(item => {
      const qty = parseFloat(item.qty) || 1;
      const total = parseFloat(item.price) || 0;
      const unitPrice = total > 0 ? Math.round((total / qty) * 100) / 100 : 0;
      return { raw_part_number: item.part || null, raw_description: item.model, quantity: qty, price: unitPrice, currency: 'MZN' };
    });
    if (!newPdfItems.length) showToast('Nenhum item detetado no PDF — adiciona manualmente.', true);
    const existingPdf = (quotationMap[currentQuotSuppId] || []).map(qi => ({
      raw_part_number: qi.raw_part_number || null,
      raw_description: qi.raw_description,
      quantity: qi.quantity,
      price: qi.price,
      currency: qi.currency,
    }));
    if (existingPdf.length && newPdfItems.length) {
      _askReplaceOrAppend(existingPdf, newPdfItems,
        () => { pendingQuotItems = newPdfItems; openQuotationValModal(file.name, rawText); },
        () => { pendingQuotItems = [...existingPdf, ...newPdfItems]; openQuotationValModal(file.name, rawText); }
      );
    } else {
      pendingQuotItems = newPdfItems;
      openQuotationValModal(file.name, rawText);
    }
  } catch(e) { showToast('Erro ao ler PDF: ' + e.message, true); }
}

// ── Installation costs ──
function renderInstallTab() {
  const container = document.getElementById('install-content');
  if (!container) return;
  container.replaceChildren();

  const svcBySheet = {};
  for (const bi of bomItems) {
    if (!bi.is_service) continue;
    const s = bi.sheet_name || 'Sheet1';
    if (!svcBySheet[s]) svcBySheet[s] = [];
    svcBySheet[s].push(bi);
  }
  const sheets = [...new Set(bomItems.filter(bi => bi.is_service).map(bi => bi.sheet_name || 'Sheet1'))];

  if (!sheets.length) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.style.cssText = 'color:var(--muted);font-size:13px;text-align:center;padding:32px';
    empty.textContent = 'Nenhum serviço ativo. Ativa o switch de serviço nos itens do BOM para os ver aqui.';
    container.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-direction:column;gap:16px';
    container.appendChild(grid);

    sheets.forEach(sheetName => {
      const svcItems = svcBySheet[sheetName] || [];
      if (!svcItems.length) return;

      const card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '16px 20px';
      card.dataset.installSheet = sheetName;

      const header = document.createElement('div');
      header.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:.8px;text-transform:uppercase;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)";
      header.textContent = sheetName;
      card.appendChild(header);

      const table = document.createElement('table');
      table.className = 'bom-table';
      const thead = document.createElement('thead');
      const hrow = document.createElement('tr');
      [
        { t: 'Serviço' },
        { t: 'Qty', w: '90px', center: true },
        { t: 'Custo unit. (MZN)', w: '170px', right: true },
      ].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h.t;
        if (h.w) th.style.width = h.w;
        if (h.center) th.style.textAlign = 'center';
        if (h.right) th.style.textAlign = 'right';
        hrow.appendChild(th);
      });
      thead.appendChild(hrow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      svcItems.forEach(bi => {
        const tr = document.createElement('tr');

        const tdDesc = document.createElement('td');
        tdDesc.textContent = bi.description;
        tr.appendChild(tdDesc);

        const tdQty = document.createElement('td');
        tdQty.style.textAlign = 'center';
        const qtyInp = document.createElement('input');
        qtyInp.type = 'number'; qtyInp.min = '0'; qtyInp.step = '1';
        qtyInp.value = bi.quantity || 1;
        qtyInp.style.cssText = 'width:100%;text-align:center';
        qtyInp.dataset.serviceQtyId = bi.id;
        tdQty.appendChild(qtyInp);
        tr.appendChild(tdQty);

        const tdPrice = document.createElement('td');
        tdPrice.style.textAlign = 'right';
        const priceInp = document.createElement('input');
        priceInp.type = 'number'; priceInp.min = '0'; priceInp.step = '0.01';
        priceInp.value = bi.service_price || 0;
        priceInp.style.cssText = 'width:100%;text-align:right';
        priceInp.dataset.servicePriceId = bi.id;
        tdPrice.appendChild(priceInp);
        tr.appendChild(tdPrice);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      grid.appendChild(card);
    });
  }

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-ghost btn-sm';
  saveBtn.textContent = 'Guardar custos';
  saveBtn.addEventListener('click', saveInstallCosts);
  const savedMsg = document.createElement('div');
  savedMsg.id = 'installSaved';
  savedMsg.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--accent);opacity:0;transition:opacity .4s";
  savedMsg.textContent = 'Guardado';
  actions.appendChild(saveBtn);
  actions.appendChild(savedMsg);
  container.appendChild(actions);
}

async function saveInstallCosts() {
  const priceInputs = document.querySelectorAll('#install-content [data-service-price-id]');
  const qtyInputs = document.querySelectorAll('#install-content [data-service-qty-id]');

  // Build a map of id → { qty, price }
  const updates = {};
  priceInputs.forEach(inp => {
    const id = inp.dataset.servicePriceId;
    if (!updates[id]) updates[id] = {};
    updates[id].price = parseFloat(inp.value) || 0;
  });
  qtyInputs.forEach(inp => {
    const id = inp.dataset.serviceQtyId;
    if (!updates[id]) updates[id] = {};
    updates[id].qty = parseFloat(inp.value) || 1;
  });

  try {
    await Promise.all(Object.entries(updates).map(([id, { qty = 1, price = 0 }]) => {
      const bi = bomItems.find(b => b.id === id);
      if (bi) { bi.quantity = qty; bi.service_price = price; }
      return API.updateBomItemServiceCost(id, qty, price);
    }));
    const el = document.getElementById('installSaved');
    if (el) { el.style.opacity = '1'; setTimeout(() => el.style.opacity = '0', 2000); }
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Excel Generation (ported from planilha-generator) ──
const MB={top:{style:'medium'},left:{style:'medium'},bottom:{style:'medium'},right:{style:'medium'}};
const TB={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
const OF={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFC000'}};
const YF={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
function sc2(cell,opts={}){const{value,font,fill,border,alignment,numFmt}=opts;if(value!==undefined)cell.value=value;if(font)cell.font=font;if(fill)cell.fill=fill;if(border)cell.border=border;if(alignment)cell.alignment=alignment;if(numFmt)cell.numFmt=numFmt;}
function col2l(n){let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}

function buildSupSheet(wb, supplier) {
  const items = supplier.items.filter(i => i.model && i.model.trim());
  const isForeign = supplier.isForeign;
  const cambio = parseFloat(supplier.cambio) || 1;
  const transport = parseFloat(supplier.transport) || 0;
  const direitos = (parseFloat(supplier.direitos) || 0) / 100;
  const name = (supplier.name || 'Fornecedor').substring(0, 31);
  const ws = wb.addWorksheet(name, {properties:{tabColor:{argb:'FFC00000'}},views:[{showGridLines:false}]});
  ws.columns=[{width:15.7},{width:40},{width:12},{width:13},{width:15.5},{width:18.2},{width:19.5},{width:13},{width:15.1},{width:14.8},{width:15.8},{width:18.8},{width:15.5},{width:11.8},{width:18.2},{width:12.5},{width:9.8},{width:17.8},{width:16.5},{width:14.5}];
  const DS=4,lastItemRow=DS+items.length-1,totalRow=lastItemRow+2,transportRow=totalRow+1,cambioRow=transportRow+2;
  ws.getRow(2).height=19.25;
  sc2(ws.getCell(2,16),{value:'Homologacao',font:{bold:true,size:14,name:'Calibri'},alignment:{horizontal:'center',vertical:'middle'}});
  sc2(ws.getCell(2,17),{value:'Selos',font:{bold:true,size:14,name:'Calibri'},alignment:{horizontal:'center',vertical:'middle'}});
  ws.getRow(3).height=56.25;
  const hF={bold:true,size:14,name:'Calibri',color:{argb:'FF000000'}};
  const hA={horizontal:'center',vertical:'middle',wrapText:true};
  const OC=new Set([16,17,19,20]);
  ['Part','Model','Direitos %','Transporte','QTY','Unit price (MZN)','Total price (MZN)','Transporte','Margem Infinitreach','Custo com Transporte','Direitos Aduaneiros','Custo da mercadoria DDP','Outros Custos de Importacao','DDP Final','Custo DDP MZN',3000,25,'Custo DDP MZN Final','Preco de Venda','Preco Total'].forEach((lbl,i)=>{
    sc2(ws.getCell(3,i+1),{value:lbl,font:hF,fill:OC.has(i+1)?OF:undefined,border:MB,alignment:hA});
  });
  const dF={size:11,name:'Calibri',color:{argb:'FF000000'}};
  const dA={horizontal:'center',vertical:'middle'};
  const rF={size:11,name:'Calibri',color:{argb:'FFFF0000'}};
  const NF='#,##0.00',NFD='#,##0.00;-#,##0.00;"-"';
  items.forEach((item,idx)=>{
    const r=DS+idx,qty=parseFloat(item.qty)||1,up=parseFloat(item.price)||0;
    ws.getRow(r).height=18.5;
    sc2(ws.getCell(r,1),{value:item.part||'',font:dF,border:TB,alignment:dA});
    sc2(ws.getCell(r,2),{value:item.model,font:dF,border:TB,alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
    sc2(ws.getCell(r,3),{value:direitos,font:dF,border:TB,alignment:dA,numFmt:'0.0%'});
    sc2(ws.getCell(r,4),{value:{formula:`+$F$${transportRow}/$G$${totalRow}`},font:dF,border:TB,alignment:dA,numFmt:'0.0%'});
    sc2(ws.getCell(r,5),{value:qty,font:dF,border:TB,alignment:{horizontal:'center',vertical:'middle',wrapText:true}});
    sc2(ws.getCell(r,6),{value:up,font:dF,border:TB,alignment:{horizontal:'right',vertical:'middle'},numFmt:NF});
    sc2(ws.getCell(r,7),{value:{formula:`+F${r}*E${r}`},font:dF,border:TB,alignment:{horizontal:'right',vertical:'middle',wrapText:true},numFmt:NFD});
    sc2(ws.getCell(r,8),{value:{formula:`F${r}*D${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,9),{value:{formula:`+F${r}*0%`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,10),{value:{formula:`H${r}+F${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,11),{value:{formula:`J${r}*C${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,12),{value:{formula:`K${r}+J${r}+I${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,13),{value:{formula:`L${r}*${isForeign?'5':'0'}%`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,14),{value:{formula:`M${r}+L${r}`},font:rF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,15),{value:{formula:`+N${r}*$F$${cambioRow}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,16),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,17),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,18),{value:{formula:`+Q${r}+P${r}+O${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,19),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,20),{border:TB,alignment:dA,numFmt:NFD});
  });
  ws.getRow(totalRow).height=18.5;
  sc2(ws.getCell(totalRow,7),{value:{formula:`SUM(G${DS}:G${lastItemRow})`},font:{bold:true,size:11,name:'Calibri'},alignment:{horizontal:'right',vertical:'middle'},numFmt:NF});
  sc2(ws.getCell(transportRow,5),{value:'TRANSPORTE',font:{size:14,name:'Calibri'},fill:YF});
  sc2(ws.getCell(transportRow,6),{value:transport,font:{size:14,name:'Calibri'},fill:YF,numFmt:'"MZN" #,##0.00'});
  sc2(ws.getCell(cambioRow,5),{value:'Cambio',font:{size:14,name:'Calibri'},fill:YF});
  sc2(ws.getCell(cambioRow,6),{value:cambio,font:{size:14,name:'Calibri'},fill:YF,numFmt:'"MZN" #,##0.00'});
  return { dataStart: DS };
}

function fillMain(ws, suppliers, sheetNames, dataStarts, orderedItems, serviceRowsBySheet = {}) {
  const allTechRows = [];
  const allSvcSheets = Object.keys(serviceRowsBySheet).filter(s => (serviceRowsBySheet[s] || []).some(sv => sv.value > 0));
  const multiSheet = allSvcSheets.length > 1;
  for (const [sheetName, svcRows] of Object.entries(serviceRowsBySheet)) {
    const sheetSuffix = multiSheet ? ` — ${sheetName}` : '';
    for (const svc of svcRows) {
      if (svc.value > 0) allTechRows.push({ label: svc.label + sheetSuffix, isDiversos: true, value: svc.value });
    }
  }
  const hasTechs = allTechRows.length > 0;
  const trCol=hasTechs?4+suppliers.length:null;
  const vc=hasTechs?trCol+1:4+suppliers.length;
  const tc=vc+1;
  ws.columns=hasTechs
    ?[{width:4.5},{width:45.8},{width:4.5},...suppliers.map(()=>({width:17.8})),{width:14.5},{width:14.5},{width:13.9}]
    :[{width:4.5},{width:45.8},{width:4.5},...suppliers.map(()=>({width:17.8})),{width:14.5},{width:13.9}];
  const hF={bold:true,size:11,name:'Calibri',color:{argb:'FF000000'}};
  const hA={horizontal:'center',vertical:'middle',wrapText:true};
  const dF={size:11,name:'Calibri'};
  const NF='#,##0.00';
  ws.getRow(3).height=40;
  sc2(ws.getCell(3,1),{value:'Part',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,2),{value:'Model',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,3),{value:'QTY',font:hF,border:MB,alignment:hA});
  suppliers.forEach((s,si)=>sc2(ws.getCell(3,4+si),{value:sheetNames[si],font:hF,border:MB,alignment:hA}));
  if(hasTechs)sc2(ws.getCell(3,trCol),{value:'Triana',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,vc),{value:'Preco de Venda',font:hF,fill:OF,border:MB,alignment:hA});
  sc2(ws.getCell(3,tc),{value:'Preco Total',font:hF,fill:OF,border:MB,alignment:hA});
  let row=4;
  const vl=col2l(vc);
  // Iterate in BOM order — each item knows its supplier and row index in that supplier's sheet
  orderedItems.forEach(oi=>{
    const si=suppliers.findIndex(s=>s.id===oi.suppId);
    if(si<0)return;
    const ss=sheetNames[si].includes(' ')?`'${sheetNames[si]}'`:sheetNames[si];
    const ds=dataStarts[si];
    for(let c=1;c<=tc;c++)ws.getCell(row,c).border=TB;
    sc2(ws.getCell(row,1),{value:oi.part||'',font:dF,alignment:{horizontal:'center',vertical:'middle'}});
    sc2(ws.getCell(row,2),{value:oi.model,font:dF,alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
    sc2(ws.getCell(row,3),{value:oi.qty,font:dF,alignment:{horizontal:'center',vertical:'middle'}});
    sc2(ws.getCell(row,4+si),{value:{formula:`${ss}!R${ds+oi.indexInSupplier}`},font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
    sc2(ws.getCell(row,tc),{value:{formula:`+${vl}${row}*C${row}`},font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
    row++;
  });
  if(hasTechs){
    const trL=col2l(trCol);
    for(const t of allTechRows){
      for(let c=1;c<=tc;c++)ws.getCell(row,c).border=TB;
      sc2(ws.getCell(row,2),{value:t.label,font:dF,alignment:{horizontal:'left',vertical:'middle'}});
      if(t.isDiversos){
        sc2(ws.getCell(row,3),{value:1,font:dF,alignment:{horizontal:'center',vertical:'middle'}});
        sc2(ws.getCell(row,trCol),{value:t.value,font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
      } else {
        sc2(ws.getCell(row,3),{value:t.hours,font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
        sc2(ws.getCell(row,trCol),{value:t.rate*t.count,font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
      }
      sc2(ws.getCell(row,tc),{value:{formula:`+${trL}${row}*C${row}`},font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
      row++;
    }
  }
}

async function generateExcel() {
  if (hasRole('commercial')) { showToast('Sem permissão para gerar Excel.', true); return; }

  // Build selected offer lookup
  const selLookup = {};
  for (const o of selectedOffers) selLookup[o.bom_item_id] = o;

  // Build match lookup: bomItemId → supplierId → match
  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }

  // Build supplier items AND ordered item list (BOM order) in one pass
  const supplierItems = {};       // supplierId → items array for buildSupSheet
  const supplierCounters = {};    // supplierId → how many items added so far (= indexInSupplier)
  const orderedItems = [];        // flat list in BOM order: { part, model, qty, supplierId, indexInSupplier }

  for (const bi of bomItems) {
    const confirmed = selLookup[bi.id];
    let suppId = null, qi = null;

    if (confirmed) {
      qi = (quotationMap[confirmed.supplier_id] || []).find(q => q.id === confirmed.quotation_item_id);
      if (qi) suppId = confirmed.supplier_id;
    } else {
      const itemMatches = matchLookup[bi.id];
      if (itemMatches) {
        for (const [sid, m] of Object.entries(itemMatches)) {
          const q = (quotationMap[sid] || []).find(q => q.id === m.quotation_item_id);
          if (q && q.price != null) { suppId = sid; qi = q; break; }
        }
      }
    }

    if (!suppId || !qi) continue;

    if (!supplierItems[suppId]) { supplierItems[suppId] = []; supplierCounters[suppId] = 0; }
    const indexInSupplier = supplierCounters[suppId]++;
    supplierItems[suppId].push({ part: qi.raw_part_number || bi.part_number || '', model: qi.raw_description || bi.description, qty: String(bi.quantity), price: String(qi.price) });
    orderedItems.push({ part: qi.raw_part_number || bi.part_number || '', model: qi.raw_description || bi.description, qty: bi.quantity, suppId, indexInSupplier });
  }

  const activeSuppliers = suppliers.filter(s => supplierItems[s.id]?.length > 0);
  if (!activeSuppliers.length) { showToast('Sem itens com preço no Matching.', true); return; }

  const serviceRowsBySheet = {};
  for (const bi of bomItems) {
    if (!bi.is_service) continue;
    const sheet = bi.sheet_name || 'Sheet1';
    if (!serviceRowsBySheet[sheet]) serviceRowsBySheet[sheet] = [];
    serviceRowsBySheet[sheet].push({ label: bi.description, value: (bi.service_price || 0) * (bi.quantity || 1) });
  }

  try {
    const wb = new ExcelJS.Workbook();
    const mainWs = wb.addWorksheet((process.client_name||'Principal').substring(0,31), {views:[{showGridLines:false}]});
    const sheetNames=[], dataStarts=[];
    const suppliersForMain = activeSuppliers.map(s => ({
      name: s.name, isForeign: s.is_foreign, cambio: s.cambio||1, transport: s.transport||0, direitos: s.direitos||0,
      items: supplierItems[s.id],
    }));
    for (const s of suppliersForMain) {
      const { dataStart } = buildSupSheet(wb, s);
      sheetNames.push(s.name.substring(0, 31));
      dataStarts.push(dataStart);
    }
    fillMain(mainWs, activeSuppliers, sheetNames, dataStarts, orderedItems, serviceRowsBySheet);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Planilha_${(process.project_name||'Processo').replace(/[^a-zA-Z0-9\s\-_]/g,'').replace(/\s+/g,'_')}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Excel gerado!');
  } catch(e) { showToast('Erro ao gerar Excel: ' + e.message, true); console.error(e); }
}

// ── Process Report ──
function generateReport() {
  if (hasRole('commercial')) { showToast('Sem permissao para gerar relatorio.', true); return; }

  const suppLookup = {};
  for (const s of suppliers) suppLookup[s.id] = s.name;

  const selItems = [];
  let equipTotal = 0;
  for (const o of selectedOffers) {
    const bi = bomItems.find(b => b.id === o.bom_item_id);
    const qi = (quotationMap[o.supplier_id] || []).find(q => q.id === o.quotation_item_id);
    if (!bi || !qi) continue;
    const total = (qi.price || 0) * (bi.quantity || 1);
    equipTotal += total;
    selItems.push({ description: bi.description, part: bi.part_number || '-', qty: bi.quantity || 1,
      supplier: suppLookup[o.supplier_id] || '-', unitPrice: qi.price || 0, totalPrice: total });
  }

  let installTotal = 0;
  for (const bi of bomItems) {
    if (bi.is_service) installTotal += (bi.service_price || 0) * (bi.quantity || 1);
  }
  const grandTotal = equipTotal + installTotal;

  const fmt = function(n) { return Number(n).toLocaleString('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' MZN'; };
  const fmtD = function(d) { return d ? new Date(d).toLocaleDateString('pt-PT') : '-'; };

  let html = '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">';
  html += '<title>Relatorio - ' + esc(process.project_name || '') + '</title>';
  html += '<style>';
  html += "body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;background:#fff;margin:0;padding:32px}";
  html += 'h1{font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px}';
  html += '.sub{font-size:13px;color:#64748b;margin-bottom:24px}';
  html += '.meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px;background:#f8fafc;border-radius:8px;padding:16px}';
  html += '.meta-item label{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;font-weight:600;display:block;margin-bottom:2px}';
  html += '.meta-item span{font-size:13px;font-weight:600;color:#1e293b}';
  html += 'h2{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#64748b;font-weight:700;margin:24px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}';
  html += 'table{width:100%;border-collapse:collapse;margin-bottom:8px}';
  html += 'th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;font-weight:600;padding:6px 8px;border-bottom:1px solid #e2e8f0}';
  html += 'th.r{text-align:right}';
  html += 'td{padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:12px}';
  html += 'td.r{text-align:right;font-family:monospace}';
  html += 'td.m{color:#94a3b8}';
  html += '.total-row td{font-weight:700;font-size:13px;background:#f8fafc;border-top:2px solid #e2e8f0}';
  html += '.grand{margin-top:20px;padding:16px;background:#0f172a;color:#fff;border-radius:8px;display:flex;justify-content:space-between;align-items:center}';
  html += '.grand .lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px}';
  html += '.grand .amt{font-size:18px;font-weight:700;font-family:monospace}';
  html += '.footer{margin-top:32px;font-size:10px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:16px}';
  html += '@media print{body{padding:16px}}';
  html += '</style></head><body>';

  html += '<h1>' + esc(process.project_name || '-') + '</h1>';
  html += '<div class="sub">' + esc(process.client_name || '-') + ' &middot; Gerado em ' + new Date().toLocaleDateString('pt-PT') + '</div>';
  html += '<div class="meta-grid">';
  html += '<div class="meta-item"><label>Estado</label><span>' + esc(process.status || '-') + '</span></div>';
  html += '<div class="meta-item"><label>Prioridade</label><span>' + esc(process.priority || '-') + '</span></div>';
  html += '<div class="meta-item"><label>Prazo</label><span>' + fmtD(process.deadline) + '</span></div>';
  html += '<div class="meta-item"><label>Responsavel</label><span>' + esc((process.assignee && process.assignee.name) || '-') + '</span></div>';
  html += '<div class="meta-item"><label>Criado em</label><span>' + fmtD(process.created_at) + '</span></div>';
  if (process.closed_at) {
    html += '<div class="meta-item"><label>Fechado em</label><span>' + fmtD(process.closed_at) + '</span></div>';
  }
  html += '</div>';

  html += '<h2>BOM - Lista de Materiais</h2>';
  if (bomItems.length) {
    html += '<table><thead><tr><th>Descricao</th><th>Part Number</th><th>Categoria</th><th class="r">Qtd</th></tr></thead><tbody>';
    for (var bi = 0; bi < bomItems.length; bi++) {
      var b = bomItems[bi];
      html += '<tr><td>' + esc(b.description||'-') + '</td><td class="m">' + esc(b.part_number||'-') + '</td><td class="m">' + esc(b.category||'-') + '</td><td class="r">' + (b.quantity||1) + '</td></tr>';
    }
    html += '</tbody></table>';
  } else {
    html += '<p style="color:#94a3b8;font-size:12px">Sem BOM carregado.</p>';
  }

  html += '<h2>Fornecedores</h2>';
  if (suppliers.length) {
    html += '<table><thead><tr><th>Nome</th><th>Estado</th><th>Email</th></tr></thead><tbody>';
    for (var si = 0; si < suppliers.length; si++) {
      var s = suppliers[si];
      html += '<tr><td>' + esc(s.name||'-') + '</td><td class="m">' + esc(s.status||'-') + '</td><td class="m">' + esc(s.email||'-') + '</td></tr>';
    }
    html += '</tbody></table>';
  } else {
    html += '<p style="color:#94a3b8;font-size:12px">Sem fornecedores.</p>';
  }

  if (selItems.length) {
    html += '<h2>Precos Seleccionados</h2>';
    html += '<table><thead><tr><th>Item</th><th>Part Number</th><th>Fornecedor</th><th class="r">Qtd</th><th class="r">Preco Unit.</th><th class="r">Total</th></tr></thead><tbody>';
    for (var ii = 0; ii < selItems.length; ii++) {
      var it = selItems[ii];
      html += '<tr><td>' + esc(it.description) + '</td><td class="m">' + esc(it.part) + '</td><td class="m">' + esc(it.supplier) + '</td><td class="r">' + it.qty + '</td><td class="r">' + fmt(it.unitPrice) + '</td><td class="r">' + fmt(it.totalPrice) + '</td></tr>';
    }
    html += '<tr class="total-row"><td colspan="5">Subtotal Equipamentos</td><td class="r">' + fmt(equipTotal) + '</td></tr>';
    html += '</tbody></table>';
  }

  if (installTotal > 0) {
    html += '<h2>Serviços / Instalação</h2>';
    html += '<table><thead><tr><th>Serviço</th><th class="r">Qty</th><th class="r">Custo unit.</th><th class="r">Total</th></tr></thead><tbody>';
    for (const bi of bomItems) {
      if (!bi.is_service || !(bi.service_price > 0)) continue;
      const tot = (bi.service_price || 0) * (bi.quantity || 1);
      html += '<tr><td>' + esc(bi.description) + '</td><td class="r">' + (bi.quantity || 1) + '</td><td class="r">' + fmt(bi.service_price) + '</td><td class="r">' + fmt(tot) + '</td></tr>';
    }
    html += '<tr class="total-row"><td colspan="3">Subtotal Serviços</td><td class="r">' + fmt(installTotal) + '</td></tr>';
    html += '</tbody></table>';
  }

  if (grandTotal > 0) {
    html += '<div class="grand"><div class="lbl">Total Geral</div><div class="amt">' + fmt(grandTotal) + '</div></div>';
  }

  html += '<div class="footer">Triana &middot; Procurement System &middot; ' + new Date().toLocaleString('pt-PT') + '</div>';
  html += '</body></html>';

  var blob = new Blob([html], {type: 'text/html;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var win = window.open(url, '_blank');
  if (win) win.addEventListener('load', function() { win.print(); URL.revokeObjectURL(url); });
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
    icon.textContent = '⏱';
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
    close.textContent = '×';
    close.onclick = () => { sessionStorage.setItem(key, '1'); banner.style.display = 'none'; };
    d.appendChild(icon);
    d.appendChild(body);
    d.appendChild(close);
    while (banner.firstChild) banner.removeChild(banner.firstChild);
    banner.appendChild(d);
  } catch(_) { banner.style.display = 'none'; }
}

// ── Edit process modal ──
function openEditModal() {
  const p = process;
  pendingProcessCategories = [...(p.categories || [])];
  showModal(`
    <div class="modal-tag">Editar Processo</div>
    <div class="form-grid-2">
      <div><label>Cliente</label><input id="ep_client" value=""></div>
      <div><label>Projeto</label><input id="ep_project" value=""></div>
    </div>
    <div class="form-grid-2">
      <div><label>Deadline</label><input type="date" id="ep_deadline" value="${p.deadline||''}"></div>
      <div><label>Prioridade</label>
        <select id="ep_priority">
          ${['Low','Medium','High','Urgent'].map(v=>`<option ${p.priority===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row"><label>Estado</label>
      <select id="ep_status">
        ${STANDARD_STATUSES.map(v=>`<option ${p.status===v?'selected':''}>${v}</option>`).join('')}
        ${!STANDARD_STATUSES.includes(p.status) ? `<option value="${esc(p.status)}" selected>${esc(p.status)}</option>` : ''}
        <option value="__custom__">+ Criar estado...</option>
      </select>
      <div id="ep_custom_row" style="display:${!STANDARD_STATUSES.includes(p.status)?'flex':'none'};gap:8px;margin-top:6px;align-items:center">
        <input type="text" id="ep_custom_name" placeholder="Nome do estado" style="flex:1" value="${!STANDARD_STATUSES.includes(p.status)?esc(p.status):''}">
        <input type="color" id="ep_custom_color" value="${p.status_color||'#3b82f6'}" style="width:40px;height:36px;padding:2px;cursor:pointer">
      </div>
    </div>
    <div class="form-row"><label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipo de projeto — opcional)</span></label><div class="tag-input-box" id="ep_catBox"></div></div>
    <div class="form-row"><label>Notas</label><textarea id="ep_notes"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveEditProcess()">Guardar</button>
    </div>
  `);
  const _ep = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : String(v); };
  _ep('ep_client', p.client_name || '');
  _ep('ep_project', p.project_name || '');
  _ep('ep_notes', p.notes || '');
  document.getElementById('ep_status').addEventListener('change', function() {
    document.getElementById('ep_custom_row').style.display = this.value === '__custom__' ? 'flex' : 'none';
  });
}

async function saveEditProcess() {
  const fields = {
    client_name:  document.getElementById('ep_client').value.trim(),
    project_name: document.getElementById('ep_project').value.trim(),
    deadline:     document.getElementById('ep_deadline').value || null,
    priority:     document.getElementById('ep_priority').value,
    notes:        document.getElementById('ep_notes').value.trim(),
    categories:   pendingProcessCategories,
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
// ── BOM Revision History ──
async function openBomHistoryModal() {
  // bomVersions sorted desc (newest first), build consecutive pairs
  const pairs = [];
  for (let i = 0; i < bomVersions.length - 1; i++) {
    pairs.push({ newer: bomVersions[i], older: bomVersions[i + 1] });
  }
  window._bomHistoryPairs = pairs;

  const options = pairs.map((p, idx) =>
    `<option value="${idx}">v${p.newer.version_number} \u2192 v${p.older.version_number} \u00a0(${esc(p.newer.original_name || '')})</option>`
  ).join('');

  showModalLg(`
    <div class="modal-tag">Hist\u00f3rico de Revis\u00f5es</div>
    <div class="modal-title">Compara\u00e7\u00e3o entre vers\u00f5es BOM</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <label style="font-size:12px;color:var(--muted);white-space:nowrap">Comparar:</label>
      <select id="histPairSel" class="input" style="flex:1;max-width:360px" onchange="renderBomHistoryDiff(window._bomHistoryPairs[+this.value].newer.id, window._bomHistoryPairs[+this.value].older.id)">
        ${options}
      </select>
    </div>
    <div id="historyDiffContent" style="max-height:420px;overflow-y:auto"></div>
    <div style="margin-top:16px;display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Fechar</button>
    </div>
  `);

  await renderBomHistoryDiff(pairs[0].newer.id, pairs[0].older.id);
}

async function renderBomHistoryDiff(newerId, olderId) {
  const container = document.getElementById('historyDiffContent');
  if (!container) return;

  // Clear + loading state
  while (container.firstChild) container.removeChild(container.firstChild);
  const loading = document.createElement('div');
  loading.style.cssText = 'color:var(--muted);font-size:13px;padding:20px 0';
  loading.textContent = 'A carregar...';
  container.appendChild(loading);

  const [newerItems, olderItems] = await Promise.all([
    API.getBomItems(processId, newerId),
    API.getBomItems(processId, olderId),
  ]);

  const { result, removed } = diffBom(olderItems, newerItems);
  while (container.firstChild) container.removeChild(container.firstChild);

  // Summary bar
  const counts = { unchanged: 0, qty_changed: 0, changed: 0, new: 0 };
  result.forEach(i => { counts[i._diffStatus] = (counts[i._diffStatus] || 0) + 1; });

  const summary = document.createElement('div');
  summary.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px';
  const addTag = (text, color) => {
    const s = document.createElement('span');
    s.style.color = color;
    s.textContent = text;
    summary.appendChild(s);
  };
  if (counts.unchanged)   addTag(`${counts.unchanged} iguais`, 'var(--muted)');
  if (counts.qty_changed) addTag(`${counts.qty_changed} qty alterada`, '#ffcc00');
  if (counts.changed)     addTag(`${counts.changed} alterados`, '#ff8800');
  if (counts.new)         addTag(`${counts.new} novos`, '#60a5fa');
  if (removed.length)     addTag(`${removed.length} removidos`, '#ff4444');
  container.appendChild(summary);

  const changed = result.filter(i => i._diffStatus !== 'unchanged');
  if (!changed.length && !removed.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color:var(--muted);font-size:13px;padding:16px 0';
    empty.textContent = 'Sem alterações entre estas versões.';
    container.appendChild(empty);
    return;
  }

  // Table
  const table = document.createElement('table');
  table.className = 'bom-validate-table';

  const thead = table.createTHead();
  const hrow = thead.insertRow();
  ['Estado', 'Part #', 'Descrição', 'Qty', 'Unid.', 'Categoria'].forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i === 0) th.style.width = '8%';
    if (i === 1) th.style.width = '12%';
    if (i === 3) { th.style.width = '10%'; th.style.textAlign = 'center'; }
    if (i === 4) th.style.width = '8%';
    if (i === 5) th.style.width = '14%';
    hrow.appendChild(th);
  });

  const tbody = table.createTBody();

  const addRow = (item, isRemoved) => {
    const tr = tbody.insertRow();
    if (isRemoved) tr.style.background = '#1a0505';

    // Estado cell — diffStatusBadge output is static/hardcoded (no user data), safe to set
    const tdStatus = tr.insertCell();
    if (isRemoved) {
      const badge = document.createElement('span');
      badge.style.cssText = 'background:#3a0000;color:#ff4444;border:1px solid #ff4444;border-radius:3px;font-size:10px;padding:1px 5px;font-family:IBM Plex Mono,monospace';
      badge.textContent = 'Removido';
      tdStatus.appendChild(badge);
    } else {
      const badgeHtml = diffStatusBadge(item._diffStatus);
      if (badgeHtml) tdStatus.appendChild(document.createRange().createContextualFragment(badgeHtml));
    }

    // Part #
    const tdPn = tr.insertCell();
    tdPn.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)";
    tdPn.textContent = item.part_number || '—';

    // Descrição
    const tdDesc = tr.insertCell();
    if (isRemoved) tdDesc.style.color = '#ff4444';
    tdDesc.textContent = item.description || '';

    // Qty
    const tdQty = tr.insertCell();
    tdQty.style.textAlign = 'center';
    if (!isRemoved && item._diffStatus === 'qty_changed') {
      tdQty.style.color = '#ffcc00';
      tdQty.textContent = `${item._oldQty} → ${item.quantity}`;
    } else {
      if (isRemoved) tdQty.style.color = 'var(--muted)';
      tdQty.textContent = item.quantity;
    }

    // Unid.
    const tdUnit = tr.insertCell();
    tdUnit.style.cssText = 'color:var(--muted);font-size:12px';
    tdUnit.textContent = item.unit || '';

    // Categoria
    const tdCat = tr.insertCell();
    tdCat.style.cssText = 'color:var(--muted);font-size:12px';
    tdCat.textContent = item.category || '';
  };

  changed.forEach(item => addRow(item, false));
  removed.forEach(item => addRow(item, true));

  container.appendChild(table);
}

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
function showModalLg(html) {
  const root = document.getElementById('modalRoot');
  root.replaceChildren();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  const box = document.createElement('div');
  box.className = 'modal-box-lg';
  box.appendChild(document.createRange().createContextualFragment(html));
  overlay.appendChild(box);
  root.appendChild(overlay);
}
function closeModal() { document.getElementById('modalRoot').replaceChildren(); }

// ── Helpers ──
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('pt-PT'); }
function formatResponseTime(hours) { if (!hours || hours <= 0) return '—'; return hours < 24 ? Math.round(hours) + 'h' : (hours / 24).toFixed(1) + ' dias'; }
function fmtPrice(p) { if (p==null) return '—'; return new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(p); }
function deadlineClass(d) { if (!d) return ''; const diff = (new Date(d)-new Date())/86400000; return diff < 0 ? 'overdue' : diff < 5 ? 'soon' : ''; }
const STANDARD_STATUSES = ['Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Closed','Cancelled'];
function statusBadgeClass(s) {
  const map = { 'Active':'badge-active','Waiting for suppliers':'badge-waiting','Waiting for internal info':'badge-waiting','Partial responses':'badge-partial','Ready for Excel':'badge-ready','Closed':'badge-closed','Cancelled':'badge-cancelled' };
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
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
  el.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}