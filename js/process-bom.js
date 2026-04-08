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
          <th style="width:10%"></th>
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
