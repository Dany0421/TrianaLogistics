// ── BOM Diff ──
function diffBom(oldItems, newItems) {
  const norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const used = new Set();

  function _classifyMatch(oi, ni) {
    const qtyDiff = Math.abs((oi.quantity||0) - (ni.quantity||0)) > 0.001;
    const descDiff = norm(oi.description) !== norm(ni.description);
    return { _diffStatus: descDiff ? 'changed' : qtyDiff ? 'qty_changed' : 'unchanged', _oldId: oi.id, _oldQty: oi.quantity };
  }

  const result = newItems.map(ni => {
    // 1. Part number exact match
    if (ni.part_number) {
      const m = oldItems.find(oi => !used.has(oi.id) && oi.part_number &&
        norm(oi.part_number) === norm(ni.part_number));
      if (m) { used.add(m.id); return { ...ni, ..._classifyMatch(m, ni) }; }
    }

    // 2. Description + sheet_name + category (best match for duplicates)
    const descMatches = oldItems.filter(oi => !used.has(oi.id) && norm(oi.description) === norm(ni.description));
    if (descMatches.length > 0) {
      // Score candidates: prefer same sheet_name, then same category, then closest sort_order
      const scored = descMatches.map(oi => {
        let score = 0;
        if (ni.sheet_name && oi.sheet_name && ni.sheet_name === oi.sheet_name) score += 100;
        if (ni.category && oi.category && norm(ni.category) === norm(oi.category)) score += 10;
        score -= Math.abs((oi.sort_order||0) - (ni.sort_order||0)) * 0.01;
        return { oi, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0].oi;
      used.add(best.id);
      return { ...ni, ..._classifyMatch(best, ni) };
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

  const el = document.createElement('div');

  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = isRevision ? 'Revisão BOM' : 'Validação BOM'; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = fileName; el.appendChild(title);
  const sub = document.createElement('div'); sub.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:8px'; sub.textContent = `${pendingBomItems.length} linha(s) encontrada(s). Revê e confirma antes de guardar.`; el.appendChild(sub);

  // Diff summary
  if (isRevision) {
    const counts = { unchanged:0, qty_changed:0, changed:0, new:0 };
    pendingBomItems.forEach(i => counts[i._diffStatus] = (counts[i._diffStatus]||0)+1);
    const summary = document.createElement('div'); summary.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px';
    const addTag = (text, color) => { const s = document.createElement('span'); s.style.color = color; s.textContent = text; summary.appendChild(s); };
    if (counts.unchanged) addTag(`${counts.unchanged} iguais`, 'var(--muted)');
    if (counts.qty_changed) addTag(`${counts.qty_changed} qty alterada`, '#ffcc00');
    if (counts.changed) addTag(`${counts.changed} alterados`, '#ff8800');
    if (counts.new) addTag(`${counts.new} novos`, '#60a5fa');
    if (removed.length) addTag(`${removed.length} removidos`, '#ff4444');
    el.appendChild(summary);
  }

  // Table
  const tableWrap = document.createElement('div'); tableWrap.style.cssText = 'max-height:380px;overflow-y:auto;margin-bottom:12px';
  const table = document.createElement('table'); table.className = 'bom-validate-table';
  // Static thead (isRevision flag is developer-controlled, not user data)
  const theadStr = `<thead><tr>
    ${isRevision ? '<th style="width:7%">Estado</th>' : ''}
    <th style="width:10%">Part #</th>
    <th style="width:${isRevision ? '43%' : '48%'}">Descrição</th>
    <th style="width:7%">Qty</th>
    <th style="width:8%">Unid.</th>
    <th style="width:9%">Categoria</th>
    <th style="width:5%" title="Serviço Triana">Serv.</th>
    <th style="width:${isRevision ? '11%' : '13%'}"></th>
  </tr></thead>`;
  table.insertAdjacentHTML('afterbegin', theadStr);
  const tbody = document.createElement('tbody'); tbody.id = 'bomValTbody'; table.appendChild(tbody);
  tableWrap.appendChild(table);

  // Search bar
  _bomValFilter = '';
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'position:relative;margin-bottom:8px';
  const searchIn = document.createElement('input');
  searchIn.type = 'text';
  searchIn.placeholder = 'Pesquisar part # ou descrição…';
  searchIn.style.cssText = 'width:100%;padding:6px 28px 6px 8px;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);box-sizing:border-box';
  searchIn.oninput = function() { _bomValFilter = this.value; renderBomValTable(); };
  const bomClearBtn = document.createElement('button');
  bomClearBtn.appendChild(licon('x', 13));
  bomClearBtn.setAttribute('aria-label', 'Limpar pesquisa');
  bomClearBtn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;display:flex;align-items:center;padding:0';
  bomClearBtn.addEventListener('click', () => { searchIn.value = ''; _bomValFilter = ''; renderBomValTable(); });
  searchWrap.appendChild(searchIn);
  searchWrap.appendChild(bomClearBtn);
  el.appendChild(searchWrap);
  el.appendChild(tableWrap);

  // Removed items section
  if (removed.length) {
    const removedSec = document.createElement('div'); removedSec.style.cssText = 'background:#1a0505;border:1px solid #440000;border-radius:4px;padding:10px;margin-bottom:12px;font-size:12px';
    const removedLbl = document.createElement('div'); removedLbl.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ff4444;letter-spacing:1px;margin-bottom:6px"; removedLbl.textContent = `REMOVIDOS DO BOM (${removed.length})`; removedSec.appendChild(removedLbl);
    removed.forEach(r => { const d = document.createElement('div'); d.style.cssText = 'color:#ff8888;padding:2px 0'; d.textContent = (r.part_number ? r.part_number + ' — ' : '') + r.description; removedSec.appendChild(d); });
    el.appendChild(removedSec);
  }

  // Actions
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const addBtn = document.createElement('button'); addBtn.className = 'btn btn-ghost btn-sm'; addBtn.textContent = '+ Linha'; addBtn.addEventListener('click', addBomRow); actions.appendChild(addBtn);
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'btn btn-primary'; confirmBtn.textContent = 'Confirmar e Guardar'; confirmBtn.addEventListener('click', confirmBom); actions.appendChild(confirmBtn);
  el.appendChild(actions);

  showModalLg(el);
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

  const _norm = s => (s || '').toLowerCase();
  const _tokens = _norm(_bomValFilter).split(/\s+/).filter(Boolean);

  pendingBomItems.forEach((item, i) => {
    if (_tokens.length && !_tokens.every(t =>
      _norm(item.part_number).includes(t) || _norm(item.description).includes(t)
    )) return;

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
    inQty.style.width = '100%';
    inQty.onchange = function() { pendingBomItems[i].quantity = parseFloat(this.value) || 1; };
    tdQty.appendChild(inQty);
    tr.appendChild(tdQty);

    const tdUnit = document.createElement('td');
    const inUnit = document.createElement('input');
    inUnit.type = 'text';
    inUnit.value = item.unit || '';
    inUnit.style.width = '100%';
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

    const tdActions = document.createElement('td');
    tdActions.style.cssText = 'display:flex;gap:3px;align-items:center';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-ghost btn-sm';
    upBtn.textContent = '▲';
    upBtn.title = 'Mover para cima';
    upBtn.style.padding = '3px 6px';
    upBtn.disabled = i === 0;
    if (i === 0) upBtn.style.opacity = '0.25';
    upBtn.onclick = () => { [pendingBomItems[i-1], pendingBomItems[i]] = [pendingBomItems[i], pendingBomItems[i-1]]; renderBomValTable(); };

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn btn-ghost btn-sm';
    downBtn.textContent = '▼';
    downBtn.title = 'Mover para baixo';
    downBtn.style.padding = '3px 6px';
    downBtn.disabled = i === pendingBomItems.length - 1;
    if (i === pendingBomItems.length - 1) downBtn.style.opacity = '0.25';
    downBtn.onclick = () => { [pendingBomItems[i], pendingBomItems[i+1]] = [pendingBomItems[i+1], pendingBomItems[i]]; renderBomValTable(); };

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '\u00d7';
    delBtn.style.padding = '3px 6px';
    delBtn.onclick = () => { pendingBomItems.splice(i, 1); renderBomValTable(); };

    tdActions.appendChild(upBtn);
    tdActions.appendChild(downBtn);
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

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

    const itemsToSave = pendingBomItems.map(({ _diffStatus, _oldId, _oldQty, ...item }, idx) => ({
      ...item,
      sort_order: idx,
      process_id: processId,
      bom_version_id: version.id,
    }));

    const savedItems = await API.saveBomItems(itemsToSave);

    // Copy matches for preserved items from previous version
    // Only procurement/admin can write to item_matches and selected_offers
    if (pendingDiff && savedItems?.length && !hasRole('commercial')) {
      const norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();

      // Phase 1: items matched by diffBom (have _oldId)
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

      // Phase 2: 'new' items with identical description to an old item that had matches
      const oldItemsByDesc = {};
      for (const oi of (pendingDiff.removed || [])) {
        const key = norm(oi.description);
        if (!oldItemsByDesc[key]) oldItemsByDesc[key] = [];
        oldItemsByDesc[key].push(oi);
      }
      // Also include old items that were matched but might have extra matches to share
      for (const bi of bomItems) {
        const key = norm(bi.description);
        if (!oldItemsByDesc[key]) oldItemsByDesc[key] = [];
        if (!oldItemsByDesc[key].find(o => o.id === bi.id)) oldItemsByDesc[key].push(bi);
      }

      const newItems = pendingBomItems
        .map((item, idx) => ({ item, newId: savedItems[idx]?.id }))
        .filter(({ item, newId }) => newId && item._diffStatus === 'new');

      let extraCopied = 0;
      for (const { item, newId } of newItems) {
        const key = norm(item.description);
        const oldCandidates = oldItemsByDesc[key] || [];
        if (!oldCandidates.length) continue;
        // Pick the best old item (prefer same sheet_name/category)
        const scored = oldCandidates.map(oi => {
          let score = 0;
          if (item.sheet_name && oi.sheet_name && item.sheet_name === oi.sheet_name) score += 10;
          if (item.category && oi.category && norm(item.category) === norm(oi.category)) score += 5;
          return { oi, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const donor = scored[0].oi;
        try {
          await API.copyItemMatches(donor.id, newId, processId);
          extraCopied++;
        } catch(e) { /* best-effort */ }
      }

      const totalCopied = preserved.length + extraCopied;
      if (totalCopied) showToast(`BOM v${versionNumber} — ${totalCopied} match${totalCopied!==1?'es':''} preservado${totalCopied!==1?'s':''}.`);
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
  // Static table header
  const tableWrap = document.createRange().createContextualFragment(`<table class="bom-table"><thead><tr>
    <th style="width:13%">Part #</th>
    <th style="width:42%">Descrição</th>
    <th style="width:7%">Qty</th>
    <th style="width:7%">Unid.</th>
    <th style="width:19%">Categoria</th>
    <th style="width:5%;text-align:center" title="Serviço Triana">Serv.</th>
  </tr></thead><tbody></tbody></table>`);
  holder.appendChild(tableWrap);
  const tbody = holder.querySelector('tbody');

  let lastCat = null;
  for (const item of items) {
    if (item.category && item.category !== lastCat) {
      const catRow = document.createElement('tr'); catRow.className = 'category-row';
      const catTd = document.createElement('td'); catTd.colSpan = 6; catTd.textContent = item.category;
      catRow.appendChild(catTd); tbody.appendChild(catRow);
      lastCat = item.category;
    }
    const tr = document.createElement('tr');

    const tdPart = document.createElement('td'); tdPart.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)"; tdPart.textContent = item.part_number || '—';
    const tdDesc = document.createElement('td'); tdDesc.textContent = item.description;
    const tdQty = document.createElement('td'); tdQty.style.textAlign = 'center'; tdQty.textContent = item.quantity;
    const tdUnit = document.createElement('td'); tdUnit.style.color = 'var(--muted)'; tdUnit.textContent = item.unit || '';
    const tdCat = document.createElement('td'); tdCat.style.cssText = 'font-size:11px;color:var(--muted)'; tdCat.textContent = item.category || '';
    const tdSvc = document.createElement('td'); tdSvc.style.textAlign = 'center';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!item.is_service; chk.title = 'Serviço Triana';
    chk.addEventListener('change', function() { toggleServiceItem(item.id, this.checked); });
    tdSvc.appendChild(chk);

    tr.appendChild(tdPart); tr.appendChild(tdDesc); tr.appendChild(tdQty); tr.appendChild(tdUnit); tr.appendChild(tdCat); tr.appendChild(tdSvc);
    tbody.appendChild(tr);
  }
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

// ── File View (BOM) ──
async function viewBomFile(filePath) {
  if (!_isValidFilePath(filePath)) { showToast('Caminho de ficheiro inválido.', true); return; }
  try {
    const url = await API.getSignedUrl('procurement-files', filePath);
    window.open(url, '_blank');
  } catch(e) { showToast('Erro ao abrir ficheiro.', true); }
}

// ── BOM Revision History ──
async function openBomHistoryModal() {
  // bomVersions sorted desc (newest first), build consecutive pairs
  const pairs = [];
  for (let i = 0; i < bomVersions.length - 1; i++) {
    pairs.push({ newer: bomVersions[i], older: bomVersions[i + 1] });
  }
  window._bomHistoryPairs = pairs;

  const el = document.createElement('div');

  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = 'Histórico de Revisões'; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = 'Comparação entre versões BOM'; el.appendChild(title);

  const selRow = document.createElement('div'); selRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:16px';
  const selLbl = document.createElement('label'); selLbl.style.cssText = 'font-size:12px;color:var(--muted);white-space:nowrap'; selLbl.textContent = 'Comparar:'; selRow.appendChild(selLbl);

  const sel = document.createElement('select'); sel.id = 'histPairSel'; sel.className = 'input'; sel.style.cssText = 'flex:1;max-width:360px';
  pairs.forEach((p, idx) => {
    const opt = document.createElement('option'); opt.value = idx;
    opt.textContent = `v${p.newer.version_number} → v${p.older.version_number}  (${p.newer.original_name || ''})`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function() {
    const p = window._bomHistoryPairs[+this.value];
    renderBomHistoryDiff(p.newer.id, p.older.id);
  });
  selRow.appendChild(sel); el.appendChild(selRow);

  const diffContent = document.createElement('div'); diffContent.id = 'historyDiffContent'; diffContent.style.cssText = 'max-height:420px;overflow-y:auto'; el.appendChild(diffContent);

  const footer = document.createElement('div'); footer.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end';
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn btn-ghost btn-sm'; closeBtn.textContent = 'Fechar'; closeBtn.addEventListener('click', closeModal); footer.appendChild(closeBtn);
  el.appendChild(footer);

  showModalLg(el);
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
