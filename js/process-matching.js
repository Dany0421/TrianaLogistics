// ── Matching Tab ──
function effPrice(qi) {
  if (qi == null) return null;
  return (qi.price || 0) * (1 - ((qi.discount || 0) / 100));
}
function switchMatchingView(v) {
  matchingView = v;
  renderMatchingTab();
}

/** Scroll positions to restore after re-render (inner table wrappers + ancestors + window). */
function _captureMatchingScroll(matchingRoot) {
  const matchScroll = document.getElementById('matchTableScroll');
  const compScroll = document.getElementById('compTableScroll');
  const ancestors = [];
  let p = matchingRoot.parentElement;
  while (p && p !== document.documentElement) {
    ancestors.push({ el: p, left: p.scrollLeft, top: p.scrollTop });
    p = p.parentElement;
  }
  return {
    match: matchScroll ? { left: matchScroll.scrollLeft, top: matchScroll.scrollTop } : null,
    comp: compScroll ? { left: compScroll.scrollLeft, top: compScroll.scrollTop } : null,
    ancestors,
    winX: window.scrollX,
    winY: window.scrollY,
  };
}

function _restoreMatchingScroll(state) {
  if (!state) return;
  for (const a of state.ancestors) {
    if (a.el.isConnected) {
      a.el.scrollLeft = a.left;
      a.el.scrollTop = a.top;
    }
  }
  window.scrollTo(state.winX, state.winY);
  const matchScroll = document.getElementById('matchTableScroll');
  if (matchScroll && state.match) {
    matchScroll.scrollLeft = state.match.left;
    matchScroll.scrollTop = state.match.top;
  }
  const compScroll = document.getElementById('compTableScroll');
  if (compScroll && state.comp) {
    compScroll.scrollLeft = state.comp.left;
    compScroll.scrollTop = state.comp.top;
  }
}

function renderMatchingTab() {
  const el = document.getElementById('matchingContent');
  if (!el) return;
  const scrollState = _captureMatchingScroll(el);
  const scheduleRestoreScroll = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => _restoreMatchingScroll(scrollState));
    });
  };
  el.replaceChildren();

  if (!bomItems.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Carrega o BOM primeiro.';
    el.appendChild(d);
    scheduleRestoreScroll();
    return;
  }

  const equipItems = bomItems.filter(bi => !bi.is_service);
  const serviceItems = bomItems.filter(bi => bi.is_service);

  const needsSuppliers = equipItems.length > 0;
  const hasSuppliers = suppliers.length > 0;

  // If no suppliers and no services, nothing to show
  if (!hasSuppliers && !serviceItems.length) {
    const d = document.createElement('div');
    d.className = 'empty-state';
    d.textContent = 'Adiciona fornecedores primeiro.';
    el.appendChild(d);
    scheduleRestoreScroll();
    return;
  }

  // If no suppliers but has services, force comparação view
  if (!hasSuppliers && serviceItems.length) {
    matchingView = 'comparacao';
  }

  // Build lookups (shared by both views)
  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }
  const selLookup = {};
  for (const o of selectedOffers) selLookup[o.bom_item_id] = o.supplier_id;

  const covered = equipItems.length ? equipItems.filter(bi => matchLookup[bi.id] && Object.keys(matchLookup[bi.id]).length > 0).length : 0;
  const pct = equipItems.length ? Math.round(covered / equipItems.length * 100) : 100;
  const pctColor = pct === 100 ? 'var(--accent)' : pct > 50 ? '#4fc3f7' : 'var(--danger)';

  // ── Toggle bar (only show if matching view makes sense) ──
  const toggleBar = document.createElement('div');
  toggleBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:16px';

  if (needsSuppliers && hasSuppliers) {
    ['matching', 'comparacao'].forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm' + (matchingView === v ? ' btn-primary' : ' btn-ghost');
      btn.textContent = v === 'matching' ? 'Matching' : 'Comparação';
      btn.addEventListener('click', () => switchMatchingView(v));
      toggleBar.appendChild(btn);
    });
  }
  el.appendChild(toggleBar);

  if (matchingView === 'matching' && hasSuppliers) {
    _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems);
  } else {
    _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems);
  }

  scheduleRestoreScroll();
}

function _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems) {
  // Stats bar
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'display:flex;align-items:center;gap:20px;margin-bottom:20px;flex-wrap:wrap';

  const covDiv = document.createElement('div');
  const covLabel = document.createElement('div');
  covLabel.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px";
  covLabel.textContent = 'COBERTURA';
  const covPct = document.createElement('div');
  covPct.style.cssText = `font-size:28px;font-weight:700;color:${pctColor}`;
  covPct.textContent = pct + '%';
  const covCount = document.createElement('div');
  covCount.style.cssText = 'color:var(--muted);font-size:12px';
  covCount.textContent = `${covered}/${equipItems.length} itens`;
  covDiv.appendChild(covLabel); covDiv.appendChild(covPct); covDiv.appendChild(covCount);

  const barWrap = document.createElement('div');
  barWrap.style.flex = '1';
  const bar = document.createElement('div'); bar.className = 'coverage-bar';
  const barFill = document.createElement('div'); barFill.className = 'coverage-bar-fill'; barFill.style.width = pct + '%';
  bar.appendChild(barFill); barWrap.appendChild(bar);

  const autoBtn = document.createElement('button');
  autoBtn.className = 'btn btn-ghost btn-sm';
  lbtn(autoBtn, 'zap', 'Auto-Match');
  autoBtn.addEventListener('click', runAutoMatch);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-ghost btn-sm';
  exportBtn.textContent = '↓ Export Missing';
  exportBtn.addEventListener('click', exportMissingItems);

  statsDiv.appendChild(covDiv); statsDiv.appendChild(barWrap); statsDiv.appendChild(autoBtn); statsDiv.appendChild(exportBtn);
  el.appendChild(statsDiv);

  // ── Filter + Search bar ──
  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap';

  const filterBtn = document.createElement('button');
  filterBtn.className = 'btn btn-sm' + (matchingFilter === 'unmatched' ? ' btn-primary' : ' btn-ghost');
  filterBtn.textContent = 'Sem match';
  filterBtn.addEventListener('click', () => {
    matchingFilter = matchingFilter === 'unmatched' ? 'all' : 'unmatched';
    renderMatchingTab();
  });

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Pesquisar item...';
  searchInput.value = matchingSearch;
  searchInput.style.cssText = 'width:200px;padding:5px 10px;font-size:12px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;color:var(--text);outline:none';
  searchInput.addEventListener('input', () => {
    matchingSearch = searchInput.value;
    const cursorPos = searchInput.selectionStart;
    renderMatchingTab();
    const newInput = document.querySelector('#matchingContent input[placeholder="Pesquisar item..."]');
    if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
  });
  searchWrap.appendChild(searchInput);

  controlsRow.appendChild(filterBtn);
  controlsRow.appendChild(searchWrap);
  el.appendChild(controlsRow);

  // Apply filters to equipItems
  let visibleItems = equipItems;
  if (matchingFilter === 'unmatched') {
    visibleItems = equipItems.filter(bi => !matchLookup[bi.id] || Object.keys(matchLookup[bi.id]).length === 0);
  }
  if (matchingSearch.trim()) {
    const q = matchingSearch.trim().toLowerCase();
    visibleItems = visibleItems.filter(bi =>
      (bi.description || '').toLowerCase().includes(q) ||
      (bi.part_number || '').toLowerCase().includes(q)
    );
  }

  // Table
  const scrollWrap = document.createElement('div');
  scrollWrap.id = 'matchTableScroll';
  scrollWrap.style.overflowX = 'auto';
  const table = document.createElement('table');
  table.className = 'match-table';

  // Thead
  const thead = table.createTHead();
  const hrow = thead.insertRow();
  const thItem = document.createElement('th'); thItem.style.minWidth = '260px'; thItem.textContent = 'Item BOM'; hrow.appendChild(thItem);
  const thQty = document.createElement('th'); thQty.style.cssText = 'text-align:center;width:50px'; thQty.textContent = 'Qty'; hrow.appendChild(thQty);
  for (const s of suppliers) {
    const th = document.createElement('th'); th.style.cssText = 'text-align:center;min-width:140px'; th.textContent = s.name; hrow.appendChild(th);
  }
  const thChoice = document.createElement('th'); thChoice.style.cssText = 'text-align:center;width:110px'; thChoice.textContent = 'Escolha'; hrow.appendChild(thChoice);

  // Tbody
  const tbody = table.createTBody();
  let lastCat = null;
  for (const bi of visibleItems) {
    if (bi.category && bi.category !== lastCat) {
      const catRow = tbody.insertRow(); catRow.className = 'match-cat-row';
      const catTd = catRow.insertCell(); catTd.colSpan = 3 + suppliers.length; catTd.textContent = bi.category;
      lastCat = bi.category;
    }
    const selectedSuppId = selLookup[bi.id];
    let lowestPrice = Infinity;
    for (const s of suppliers) {
      const p = effPrice(matchLookup[bi.id]?.[s.id]?.quotation_items);
      if (p != null && p < lowestPrice) lowestPrice = p;
    }
    const row = tbody.insertRow();

    // Item cell
    const tdItem = row.insertCell();
    const descWrap = document.createElement('div'); descWrap.style.cssText = 'display:flex;align-items:center;gap:4px';
    const descDiv = document.createElement('div'); descDiv.style.fontSize = '13px';
    if (bi.custom_description) {
      descDiv.textContent = bi.custom_description;
      descDiv.style.cssText = 'font-size:13px;font-style:italic;color:var(--accent)';
    } else {
      descDiv.textContent = bi.description;
    }
    const editBtn = document.createElement('button');
    editBtn.style.cssText = `background:none;border:none;cursor:pointer;padding:2px;color:${bi.custom_description ? 'var(--accent)' : 'var(--muted)'};display:flex;align-items:center;flex-shrink:0;transition:.15s`;
    editBtn.title = 'Editar descrição';
    editBtn.appendChild(licon('pencil', 12));
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openDescModal(bi.id); });
    descWrap.appendChild(descDiv); descWrap.appendChild(editBtn);
    tdItem.appendChild(descWrap);
    if (bi.part_number) {
      const pnDiv = document.createElement('div'); pnDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)"; pnDiv.textContent = bi.part_number; tdItem.appendChild(pnDiv);
    }

    // Qty cell
    const tdQty = row.insertCell(); tdQty.style.cssText = 'text-align:center;color:var(--muted);font-size:12px'; tdQty.textContent = bi.quantity;

    // Supplier cells
    for (const s of suppliers) {
      const m = matchLookup[bi.id]?.[s.id];
      const isSel = selectedSuppId === s.id;
      const price = effPrice(m?.quotation_items);
      const isLowest = price != null && price === lowestPrice && lowestPrice < Infinity;
      const tdSupp = row.insertCell();
      const cellDiv = document.createElement('div');
      let cls = 'match-cell';
      if (m) { if (isSel) cls += ' match-selected'; else if (isLowest) cls += ' match-lowest'; }
      else cls += ' match-empty';
      cellDiv.className = cls;
      cellDiv.addEventListener('click', () => openMatchModal(bi.id, s.id));
      if (m) {
        const currency = m.quotation_items?.currency || '';
        const priceDiv = document.createElement('div');
        priceDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600";
        priceDiv.textContent = fmtPrice(price);
        const currSpan = document.createElement('span'); currSpan.style.cssText = 'font-size:9px;opacity:.6;margin-left:2px'; currSpan.textContent = currency;
        priceDiv.appendChild(currSpan); cellDiv.appendChild(priceDiv);
        if (isSel) { const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:var(--accent);letter-spacing:1px'; lbl.textContent = 'SELECIONADO'; cellDiv.appendChild(lbl); }
        else if (isLowest) { const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:#4fc3f7;letter-spacing:1px'; lbl.textContent = 'MAIS BAIXO'; cellDiv.appendChild(lbl); }
      } else {
        cellDiv.textContent = '+';
      }
      tdSupp.appendChild(cellDiv);
    }

    // Escolha cell
    const tdChoice = row.insertCell(); tdChoice.style.textAlign = 'center';
    if (selectedSuppId) {
      const span = document.createElement('span'); span.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--accent)";
      span.textContent = suppliers.find(s => s.id === selectedSuppId)?.name || ''; tdChoice.appendChild(span);
    } else {
      const dash = document.createElement('span'); dash.style.color = '#333'; dash.textContent = '—'; tdChoice.appendChild(dash);
    }
  }

  // Tfoot
  const tfoot = table.createTFoot();
  const tfrow = tfoot.insertRow();
  tfrow.insertCell(); tfrow.insertCell();
  for (const s of suppliers) {
    const td = tfrow.insertCell(); td.style.cssText = "text-align:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase;padding:8px 10px;white-space:nowrap;border-top:1px solid var(--border)"; td.textContent = s.name;
  }
  tfrow.insertCell();

  scrollWrap.appendChild(table);
  el.appendChild(scrollWrap);
}

function _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems) {
  const hasServices = serviceItems.length > 0;
  const numCols = suppliers.length + (hasServices ? 1 : 0);

  const suppCoverage = {};
  for (const s of suppliers) suppCoverage[s.id] = equipItems.filter(bi => matchLookup[bi.id]?.[s.id] != null).length;
  const topSupp = suppliers.reduce((best, s) => suppCoverage[s.id] > (suppCoverage[best?.id] || 0) ? s : best, null);
  const colTotals = {};
  for (const s of suppliers) {
    colTotals[s.id] = equipItems.reduce((sum, bi) => { const p = effPrice(matchLookup[bi.id]?.[s.id]?.quotation_items); return sum + (p != null ? p : 0); }, 0);
  }
  const totalCovered = equipItems.reduce((sum, bi) => {
    const selectedSuppId = selLookup[bi.id];
    if (selectedSuppId) {
      const p = effPrice(matchLookup[bi.id]?.[selectedSuppId]?.quotation_items);
      return sum + (p || 0);
    }
    if (matchLookup[bi.id]) {
      const prices = Object.values(matchLookup[bi.id]).map(m => effPrice(m.quotation_items)).filter(p => p != null);
      if (prices.length > 0) return sum + Math.min(...prices);
    }
    return sum;
  }, 0);
  const serviceTotal = serviceItems.reduce((sum, bi) => sum + ((bi.service_price || 0) * (bi.quantity || 1)), 0);

  // Stats bar
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px';

  const makeStatBlock = (label, valueText, color, subText) => {
    const d = document.createElement('div');
    const lbl = document.createElement('div'); lbl.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:2px"; lbl.textContent = label;
    const val = document.createElement('div'); val.style.cssText = `font-size:${label === 'COBERTURA' ? '24' : '15'}px;font-weight:${label === 'COBERTURA' ? '700' : '600'};color:${color}`; val.textContent = valueText;
    d.appendChild(lbl); d.appendChild(val);
    if (subText) { const sub = document.createElement('div'); sub.style.cssText = 'color:var(--muted);font-size:12px'; sub.textContent = subText; d.appendChild(sub); }
    return d;
  };
  statsDiv.appendChild(makeStatBlock('COBERTURA', pct + '%', pctColor, `${covered}/${equipItems.length} itens`));
  if (topSupp) statsDiv.appendChild(makeStatBlock('MAIS COBERTURA', topSupp.name, '#fff', suppCoverage[topSupp.id] + ' itens'));
  if (totalCovered > 0) statsDiv.appendChild(makeStatBlock('TOTAL COBERTO', fmtPrice(totalCovered), 'var(--accent)'));
  if (serviceTotal > 0) statsDiv.appendChild(makeStatBlock('SERVIÇOS TRIANA', fmtPrice(serviceTotal), 'var(--warn)'));
  el.appendChild(statsDiv);

  // Comp table
  const compWrap = document.createElement('div'); compWrap.className = 'comp-wrap';
  const table = document.createElement('table'); table.className = 'comp-table';

  // Thead
  const thead = table.createTHead(); const hrow = thead.insertRow();
  const th0 = document.createElement('th'); th0.textContent = 'Item BOM'; hrow.appendChild(th0);
  for (const s of suppliers) { const th = document.createElement('th'); th.textContent = s.name; hrow.appendChild(th); }
  if (hasServices) { const thSvc = document.createElement('th'); thSvc.style.color = 'var(--warn)'; thSvc.textContent = 'Triana'; hrow.appendChild(thSvc); }

  // Tbody
  const tbody = table.createTBody();
  let lastCat = null;
  for (const bi of bomItems) {
    if (bi.category && bi.category !== lastCat) {
      const catRow = tbody.insertRow(); catRow.className = 'comp-cat-row';
      const td = catRow.insertCell(); td.colSpan = 1 + numCols; td.textContent = bi.category;
      lastCat = bi.category;
    }
    const row = tbody.insertRow();
    const tdItem = row.insertCell();

    if (bi.is_service) {
      const svcTotal = (bi.service_price || 0) * (bi.quantity || 1);
      const dDiv = document.createElement('div'); dDiv.style.cssText = 'font-size:13px;color:var(--warn)'; dDiv.textContent = bi.description; tdItem.appendChild(dDiv);
      const qDiv = document.createElement('div'); qDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--warn);opacity:.6"; qDiv.textContent = 'Qty: ' + (bi.quantity || 1); tdItem.appendChild(qDiv);
      for (const _s of suppliers) row.insertCell();
      const tdSvc = row.insertCell();
      const span = document.createElement('span'); span.className = 'comp-cell'; span.style.color = 'var(--warn)';
      span.textContent = svcTotal > 0 ? fmtPrice(svcTotal) : '—';
      if (svcTotal > 0) { const mzn = document.createElement('span'); mzn.style.cssText = 'font-size:9px;opacity:.7;margin-left:3px'; mzn.textContent = 'MZN'; span.appendChild(mzn); }
      tdSvc.appendChild(span);
    } else {
      const dDiv = document.createElement('div'); dDiv.style.fontSize = '13px'; dDiv.textContent = bi.description; tdItem.appendChild(dDiv);
      if (bi.part_number) { const pnDiv = document.createElement('div'); pnDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)"; pnDiv.textContent = bi.part_number; tdItem.appendChild(pnDiv); }
      let lowestPrice = Infinity;
      for (const s of suppliers) { const p = effPrice(matchLookup[bi.id]?.[s.id]?.quotation_items); if (p != null && p < lowestPrice) lowestPrice = p; }
      const selectedSuppId = selLookup[bi.id];
      for (const s of suppliers) {
        const m = matchLookup[bi.id]?.[s.id];
        const price = effPrice(m?.quotation_items);
        const currency = m?.quotation_items?.currency || '';
        const isSel = selectedSuppId === s.id;
        const isLow = price != null && price === lowestPrice && lowestPrice < Infinity;
        const td = row.insertCell();
        const span = document.createElement('span');
        if (price != null) {
          span.className = isSel && isLow ? 'comp-cell comp-cell-both' : isSel ? 'comp-cell comp-cell-sel' : isLow ? 'comp-cell comp-cell-low' : 'comp-cell';
          span.textContent = fmtPrice(price);
          const cSpan = document.createElement('span'); cSpan.style.cssText = 'font-size:9px;opacity:.7;margin-left:3px'; cSpan.textContent = currency; span.appendChild(cSpan);
          const etaVal = m?.quotation_items?.eta_value || '';
          const etaUnit = m?.quotation_items?.eta_unit || 'dias';
          if (etaVal) {
            const etaDiv = document.createElement('div');
            etaDiv.style.cssText = `font-size:10px;margin-top:2px;color:${isSel ? 'var(--accent)' : 'var(--muted)'};font-family:'IBM Plex Mono',monospace`;
            etaDiv.textContent = etaVal + ' ' + etaUnit;
            span.appendChild(etaDiv);
          }
        } else {
          span.className = 'comp-cell comp-cell-none'; span.textContent = '—';
        }
        td.appendChild(span);
      }
      if (hasServices) row.insertCell();
    }
  }

  // Tfoot
  const tfoot = table.createTFoot();
  const totalRow = tfoot.insertRow();
  const tdTLbl = totalRow.insertCell(); tdTLbl.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase"; tdTLbl.textContent = 'Total Equipamento';
  for (const s of suppliers) {
    const td = totalRow.insertCell();
    if (colTotals[s.id] > 0) { td.textContent = fmtPrice(colTotals[s.id]); }
    else { const dash = document.createElement('span'); dash.style.color = '#334'; dash.textContent = '—'; td.appendChild(dash); }
  }
  if (hasServices) { const td = totalRow.insertCell(); td.style.cssText = "font-family:'DM Mono',monospace;font-size:12px;color:var(--warn);font-weight:600"; td.textContent = serviceTotal > 0 ? fmtPrice(serviceTotal) : '—'; }

  const namesRow = tfoot.insertRow(); namesRow.insertCell();
  for (const s of suppliers) { const td = namesRow.insertCell(); td.style.cssText = "text-align:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase;padding:6px 12px;white-space:nowrap"; td.textContent = s.name; }
  if (hasServices) { const td = namesRow.insertCell(); td.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--warn);letter-spacing:.6px;text-transform:uppercase;text-align:center;padding:6px 12px"; td.textContent = 'Triana'; }

  compWrap.appendChild(table);
  el.appendChild(compWrap);
}

function openDescModal(bomItemId) {
  const bi = bomItems.find(b => b.id === bomItemId);
  if (!bi) return;

  const selOffer = selectedOffers.find(o => o.bom_item_id === bomItemId);
  const selQiDesc = selOffer?.quotation_items?.raw_description || null;

  let selectedMode = bi.custom_description ? 'custom' : 'bom';
  let customText = bi.custom_description || '';

  const el = document.createElement('div');

  const title = document.createElement('div'); title.className = 'modal-title'; title.style.cssText = 'font-size:15px;margin-bottom:16px'; title.textContent = 'Descrição do item'; el.appendChild(title);

  const makeRadioOption = (mode, label, subtext) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:8px;cursor:pointer;transition:.12s';
    const topRow = document.createElement('label'); topRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'descMode_' + bomItemId; radio.value = mode;
    if (mode === selectedMode) { radio.checked = true; wrap.style.borderColor = 'var(--accent)'; }
    const labelSpan = document.createElement('span'); labelSpan.style.cssText = 'font-size:13px;font-weight:600'; labelSpan.textContent = label;
    topRow.appendChild(radio); topRow.appendChild(labelSpan); wrap.appendChild(topRow);
    if (subtext) {
      const sub = document.createElement('div'); sub.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);margin-top:4px;padding-left:22px;word-break:break-word"; sub.textContent = subtext; wrap.appendChild(sub);
    }
    radio.addEventListener('change', () => {
      selectedMode = mode;
      el.querySelectorAll('[data-opt-wrap]').forEach(w => w.style.borderColor = 'var(--border)');
      wrap.style.borderColor = 'var(--accent)';
    });
    wrap.setAttribute('data-opt-wrap', '1');
    wrap.addEventListener('click', () => { radio.checked = true; radio.dispatchEvent(new Event('change')); });
    return { wrap, radio };
  };

  const { wrap: bomWrap } = makeRadioOption('bom', 'BOM original', bi.description);
  el.appendChild(bomWrap);

  if (selQiDesc) {
    const { wrap: suppWrap } = makeRadioOption('supplier', 'Fornecedor selecionado', selQiDesc);
    el.appendChild(suppWrap);
  }

  const customOuterWrap = document.createElement('div');
  customOuterWrap.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid ' + (selectedMode === 'custom' ? 'var(--accent)' : 'var(--border)') + ';margin-bottom:16px;transition:.12s';
  customOuterWrap.setAttribute('data-opt-wrap', '1');
  const customTopRow = document.createElement('label'); customTopRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer';
  const customRadio = document.createElement('input'); customRadio.type = 'radio'; customRadio.name = 'descMode_' + bomItemId; customRadio.value = 'custom';
  if (selectedMode === 'custom') customRadio.checked = true;
  const customLabel = document.createElement('span'); customLabel.style.cssText = 'font-size:13px;font-weight:600'; customLabel.textContent = 'Custom';
  customTopRow.appendChild(customRadio); customTopRow.appendChild(customLabel);
  const customInput = document.createElement('input'); customInput.type = 'text';
  customInput.style.cssText = 'width:100%;margin-top:8px;padding:7px 10px;font-size:13px;background:var(--surface2);border:1px solid var(--border);border-radius:7px;color:var(--text);outline:none;box-sizing:border-box';
  customInput.placeholder = 'Descrição personalizada...'; customInput.value = customText;
  customInput.addEventListener('input', () => { customText = customInput.value; });
  customInput.addEventListener('focus', () => {
    customRadio.checked = true; selectedMode = 'custom';
    el.querySelectorAll('[data-opt-wrap]').forEach(w => w.style.borderColor = 'var(--border)');
    customOuterWrap.style.borderColor = 'var(--accent)';
  });
  customRadio.addEventListener('change', () => {
    selectedMode = 'custom';
    el.querySelectorAll('[data-opt-wrap]').forEach(w => w.style.borderColor = 'var(--border)');
    customOuterWrap.style.borderColor = 'var(--accent)';
    customInput.focus();
  });
  customOuterWrap.addEventListener('click', () => { customRadio.checked = true; customRadio.dispatchEvent(new Event('change')); });
  customOuterWrap.appendChild(customTopRow); customOuterWrap.appendChild(customInput);
  el.appendChild(customOuterWrap);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    let newDesc = null;
    if (selectedMode === 'supplier') newDesc = selQiDesc;
    else if (selectedMode === 'custom') newDesc = customText.trim() || null;
    // 'bom' → newDesc stays null (clears custom)
    saveBtn.disabled = true;
    try {
      await API.updateBomItemCustomDescription(bomItemId, newDesc);
      const idx = bomItems.findIndex(b => b.id === bomItemId);
      if (idx >= 0) bomItems[idx].custom_description = newDesc;
      closeModal();
      renderMatchingTab();
      showToast('Descrição atualizada.');
    } catch(e) {
      showToast('Erro: ' + e.message, true);
      saveBtn.disabled = false;
    }
  });
  actions.appendChild(saveBtn);
  el.appendChild(actions);

  showModal(el);
}

function openMatchModal(bomItemId, supplierId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId)) return;
  const bi    = bomItems.find(x => x.id === bomItemId);
  const s     = suppliers.find(x => x.id === supplierId);
  const qItems = quotationMap[supplierId] || [];
  const currentMatch = matches.find(m => m.bom_item_id === bomItemId && m.supplier_id === supplierId);
  const selOffer = selectedOffers.find(o => o.bom_item_id === bomItemId);
  const isSelectedSupp = selOffer?.supplier_id === supplierId;

  const el = document.createElement('div');

  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = s?.name || ''; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.style.cssText = 'font-size:15px;margin-bottom:4px'; title.textContent = bi?.description || ''; el.appendChild(title);
  const qtyLine = document.createElement('div'); qtyLine.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:16px'; qtyLine.textContent = `Qty BOM: ${bi?.quantity} ${bi?.unit || ''}`; el.appendChild(qtyLine);

  if (!qItems.length) {
    const noQ = document.createElement('div'); noQ.style.cssText = 'color:var(--muted);font-size:13px;margin-bottom:16px';
    noQ.textContent = 'Este fornecedor não tem cotação carregada.';
    noQ.appendChild(document.createElement('br'));
    const upBtn = document.createElement('button'); upBtn.className = 'btn btn-ghost btn-sm'; upBtn.style.marginTop = '8px'; upBtn.textContent = '📎 Carregar Cotação';
    upBtn.addEventListener('click', () => { closeModal(); uploadQuotation(supplierId); });
    noQ.appendChild(upBtn);
    el.appendChild(noQ);
  } else {
    const qLabel = document.createElement('div'); qLabel.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:8px"; qLabel.textContent = 'SELECIONA UM ITEM DA COTAÇÃO'; el.appendChild(qLabel);
    const listWrap = document.createElement('div'); listWrap.style.cssText = 'max-height:300px;overflow-y:auto;margin-bottom:16px';
    for (const qi of qItems) {
      const isLinked = currentMatch?.quotation_item_id === qi.id;
      const row = document.createElement('div'); row.className = 'match-pick-row' + (isLinked ? ' linked' : '');
      row.addEventListener('click', () => linkItem(bomItemId, supplierId, qi.id));
      const infoDiv = document.createElement('div'); infoDiv.style.cssText = 'flex:1;min-width:0';
      const desc = document.createElement('div'); desc.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; desc.textContent = qi.raw_description; infoDiv.appendChild(desc);
      if (qi.raw_part_number) { const pn = document.createElement('div'); pn.style.cssText = 'font-size:10px;color:var(--muted)'; pn.textContent = qi.raw_part_number; infoDiv.appendChild(pn); }
      const priceDiv = document.createElement('div'); priceDiv.style.cssText = 'text-align:right;flex-shrink:0';
      const pv = document.createElement('div'); pv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600"; pv.textContent = fmtPrice(qi.price); priceDiv.appendChild(pv);
      const cv = document.createElement('div'); cv.style.cssText = 'font-size:10px;color:var(--muted)'; cv.textContent = qi.currency; priceDiv.appendChild(cv);
      row.appendChild(infoDiv); row.appendChild(priceDiv);
      if (isLinked) { const badge = document.createElement('div'); badge.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:var(--accent);letter-spacing:1px;white-space:nowrap'; badge.appendChild(licon('check', 10)); if (isSelectedSupp) badge.appendChild(document.createTextNode('SEL.')); row.appendChild(badge); }
      listWrap.appendChild(row);
    }
    el.appendChild(listWrap);
  }

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  if (currentMatch) {
    const selBtn = document.createElement('button'); selBtn.className = 'btn btn-ghost btn-sm'; lbtn(selBtn, 'check', 'Selecionar como melhor oferta');
    selBtn.addEventListener('click', () => selectOffer(bomItemId, supplierId, currentMatch.quotation_item_id)); actions.appendChild(selBtn);
    const rmBtn = document.createElement('button'); rmBtn.className = 'btn btn-danger btn-sm'; rmBtn.textContent = 'Remover';
    rmBtn.addEventListener('click', () => unlinkItem(bomItemId, supplierId, currentMatch.id)); actions.appendChild(rmBtn);
  }
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn btn-ghost'; closeBtn.textContent = 'Fechar'; closeBtn.addEventListener('click', closeModal); actions.appendChild(closeBtn);
  el.appendChild(actions);

  showModal(el);
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
    // Manual link clears any prior auto-match rejection for this pair
    rejectedAutoMatch = rejectedAutoMatch.filter(r => !(r.bom_item_id === bomItemId && r.supplier_id === supplierId));
    await API.removeRejectedAutoMatch(processId, bomItemId, supplierId);
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function unlinkItem(bomItemId, supplierId, matchId) {
  if (!UUID_RE.test(bomItemId) || !UUID_RE.test(supplierId) || !UUID_RE.test(matchId)) return;
  try {
    const match = matches.find(m => m.id === matchId);
    const quotItemId = match?.quotation_item_id;
    const wasSelected = !!selectedOffers.find(o => o.bom_item_id === bomItemId && o.supplier_id === supplierId);
    // Optimistic update
    matches = matches.filter(m => m.id !== matchId);
    if (wasSelected) selectedOffers = selectedOffers.filter(o => !(o.bom_item_id === bomItemId && o.supplier_id === supplierId));
    if (quotItemId) rejectedAutoMatch.push({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotItemId });
    closeModal();
    renderMatchingTab();
    // Persist
    await API.deleteMatch(matchId);
    if (wasSelected) await API.deleteSelectedOffer(processId, bomItemId);
    if (quotItemId) await API.addRejectedAutoMatch(processId, bomItemId, supplierId, quotItemId);
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

// ── Auto-Match ──
function _matchTokenize(str) {
  const STOP = new Set(['de','da','do','dos','das','em','no','na','nos','nas','os','as','um','uma','por','com','para','ou','ao','que','e']);
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/(\d+\/\d+)/g, ' $1 ')                  // preserve fractions as single token (1/4, 3/8)
    .split(/[^a-z0-9\/]+/)                             // split on non-alphanumeric (keep /)
    .map(t => t.replace(/^\/+|\/+$/g, ''))             // trim stray slashes from edges
    .filter(t => t.length >= 2 && !STOP.has(t));       // drop stop words and short tokens
}

async function runAutoMatch() {
  if (!bomItems.length) { showToast('Carrega o BOM primeiro.', true); return; }
  const suppliersWithItems = suppliers.filter(s => (quotationMap[s.id]||[]).length > 0);
  if (!suppliersWithItems.length) { showToast('Nenhum fornecedor com cotação carregada.', true); return; }

  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  // Build rejected set: "bomItemId:supplierId:quotItemId"
  const rejectedSet = new Set(rejectedAutoMatch.map(r => `${r.bom_item_id}:${r.supplier_id}:${r.quotation_item_id}`));
  const newMatches = [];

  for (const bi of bomItems) {
    if (bi.is_service) continue;
    const biTokens = _matchTokenize(bi.description);
    if (!biTokens.length) continue;
    const biSpecTokens = biTokens.filter(t => /\d/.test(t)); // numeric specs (sizes, fractions, model codes)

    for (const s of suppliersWithItems) {
      if (matches.find(m => m.bom_item_id === bi.id && m.supplier_id === s.id)) continue; // already matched
      let bestItem = null, bestScore = 0;

      for (const qi of quotationMap[s.id]) {
        // 1. Part number exact match — highest priority, skip word matching
        if (bi.part_number && qi.raw_part_number && norm(bi.part_number) === norm(qi.raw_part_number)) {
          bestItem = qi; bestScore = 1.0; break;
        }
        // 2. Word-based match
        const qTokens = _matchTokenize(qi.raw_description);
        // Spec gate: BOM numeric specs (sizes, fractions) must appear in quotation
        if (biSpecTokens.length > 0 && !biSpecTokens.some(bs => qTokens.includes(bs))) continue;
        const hits = biTokens.filter(bt => qTokens.includes(bt)).length;
        const score = hits / Math.max(biTokens.length, qTokens.length); // symmetric score
        if (score > bestScore) { bestScore = score; bestItem = qi; }
      }

      if (bestItem && bestScore >= 0.5 && !rejectedSet.has(`${bi.id}:${s.id}:${bestItem.id}`)) {
        newMatches.push({ process_id: processId, bom_item_id: bi.id, supplier_id: s.id, quotation_item_id: bestItem.id, match_type: 'auto', confidence: Math.round(bestScore*100)/100 });
      }
    }
  }

  // Phase 2: propagate matches across BOM items with identical descriptions
  // Build combined lookup: existing matches + newly found in phase 1
  const allMatchLookup = {};
  for (const m of matches) {
    if (!allMatchLookup[m.bom_item_id]) allMatchLookup[m.bom_item_id] = {};
    allMatchLookup[m.bom_item_id][m.supplier_id] = m.quotation_item_id;
  }
  for (const m of newMatches) {
    if (!allMatchLookup[m.bom_item_id]) allMatchLookup[m.bom_item_id] = {};
    allMatchLookup[m.bom_item_id][m.supplier_id] = m.quotation_item_id;
  }

  // Group non-service BOM items by exact trimmed description
  const descGroups = {};
  for (const bi of bomItems) {
    if (bi.is_service) continue;
    const key = (bi.description || '').trim();
    if (!key) continue;
    if (!descGroups[key]) descGroups[key] = [];
    descGroups[key].push(bi);
  }

  let propagated = 0;
  for (const group of Object.values(descGroups)) {
    if (group.length < 2) continue;
    // Collect all supplier IDs that have any match in this group
    const suppIds = new Set();
    for (const bi of group) {
      if (allMatchLookup[bi.id]) for (const sid of Object.keys(allMatchLookup[bi.id])) suppIds.add(sid);
    }
    for (const suppId of suppIds) {
      // Pick source: Phase-1 newly found first (most recent), then existing match with latest updated_at
      const newlyFoundInGroup = group.filter(bi =>
        newMatches.some(nm => nm.bom_item_id === bi.id && nm.supplier_id === suppId)
      );
      let source;
      if (newlyFoundInGroup.length) {
        source = newlyFoundInGroup[0];
      } else {
        source = group
          .filter(bi => allMatchLookup[bi.id]?.[suppId])
          .sort((a, b) => {
            const mA = matches.find(m => m.bom_item_id === a.id && m.supplier_id === suppId);
            const mB = matches.find(m => m.bom_item_id === b.id && m.supplier_id === suppId);
            return new Date(mB?.updated_at || 0) - new Date(mA?.updated_at || 0);
          })[0];
      }
      if (!source) continue;
      const quotItemId = allMatchLookup[source.id][suppId];
      for (const bi of group) {
        if (bi.id === source.id) continue;
        if (rejectedSet.has(`${bi.id}:${suppId}:${quotItemId}`)) continue;
        // skip if already in DB with same quotation_item_id
        if (allMatchLookup[bi.id]?.[suppId] === quotItemId) continue;
        const existingIdx = newMatches.findIndex(nm => nm.bom_item_id === bi.id && nm.supplier_id === suppId);
        const entry = { process_id: processId, bom_item_id: bi.id, supplier_id: suppId, quotation_item_id: quotItemId, match_type: 'auto', confidence: 1.0 };
        if (existingIdx >= 0) newMatches[existingIdx] = entry;
        else newMatches.push(entry);
        if (!allMatchLookup[bi.id]) allMatchLookup[bi.id] = {};
        allMatchLookup[bi.id][suppId] = quotItemId;
        propagated++;
      }
    }
  }

  if (!newMatches.length) { showToast('Nenhum match automático encontrado.'); return; }
  try {
    const saved = await API.saveMatches(newMatches);
    await loadMatchData();
    renderMatchingTab();
    const actualCount = saved.length;
    if (actualCount === 0) {
      showToast('Auto-match: 0 guardados (possível erro de permissões).', true);
    } else {
      const msg = propagated > 0
        ? `${actualCount} match(es) criado(s) — ${propagated} propagado(s) de itens repetidos.`
        : `${actualCount} match(es) automático(s) criado(s).`;
      showToast(msg);
    }
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function exportMissingItems() {
  const missing = bomItems.filter(bi => !bi.is_service && (!matches.some(m => m.bom_item_id === bi.id)));
  if (!missing.length) { showToast('Sem itens em falta — cobertura a 100%!'); return; }

  const sheets = {};
  for (const bi of missing) {
    const sh = bi.sheet_name || 'Sheet1';
    if (!sheets[sh]) sheets[sh] = [];
    sheets[sh].push(bi);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Triana Procurement';
  wb.created = new Date();

  const HDR_BG  = 'FF1E293B';
  const HDR_FG  = 'FFFFFFFF';
  const ROW_ALT = 'FFF8FAFC';
  const ACCENT  = 'FF3B82F6';

  const hFont   = { bold: true, size: 10, name: 'Calibri', color: { argb: HDR_FG } };
  const hFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
  const hAlign  = { horizontal: 'center', vertical: 'middle' };
  const dFont   = { size: 10, name: 'Calibri' };
  const dAlignL = { horizontal: 'left',   vertical: 'middle', wrapText: true };
  const dAlignC = { horizontal: 'center', vertical: 'middle' };

  for (const [sheetName, items] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(sheetName.substring(0, 31), {
      properties: { tabColor: { argb: ACCENT } },
      views: [{ showGridLines: false }],
    });

    ws.columns = [{ width: 16 }, { width: 52 }, { width: 8 }, { width: 12 }, { width: 22 }];

    ws.getRow(1).height = 14;
    const labelCell = ws.getCell(1, 1);
    labelCell.value = `Itens em falta — ${sheetName}  (${items.length} item${items.length !== 1 ? 's' : ''})`;
    labelCell.font = { size: 8, name: 'Calibri', color: { argb: 'FF64748B' }, italic: true };
    ws.mergeCells(1, 1, 1, 5);

    ws.getRow(2).height = 22;
    ['Part #', 'Descrição', 'Qty', 'Unidade', 'Categoria'].forEach((lbl, i) => {
      sc2(ws.getCell(2, i + 1), { value: lbl, font: hFont, fill: hFill, alignment: hAlign });
    });

    items.forEach((bi, idx) => {
      const r = 3 + idx;
      ws.getRow(r).height = 18;
      const altFill = idx % 2 === 1
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } }
        : undefined;
      sc2(ws.getCell(r, 1), { value: bi.part_number || '—', font: dFont, fill: altFill, alignment: dAlignC });
      sc2(ws.getCell(r, 2), { value: bi.description  || '',  font: dFont, fill: altFill, alignment: dAlignL });
      sc2(ws.getCell(r, 3), { value: bi.quantity      ?? '',  font: dFont, fill: altFill, alignment: dAlignC });
      sc2(ws.getCell(r, 4), { value: bi.unit          || '',  font: dFont, fill: altFill, alignment: dAlignC });
      sc2(ws.getCell(r, 5), { value: bi.category      || '',  font: dFont, fill: altFill, alignment: dAlignL });
    });
  }

  const buf  = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `missing_items_${processId}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${missing.length} item(s) exportado(s).`);
}
