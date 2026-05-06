// ── Matching Tab ──
function effPrice(qi, extras = []) {
  if (qi == null) return null;
  const primary = (qi.price || 0) * (1 - ((qi.discount || 0) / 100));
  const extraSum = extras.reduce((s, e) => {
    const eqi = e.quotation_items;
    return s + (eqi ? (eqi.price || 0) * (1 - ((eqi.discount || 0) / 100)) : 0);
  }, 0);
  return primary + extraSum;
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

  // If no suppliers but has services, force resumo view (only place services are shown)
  if (!hasSuppliers && serviceItems.length) {
    matchingView = 'resumo';
  }
  // If user was on resumo but there are no services anymore, fall back to comparacao
  if (matchingView === 'resumo' && !serviceItems.length) {
    matchingView = hasSuppliers ? 'comparacao' : 'matching';
  }

  // Build lookups (shared by both views)
  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }
  const extraByMatchId = {};
  for (const e of matchExtraItems) {
    if (!extraByMatchId[e.item_match_id]) extraByMatchId[e.item_match_id] = [];
    extraByMatchId[e.item_match_id].push(e);
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
    const views = [
      { id: 'matching',   label: 'Matching',   show: true },
      { id: 'comparacao', label: 'Compara\u00e7\u00e3o', show: true },
      { id: 'resumo',     label: 'Resumo',     show: serviceItems.length > 0 },
    ];
    for (const v of views) {
      if (!v.show) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm' + (matchingView === v.id ? ' btn-primary' : ' btn-ghost');
      btn.textContent = v.label;
      btn.addEventListener('click', () => switchMatchingView(v.id));
      toggleBar.appendChild(btn);
    }
  }
  el.appendChild(toggleBar);

  if (matchingView === 'matching' && hasSuppliers) {
    _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, extraByMatchId);
  } else {
    const mode = matchingView === 'resumo' ? 'resumo' : 'itens';
    _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems, mode, extraByMatchId);
  }

  scheduleRestoreScroll();
}

function _renderMatchingView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, extraByMatchId) {
  const includedByLookup = {};
  for (const m of matches) {
    if (m.match_type === 'included_in' && m.included_in_bom_item_id) {
      const key = m.included_in_bom_item_id + '_' + m.supplier_id;
      if (!includedByLookup[key]) includedByLookup[key] = [];
      includedByLookup[key].push(m);
    }
  }
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

  const filterMatchedBtn = document.createElement('button');
  filterMatchedBtn.className = 'btn btn-sm' + (matchingFilter === 'matched' ? ' btn-primary' : ' btn-ghost');
  filterMatchedBtn.textContent = 'Com match';
  filterMatchedBtn.addEventListener('click', () => {
    matchingFilter = matchingFilter === 'matched' ? 'all' : 'matched';
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
  controlsRow.appendChild(filterMatchedBtn);
  controlsRow.appendChild(searchWrap);
  el.appendChild(controlsRow);

  // Apply filters to equipItems
  let visibleItems = equipItems;
  if (matchingFilter === 'unmatched') {
    visibleItems = equipItems.filter(bi => !matchLookup[bi.id] || Object.keys(matchLookup[bi.id]).length === 0);
  } else if (matchingFilter === 'matched') {
    visibleItems = equipItems.filter(bi => matchLookup[bi.id] && Object.keys(matchLookup[bi.id]).length > 0);
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
    const th = document.createElement('th');
    th.style.cssText = 'text-align:center;min-width:140px';
    const nameDiv = document.createElement('div');
    nameDiv.textContent = s.name;
    th.appendChild(nameDiv);
    const gs = (globalSuppliersList || []).find(g => g.name.trim().toLowerCase() === s.name.trim().toLowerCase());
    const isBlocked = gs?.account_status === 'blocked';
    const isEtaPost = gs?.eta_condition === 'after_payment';
    const noCredit = gs?.has_credit === false;
    if (isBlocked || isEtaPost || noCredit) {
      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'match-warn-wrap';
      const tips = [];
      if (isBlocked) tips.push('Conta bloqueada');
      if (isEtaPost) tips.push('ETA após pagamento');
      if (noCredit) tips.push('Sem crédito disponível');
      badgeWrap.dataset.tooltip = tips.join(' · ');
      if (isBlocked) {
        const b = document.createElement('span');
        b.className = 'match-warn-badge match-warn-blocked';
        b.textContent = 'Bloqueada';
        badgeWrap.appendChild(b);
      }
      if (isEtaPost) {
        const b = document.createElement('span');
        b.className = 'match-warn-badge match-warn-eta';
        b.textContent = 'ETA Pós-Pgto';
        badgeWrap.appendChild(b);
      }
      if (noCredit) {
        const b = document.createElement('span');
        b.className = 'match-warn-badge match-warn-credit';
        b.textContent = 'Sem Crédito';
        badgeWrap.appendChild(b);
      }
      th.appendChild(badgeWrap);
    }
    hrow.appendChild(th);
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
    let lowestPriceMZN = Infinity;
    for (const s of suppliers) {
      const _m = matchLookup[bi.id]?.[s.id];
      if (_m?.match_type === 'included_in') continue;
      const p = effPrice(_m?.quotation_items, extraByMatchId[_m?.id] || []);
      const _cur = _m?.quotation_items?.currency;
      const rate = (_cur && _cur !== 'MZN') ? (s.cambio || 1) : 1;
      const pMZN = p != null ? p * rate : null;
      if (pMZN != null && pMZN < lowestPriceMZN) lowestPriceMZN = pMZN;
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
    const clockBtn = document.createElement('button');
    clockBtn.style.cssText = `background:none;border:none;cursor:pointer;padding:2px;color:var(--muted);display:flex;align-items:center;flex-shrink:0;transition:.15s`;
    clockBtn.title = 'Preço histórico';
    clockBtn.appendChild(licon('clock', 12));
    clockBtn.addEventListener('click', (e) => { e.stopPropagation(); openHistoricalPriceModal(bi); });
    descWrap.appendChild(descDiv); descWrap.appendChild(editBtn); descWrap.appendChild(clockBtn);
    tdItem.appendChild(descWrap);
    if (bi.part_number) {
      const pnDiv = document.createElement('div'); pnDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted)"; pnDiv.textContent = bi.part_number; tdItem.appendChild(pnDiv);
    }

    // Qty cell
    const tdQty = row.insertCell(); tdQty.style.cssText = 'text-align:center;color:var(--muted);font-size:12px'; tdQty.textContent = bi.quantity;

    // Supplier cells
    for (const s of suppliers) {
      const m = matchLookup[bi.id]?.[s.id];
      const isIncludedIn = m?.match_type === 'included_in';
      const isHistorical = m?.match_type === 'historical';
      const isSel = selectedSuppId === s.id;
      const price = effPrice(m?.quotation_items, extraByMatchId[m?.id] || []);
      const _cur2 = m?.quotation_items?.currency;
      const rate = (_cur2 && _cur2 !== 'MZN') ? (s.cambio || 1) : 1;
      const priceMZN = price != null ? price * rate : null;
      const isLowest = !isIncludedIn && priceMZN != null && priceMZN === lowestPriceMZN && lowestPriceMZN < Infinity;
      const tdSupp = row.insertCell();
      const cellDiv = document.createElement('div');
      let cls = 'match-cell';
      if (m) { if (isIncludedIn) cls += ' match-incl'; else if (isHistorical) cls += ' match-hist'; else if (isSel) cls += ' match-selected'; else if (isLowest) cls += ' match-lowest'; }
      else cls += ' match-empty';
      cellDiv.className = cls;
      cellDiv.addEventListener('click', () => openMatchModal(bi.id, s.id));
      if (m) {
        if (isIncludedIn) {
          const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:var(--muted);letter-spacing:1px'; lbl.textContent = 'INCL.'; cellDiv.appendChild(lbl);
        } else {
          const currency = m.quotation_items?.currency || '';
          const priceDiv = document.createElement('div');
          priceDiv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600";
          priceDiv.textContent = fmtPrice(price);
          const currSpan = document.createElement('span'); currSpan.style.cssText = 'font-size:9px;opacity:.6;margin-left:2px'; currSpan.textContent = currency;
          priceDiv.appendChild(currSpan); cellDiv.appendChild(priceDiv);
          if (isSel) { const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:var(--accent);letter-spacing:1px'; lbl.textContent = 'SELECIONADO'; cellDiv.appendChild(lbl); }
          else if (isLowest) { const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:#4fc3f7;letter-spacing:1px'; lbl.textContent = 'MAIS BAIXO'; cellDiv.appendChild(lbl); }
          if (isHistorical) { const lbl = document.createElement('div'); lbl.style.cssText = 'font-size:9px;color:#f59e0b;letter-spacing:1px'; lbl.textContent = 'HIST.'; cellDiv.appendChild(lbl); }
          const inclItems = includedByLookup[bi.id + '_' + s.id] || [];
          for (const im of inclItems) {
            const inclBi = bomItems.find(b => b.id === im.bom_item_id);
            if (inclBi) { const d = document.createElement('div'); d.style.cssText = 'font-size:9px;color:var(--muted);margin-top:2px'; d.textContent = '+ ' + (inclBi.description || '?'); cellDiv.appendChild(d); }
          }
          const extraLines = extraByMatchId[m?.id] || [];
          for (const exl of extraLines) {
            const d = document.createElement('div'); d.style.cssText = 'font-size:9px;color:var(--muted);margin-top:2px';
            d.textContent = '+ ' + (exl.quotation_items?.raw_description || '?'); cellDiv.appendChild(d);
          }
        }
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

function _renderComparacaoView(el, matchLookup, selLookup, pct, pctColor, covered, equipItems, serviceItems, mode, extraByMatchId) {
  mode = mode || 'itens';
  const includeServices = mode === 'resumo' && serviceItems.length > 0;
  const includedByLookup = {};
  for (const m of matches) {
    if (m.match_type === 'included_in' && m.included_in_bom_item_id) {
      const key = m.included_in_bom_item_id + '_' + m.supplier_id;
      if (!includedByLookup[key]) includedByLookup[key] = [];
      includedByLookup[key].push(m);
    }
  }
  const numCols = suppliers.length + (includeServices ? 1 : 0);

  const suppCoverage = {};
  for (const s of suppliers) suppCoverage[s.id] = equipItems.filter(bi => matchLookup[bi.id]?.[s.id] != null).length;
  const topSupp = suppliers.reduce((best, s) => suppCoverage[s.id] > (suppCoverage[best?.id] || 0) ? s : best, null);
  // For items with multiple matches and no selection: track which supplier has the lowest price
  const lowestSuppForItem = {};
  for (const bi of equipItems) {
    if (selLookup[bi.id]) continue;
    const matchCount = Object.keys(matchLookup[bi.id] || {}).length;
    if (matchCount <= 1) continue;
    let lowestMZN = null, lowestSuppId = null, lowestRawP = null, lowestRate = 1;
    for (const s of suppliers) {
      const m = matchLookup[bi.id]?.[s.id];
      if (!m || m.match_type === 'included_in') continue;
      const p = effPrice(m.quotation_items, extraByMatchId[m.id] || []);
      if (p == null) continue;
      const cur = m.quotation_items?.currency;
      const rate = (cur && cur !== 'MZN') ? (s.cambio || 1) : 1;
      const pMZN = p * rate;
      if (lowestMZN === null || pMZN < lowestMZN) { lowestMZN = pMZN; lowestRawP = p; lowestRate = rate; lowestSuppId = s.id; }
    }
    if (lowestSuppId !== null) lowestSuppForItem[bi.id] = { suppId: lowestSuppId, price: lowestRawP, rate: lowestRate };
  }

  const colTotals = {};
  for (const s of suppliers) {
    colTotals[s.id] = equipItems.reduce((sum, bi) => {
      const matchCount = Object.keys(matchLookup[bi.id] || {}).length;
      const selectedSuppId = selLookup[bi.id];
      const isSelected = selectedSuppId === s.id;
      const thisMatch = matchLookup[bi.id]?.[s.id];
      if (thisMatch?.match_type === 'included_in') return sum;
      const isOnlyMatch = matchCount === 1 && thisMatch != null && thisMatch.match_type !== 'included_in';
      if (isSelected || isOnlyMatch) {
        const p = effPrice(thisMatch?.quotation_items, extraByMatchId[thisMatch?.id] || []);
        const cur = thisMatch?.quotation_items?.currency;
        const rate = (cur && cur !== 'MZN') ? (s.cambio || 1) : 1;
        return sum + (p != null ? p * rate * (bi.quantity || 1) : 0);
      }
      if (!selectedSuppId && lowestSuppForItem[bi.id]?.suppId === s.id) {
        return sum + lowestSuppForItem[bi.id].price * lowestSuppForItem[bi.id].rate * (bi.quantity || 1);
      }
      return sum;
    }, 0);
  }
  const totalCovered = equipItems.reduce((sum, bi) => {
    const matchCount = Object.keys(matchLookup[bi.id] || {}).length;
    const selectedSuppId = selLookup[bi.id];
    if (selectedSuppId) {
      const selMatch = matchLookup[bi.id]?.[selectedSuppId];
      if (selMatch?.match_type === 'included_in') return sum;
      const p = effPrice(selMatch?.quotation_items, extraByMatchId[selMatch?.id] || []);
      const selSupp = suppliers.find(s => s.id === selectedSuppId);
      const cur = selMatch?.quotation_items?.currency;
      const rate = (cur && cur !== 'MZN') ? (selSupp?.cambio || 1) : 1;
      return sum + (p ? p * rate * (bi.quantity || 1) : 0);
    }
    if (matchCount === 1) {
      const onlySuppId = Object.keys(matchLookup[bi.id])[0];
      const onlyMatch = matchLookup[bi.id][onlySuppId];
      if (onlyMatch?.match_type === 'included_in') return sum;
      const p = effPrice(onlyMatch?.quotation_items, extraByMatchId[onlyMatch?.id] || []);
      const onlySupp = suppliers.find(s => s.id === onlySuppId);
      const cur = onlyMatch?.quotation_items?.currency;
      const rate = (cur && cur !== 'MZN') ? (onlySupp?.cambio || 1) : 1;
      return sum + (p ? p * rate * (bi.quantity || 1) : 0);
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
  if (includeServices && serviceTotal > 0) statsDiv.appendChild(makeStatBlock('SERVIÇOS TRIANA', fmtPrice(serviceTotal), 'var(--warn)'));
  el.appendChild(statsDiv);

  // ── Controls: toggle supplier descriptions ──
  const controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap';
  const descBtn = document.createElement('button');
  descBtn.className = 'btn btn-sm' + (showSupplierDescs ? ' btn-primary' : ' btn-ghost');
  descBtn.textContent = (showSupplierDescs ? '✓ ' : '') + 'Mostrar descrições';
  descBtn.addEventListener('click', () => { showSupplierDescs = !showSupplierDescs; renderMatchingTab(); });
  controlsRow.appendChild(descBtn);
  el.appendChild(controlsRow);

  // Comp table
  const compWrap = document.createElement('div'); compWrap.className = 'comp-wrap';
  const table = document.createElement('table'); table.className = 'comp-table';

  // Thead
  const thead = table.createTHead(); const hrow = thead.insertRow();
  const th0 = document.createElement('th'); th0.textContent = 'Item BOM'; hrow.appendChild(th0);
  for (const s of suppliers) { const th = document.createElement('th'); th.textContent = s.name; hrow.appendChild(th); }
  if (includeServices) { const thSvc = document.createElement('th'); thSvc.style.color = 'var(--warn)'; thSvc.textContent = 'Triana'; hrow.appendChild(thSvc); }

  // Tbody
  const tbody = table.createTBody();
  const visibleItems = includeServices ? bomItems : bomItems.filter(bi => !bi.is_service);
  let lastCat = null;
  for (const bi of visibleItems) {
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
      let lowestPriceMZN = Infinity;
      for (const s of suppliers) { const cm = matchLookup[bi.id]?.[s.id]; if (cm?.match_type === 'included_in') continue; const p = effPrice(cm?.quotation_items, extraByMatchId[cm?.id] || []); const cur = cm?.quotation_items?.currency; const r = (cur && cur !== 'MZN') ? (s.cambio || 1) : 1; const pMZN = p != null ? p * r : null; if (pMZN != null && pMZN < lowestPriceMZN) lowestPriceMZN = pMZN; }
      const selectedSuppId = selLookup[bi.id];
      for (const s of suppliers) {
        const m = matchLookup[bi.id]?.[s.id];
        const isIncl = m?.match_type === 'included_in';
        const price = effPrice(m?.quotation_items, extraByMatchId[m?.id] || []);
        const currency = m?.quotation_items?.currency || '';
        const isSel = selectedSuppId === s.id;
        const cur2 = m?.quotation_items?.currency;
        const rate = (cur2 && cur2 !== 'MZN') ? (s.cambio || 1) : 1;
        const isLow = !isIncl && price != null && (price * rate) === lowestPriceMZN && lowestPriceMZN < Infinity;
        const td = row.insertCell();
        const span = document.createElement('span');
        if (isIncl) {
          span.className = 'comp-cell'; span.style.color = 'var(--muted)'; span.style.fontSize = '10px'; span.textContent = 'INCL.';
        } else if (price != null) {
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
          // 1. Item pai — sempre primeiro quando showSupplierDescs
          if (showSupplierDescs) {
            const rawText = (m?.quotation_items?.raw_description || '').trim();
            if (rawText) {
              const rawDiv = document.createElement('div');
              rawDiv.className = 'comp-raw-desc';
              rawDiv.textContent = rawText;
              rawDiv.title = 'Clicar para expandir/colapsar';
              rawDiv.addEventListener('click', (ev) => { ev.stopPropagation(); rawDiv.classList.toggle('expanded'); });
              span.appendChild(rawDiv);
            }
          }
          // 2. Incluído em
          const inclItems = includedByLookup[bi.id + '_' + s.id] || [];
          for (const im of inclItems) {
            const inclBi = bomItems.find(b => b.id === im.bom_item_id);
            if (!inclBi) continue;
            const inclText = inclBi.description || '?';
            const d = document.createElement('div'); d.style.cssText = 'font-size:9px;color:var(--muted);margin-top:2px';
            d.textContent = '+ ' + (showSupplierDescs ? '' : inclText);
            if (showSupplierDescs) {
              const inclDiv = document.createElement('div');
              inclDiv.className = 'comp-raw-desc';
              inclDiv.textContent = inclText;
              inclDiv.title = 'Clicar para expandir/colapsar';
              inclDiv.addEventListener('click', ev => { ev.stopPropagation(); inclDiv.classList.toggle('expanded'); });
              d.appendChild(inclDiv);
            }
            span.appendChild(d);
          }
          // 3. Dividir em linhas
          const extraLines2 = extraByMatchId[m?.id] || [];
          for (const exl of extraLines2) {
            const exlText = (exl.quotation_items?.raw_description || '?');
            const d = document.createElement('div'); d.style.cssText = 'font-size:9px;color:var(--muted);margin-top:2px';
            d.textContent = '+ ' + (showSupplierDescs ? '' : exlText);
            if (showSupplierDescs) {
              const exlDiv = document.createElement('div');
              exlDiv.className = 'comp-raw-desc';
              exlDiv.textContent = exlText;
              exlDiv.title = 'Clicar para expandir/colapsar';
              exlDiv.addEventListener('click', ev => { ev.stopPropagation(); exlDiv.classList.toggle('expanded'); });
              d.appendChild(exlDiv);
            }
            span.appendChild(d);
          }
        } else {
          span.className = 'comp-cell comp-cell-none'; span.textContent = '—';
        }
        td.appendChild(span);
      }
      if (includeServices) row.insertCell();
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
  if (includeServices) { const td = totalRow.insertCell(); td.style.cssText = "font-family:'DM Mono',monospace;font-size:12px;color:var(--warn);font-weight:600"; td.textContent = serviceTotal > 0 ? fmtPrice(serviceTotal) : '—'; }

  const namesRow = tfoot.insertRow(); namesRow.insertCell();
  for (const s of suppliers) { const td = namesRow.insertCell(); td.style.cssText = "text-align:center;font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase;padding:6px 12px;white-space:nowrap"; td.textContent = s.name; }
  if (includeServices) { const td = namesRow.insertCell(); td.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--warn);letter-spacing:.6px;text-transform:uppercase;text-align:center;padding:6px 12px"; td.textContent = 'Triana'; }

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

function openAddToBomModal(parentBomId, supplierId, qi) {
  const parentBi = bomItems.find(b => b.id === parentBomId);
  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = 'Adicionar ao BOM'; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.style.cssText = 'font-size:14px;margin-bottom:4px'; title.textContent = qi.raw_description; el.appendChild(title);
  const sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:16px';
  sub.textContent = 'Novo item do BOM — fica imediatamente abaixo do item pai escolhido.'; el.appendChild(sub);

  const grid = document.createElement('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px';

  function mkField(label, value, fullWidth) {
    const wrap = document.createElement('div'); if (fullWidth) wrap.style.gridColumn = '1/-1';
    const lbl = document.createElement('label'); lbl.style.cssText = 'display:block;font-size:11px;color:var(--muted);margin-bottom:4px'; lbl.textContent = label;
    const inp = document.createElement('input'); inp.type = 'text'; inp.value = value || ''; inp.style.width = '100%';
    wrap.appendChild(lbl); wrap.appendChild(inp); grid.appendChild(wrap);
    return inp;
  }

  const inpDesc = mkField('Descrição', qi.raw_description, true);
  const inpPart = mkField('Part #', qi.raw_part_number || '');
  const inpQty  = mkField('Qty', qi.quantity || 1);
  const inpCat  = mkField('Categoria', parentBi?.category || '');

  // Sheet dropdown
  const sheetWrap = document.createElement('div');
  const sheetLbl = document.createElement('label'); sheetLbl.style.cssText = 'display:block;font-size:11px;color:var(--muted);margin-bottom:4px'; sheetLbl.textContent = 'Sheet';
  const sheetSel = document.createElement('select'); sheetSel.style.width = '100%';
  const sheets = [...new Set(bomItems.map(b => b.sheet_name).filter(Boolean))];
  sheets.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; if (s === (parentBi?.sheet_name || sheets[0])) o.selected = true; sheetSel.appendChild(o); });
  sheetWrap.appendChild(sheetLbl); sheetWrap.appendChild(sheetSel); grid.appendChild(sheetWrap);

  el.appendChild(grid);

  // Parent item dropdown
  const parWrap = document.createElement('div'); parWrap.style.marginBottom = '16px';
  const parLbl = document.createElement('label'); parLbl.style.cssText = 'display:block;font-size:11px;color:var(--muted);margin-bottom:4px'; parLbl.textContent = 'Item pai (novo item fica abaixo deste)';
  const parSel = document.createElement('select'); parSel.style.width = '100%';
  bomItems.filter(b => !b.is_service).forEach(b => {
    const o = document.createElement('option'); o.value = b.id;
    o.textContent = (b.description || '—') + (b.part_number ? '  [' + b.part_number + ']' : '');
    if (b.id === parentBomId) o.selected = true;
    parSel.appendChild(o);
  });
  parWrap.appendChild(parLbl); parWrap.appendChild(parSel); el.appendChild(parWrap);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'btn btn-primary'; lbtn(confirmBtn, 'plus', 'Adicionar ao BOM');
  confirmBtn.addEventListener('click', async () => {
    const desc = inpDesc.value.trim();
    if (!desc) { showToast('Descrição obrigatória.', true); return; }
    confirmBtn.disabled = true;
    try {
      await addToBom(parSel.value, supplierId, qi, {
        description: desc,
        part_number: inpPart.value.trim() || null,
        qty: parseFloat(inpQty.value) || 1,
        category: inpCat.value.trim() || null,
        sheet: sheetSel.value,
      });
    } catch(e) { showToast('Erro: ' + e.message, true); confirmBtn.disabled = false; }
  });
  actions.appendChild(confirmBtn);
  el.appendChild(actions);
  showModal(el);
}

async function addToBom(parentBomId, supplierId, qi, formData) {
  const pai = bomItems.find(b => b.id === parentBomId);
  if (!pai) throw new Error('Item pai não encontrado.');

  // Shift all items after parent
  const toShift = bomItems.filter(b => b.sort_order > pai.sort_order);
  if (toShift.length) {
    await API.updateBomItemsSortOrder(toShift.map(b => ({ id: b.id, sort_order: b.sort_order + 1 })));
  }

  // Insert new BOM item
  const newItem = {
    process_id: processId,
    bom_version_id: bomVersions[0]?.id || null,
    description: formData.description,
    part_number: formData.part_number,
    quantity: formData.qty,
    category: formData.category || pai.category || null,
    sheet_name: formData.sheet || pai.sheet_name || 'Sheet1',
    sort_order: pai.sort_order + 1,
    is_service: false,
    service_price: 0,
  };
  const [saved] = await API.saveBomItems([newItem]);

  // Create match
  await API.saveMatch({
    process_id: processId,
    bom_item_id: saved.id,
    supplier_id: supplierId,
    quotation_item_id: qi.id,
    match_type: 'manual',
    confidence: 1,
  });

  showToast('Item adicionado ao BOM e linkado.');
  closeModal();
  await loadAll();
  renderMatchingTab();
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
  } else if (currentMatch?.match_type === 'included_in') {
    const coveringBi = bomItems.find(b => b.id === currentMatch.included_in_bom_item_id);
    const inclBanner = document.createElement('div');
    inclBanner.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:16px';
    const inclLbl = document.createElement('div'); inclLbl.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:4px"; inclLbl.textContent = 'INCLUÍDO EM';
    const inclDesc = document.createElement('div'); inclDesc.style.cssText = 'font-size:13px;font-weight:600'; inclDesc.textContent = coveringBi?.description || '—';
    inclBanner.appendChild(inclLbl); inclBanner.appendChild(inclDesc);
    el.appendChild(inclBanner);
  } else {
    const qLabel = document.createElement('div'); qLabel.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;margin-bottom:8px"; qLabel.textContent = 'SELECIONA UM ITEM DA COTAÇÃO'; el.appendChild(qLabel);
    const listWrap = document.createElement('div'); listWrap.style.cssText = 'max-height:300px;overflow-y:auto;margin-bottom:16px';
    for (const qi of qItems) {
      const isLinked = currentMatch?.quotation_item_id === qi.id;
      const hasAnyMatch = matches.some(m => m.quotation_item_id === qi.id);
      const row = document.createElement('div'); row.className = 'match-pick-row' + (isLinked ? ' linked' : '');
      row.addEventListener('click', () => linkItem(bomItemId, supplierId, qi.id));
      const infoDiv = document.createElement('div'); infoDiv.style.cssText = 'flex:1;min-width:0';
      const desc = document.createElement('div'); desc.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; desc.textContent = qi.raw_description; infoDiv.appendChild(desc);
      if (qi.raw_part_number) { const pn = document.createElement('div'); pn.style.cssText = 'font-size:10px;color:var(--muted)'; pn.textContent = qi.raw_part_number; infoDiv.appendChild(pn); }
      const priceDiv = document.createElement('div'); priceDiv.style.cssText = 'text-align:right;flex-shrink:0';
      const pv = document.createElement('div'); pv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600"; pv.textContent = fmtPrice(qi.price); priceDiv.appendChild(pv);
      const cv = document.createElement('div'); cv.style.cssText = 'font-size:10px;color:var(--muted)'; cv.textContent = qi.currency; priceDiv.appendChild(cv);
      row.appendChild(infoDiv); row.appendChild(priceDiv);
      if (isLinked) {
        const badge = document.createElement('div'); badge.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:var(--accent);letter-spacing:1px;white-space:nowrap';
        badge.appendChild(licon('check', 10)); if (isSelectedSupp) badge.appendChild(document.createTextNode('SEL.')); row.appendChild(badge);
      } else if (!hasAnyMatch) {
        const addBtn = document.createElement('button'); addBtn.className = 'btn btn-ghost btn-sm';
        addBtn.style.cssText = 'font-size:10px;padding:2px 7px;flex-shrink:0;margin-left:6px';
        lbtn(addBtn, 'plus', 'BOM');
        addBtn.addEventListener('click', e => { e.stopPropagation(); closeModal(); openAddToBomModal(bomItemId, supplierId, qi); });
        row.appendChild(addBtn);
      }
      listWrap.appendChild(row);
    }
    el.appendChild(listWrap);
  }

  // Extra lines for this match
  const extras = matchExtraItems.filter(e => e.item_match_id === currentMatch?.id);

  // Show extra lines section if any
  if (extras.length && currentMatch?.match_type !== 'included_in') {
    const extraSec = document.createElement('div');
    extraSec.style.cssText = 'margin-bottom:16px;border:1px solid var(--border);border-radius:6px;overflow:hidden';
    const extraHdr = document.createElement('div');
    extraHdr.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px;padding:6px 12px;background:var(--surface2)";
    extraHdr.textContent = 'LINHAS ADICIONAIS';
    extraSec.appendChild(extraHdr);
    for (const e of extras) {
      const eRow = document.createElement('div');
      eRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--border)';
      const eDesc = document.createElement('div'); eDesc.style.cssText = 'flex:1;font-size:12px;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      eDesc.textContent = e.quotation_items?.raw_description || '—';
      const ePrice = document.createElement('div'); ePrice.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;flex-shrink:0";
      ePrice.textContent = fmtPrice(e.quotation_items?.price);
      const eRm = document.createElement('button'); eRm.className = 'btn btn-ghost btn-sm'; eRm.style.cssText = 'font-size:11px;padding:2px 6px;flex-shrink:0;color:var(--danger)'; eRm.textContent = '×';
      eRm.addEventListener('click', () => removeExtraLine(e.id, currentMatch.id));
      eRow.appendChild(eDesc); eRow.appendChild(ePrice); eRow.appendChild(eRm);
      extraSec.appendChild(eRow);
    }
    el.appendChild(extraSec);
  }

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  if (currentMatch) {
    if (currentMatch.match_type !== 'included_in') {
      const selBtn = document.createElement('button'); selBtn.className = 'btn btn-ghost btn-sm'; lbtn(selBtn, 'check', 'Selecionar como melhor oferta');
      selBtn.addEventListener('click', () => selectOffer(bomItemId, supplierId, currentMatch.quotation_item_id)); actions.appendChild(selBtn);

      // "Dividir em linhas" button — only when unused qItems exist
      const usedQiIds = new Set([
        currentMatch.quotation_item_id,
        ...extras.map(e => e.quotation_item_id),
        ...matches.filter(m => m.supplier_id === supplierId && m.id !== currentMatch.id && m.match_type !== 'included_in').map(m => m.quotation_item_id).filter(Boolean),
      ]);
      const splitAvailable = qItems.filter(qi => !usedQiIds.has(qi.id));
      if (splitAvailable.length > 0) {
        const splitBtn = document.createElement('button'); splitBtn.className = 'btn btn-ghost btn-sm';
        lbtn(splitBtn, 'git-merge', 'Dividir em linhas');
        splitBtn.addEventListener('click', () => { closeModal(); openSplitModal(bomItemId, supplierId, currentMatch.id, splitAvailable); });
        actions.appendChild(splitBtn);
      }
    }
    const rmBtn = document.createElement('button'); rmBtn.className = 'btn btn-danger btn-sm'; rmBtn.textContent = 'Remover';
    rmBtn.addEventListener('click', () => unlinkItem(bomItemId, supplierId, currentMatch.id)); actions.appendChild(rmBtn);
  } else if (qItems.length) {
    const inclBtn = document.createElement('button'); inclBtn.className = 'btn btn-ghost btn-sm'; lbtn(inclBtn, 'link-2', 'Incluído noutro item');
    inclBtn.addEventListener('click', () => { closeModal(); openIncludedInModal(bomItemId, supplierId); }); actions.appendChild(inclBtn);
  }
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn btn-ghost'; closeBtn.textContent = 'Fechar'; closeBtn.addEventListener('click', closeModal); actions.appendChild(closeBtn);
  el.appendChild(actions);

  showModal(el);
}

function openIncludedInModal(bomItemId, supplierId) {
  const bi = bomItems.find(b => b.id === bomItemId);
  const s  = suppliers.find(x => x.id === supplierId);
  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = s?.name || ''; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.style.cssText = 'font-size:14px;margin-bottom:4px'; title.textContent = bi?.description || ''; el.appendChild(title);
  const sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:16px'; sub.textContent = 'O preço deste item está incluído na linha de outro item deste fornecedor.'; el.appendChild(sub);

  const selWrap = document.createElement('div'); selWrap.style.marginBottom = '16px';
  const selLbl = document.createElement('label'); selLbl.style.cssText = 'display:block;font-size:11px;color:var(--muted);margin-bottom:4px'; selLbl.textContent = 'Coberto por';
  const sel = document.createElement('select'); sel.style.width = '100%';
  const hasSuppMatch = id => matches.some(m => m.bom_item_id === id && m.supplier_id === supplierId && m.match_type !== 'included_in');
  bomItems.filter(b => !b.is_service && b.id !== bomItemId && hasSuppMatch(b.id)).forEach(b => {
    const o = document.createElement('option'); o.value = b.id;
    o.textContent = (b.description || '—') + (b.part_number ? '  [' + b.part_number + ']' : '');
    sel.appendChild(o);
  });
  selWrap.appendChild(selLbl); selWrap.appendChild(sel); el.appendChild(selWrap);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const confirmBtn = document.createElement('button'); confirmBtn.className = 'btn btn-primary'; lbtn(confirmBtn, 'link-2', 'Confirmar');
  confirmBtn.addEventListener('click', async () => {
    if (!sel.value) return;
    confirmBtn.disabled = true;
    try { await saveIncludedIn(bomItemId, supplierId, sel.value); }
    catch(e) { showToast('Erro: ' + e.message, true); confirmBtn.disabled = false; }
  });
  actions.appendChild(confirmBtn);
  el.appendChild(actions);
  showModal(el);
}

function openSplitModal(bomItemId, supplierId, itemMatchId, availableQItems) {
  const bi = bomItems.find(b => b.id === bomItemId);
  const s  = suppliers.find(x => x.id === supplierId);
  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = s?.name || ''; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.style.cssText = 'font-size:14px;margin-bottom:4px'; title.textContent = bi?.description || ''; el.appendChild(title);
  const sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:16px'; sub.textContent = 'Seleciona a linha adicional da cotação que faz parte deste item.'; el.appendChild(sub);

  const listWrap = document.createElement('div'); listWrap.style.cssText = 'max-height:300px;overflow-y:auto;margin-bottom:16px';
  for (const qi of availableQItems) {
    const row = document.createElement('div'); row.className = 'match-pick-row';
    row.addEventListener('click', () => addExtraLine(itemMatchId, qi.id, qi));
    const infoDiv = document.createElement('div'); infoDiv.style.cssText = 'flex:1;min-width:0';
    const desc = document.createElement('div'); desc.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'; desc.textContent = qi.raw_description; infoDiv.appendChild(desc);
    if (qi.raw_part_number) { const pn = document.createElement('div'); pn.style.cssText = 'font-size:10px;color:var(--muted)'; pn.textContent = qi.raw_part_number; infoDiv.appendChild(pn); }
    const priceDiv = document.createElement('div'); priceDiv.style.cssText = 'text-align:right;flex-shrink:0';
    const pv = document.createElement('div'); pv.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600"; pv.textContent = fmtPrice(qi.price); priceDiv.appendChild(pv);
    const cv = document.createElement('div'); cv.style.cssText = 'font-size:10px;color:var(--muted)'; cv.textContent = qi.currency; priceDiv.appendChild(cv);
    row.appendChild(infoDiv); row.appendChild(priceDiv);
    listWrap.appendChild(row);
  }
  el.appendChild(listWrap);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  el.appendChild(actions);
  showModal(el);
}

async function addExtraLine(itemMatchId, quotationItemId, qi) {
  try {
    closeModal();
    const saved = await API.addMatchExtraItem(itemMatchId, quotationItemId);
    matchExtraItems.push({ ...saved, quotation_items: qi });
    renderMatchingTab();
    showToast('Linha adicionada.');
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function removeExtraLine(extraItemId, itemMatchId) {
  try {
    matchExtraItems = matchExtraItems.filter(e => e.id !== extraItemId);
    const _preScroll = _captureMatchingScroll(document.getElementById('matchingContent'));
    closeModal();
    renderMatchingTab();
    requestAnimationFrame(() => requestAnimationFrame(() => _restoreMatchingScroll(_preScroll)));
    await API.removeMatchExtraItem(extraItemId);
    showToast('Linha removida.');
  } catch(e) {
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}

async function saveIncludedIn(bomItemId, supplierId, coveringBomItemId) {
  await API.saveMatch({
    process_id: processId,
    bom_item_id: bomItemId,
    supplier_id: supplierId,
    quotation_item_id: null,
    match_type: 'included_in',
    confidence: 1,
    included_in_bom_item_id: coveringBomItemId,
  });
  showToast('Item marcado como incluído.');
  closeModal();
  await loadMatchData();
  renderMatchingTab();
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
    const _preScroll = _captureMatchingScroll(document.getElementById('matchingContent'));
    closeModal();
    renderMatchingTab();
    requestAnimationFrame(() => requestAnimationFrame(() => _restoreMatchingScroll(_preScroll)));
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
let histMatchData = null; // lazy-fetched once per session; {supplier_name, bom_desc, quot_desc}[]
let histSkuData = null;   // lazy-fetched once per session; {supplier_name, raw_sku, bom_desc}[]
let _histMarkupGlobal = 0; // persists global markup % across historical price modal opens
function _fuzzyScore(s1, s2) {
  const t1 = _matchTokenize(s1).sort().join(' ');
  const t2 = _matchTokenize(s2).sort().join(' ');
  if (!t1 || !t2) return 0;
  const dist = _levenshtein(t1, t2);
  return 1 - dist / Math.max(t1.length, t2.length);
}

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
  const phase0Matched = new Set(); // "biId:sId" pairs skipped by Phase 0 and later phases

  // Phase -1: SKU match — exact supplier SKU is definitive evidence
  if (histSkuData === null) {
    try { histSkuData = await API.getHistoricalSkuPairs(); }
    catch(_) { histSkuData = []; }
  }
  const histSkuBySupplier = {};
  for (const p of histSkuData) {
    const key = (p.supplier_name || '').trim().toLowerCase();
    if (!histSkuBySupplier[key]) histSkuBySupplier[key] = [];
    histSkuBySupplier[key].push(p);
  }
  for (const s of suppliersWithItems) {
    const skuItems = (quotationMap[s.id] || []).filter(qi => (qi.raw_sku || '').trim());
    if (!skuItems.length) continue;
    const histPairs = histSkuBySupplier[(s.name || '').trim().toLowerCase()] || [];
    if (!histPairs.length) continue;
    for (const qi of skuItems) {
      if (matches.some(m => m.supplier_id === s.id && m.quotation_item_id === qi.id)) continue;
      const hp = histPairs.find(h => (h.raw_sku || '').trim().toLowerCase() === qi.raw_sku.trim().toLowerCase());
      if (!hp) continue;
      // SKU is definitive — use bom_desc only to identify which current BOM item to link to
      const bi = bomItems.find(b =>
        !b.is_service &&
        !matches.find(m => m.bom_item_id === b.id && m.supplier_id === s.id) &&
        !newMatches.some(m => m.bom_item_id === b.id && m.supplier_id === s.id) &&
        !phase0Matched.has(`${b.id}:${s.id}`) &&
        !rejectedSet.has(`${b.id}:${s.id}:${qi.id}`) &&
        _fuzzyScore(b.custom_description || b.description, hp.bom_desc) >= 0.75
      );
      if (!bi) continue;
      newMatches.push({ process_id: processId, bom_item_id: bi.id, supplier_id: s.id, quotation_item_id: qi.id, match_type: 'auto', confidence: 1.0 });
      phase0Matched.add(`${bi.id}:${s.id}`);
    }
  }

  // Phase 0: historical match — mine past item_matches for supplier+description pairs
  if (histMatchData === null) {
    try { histMatchData = await API.getHistoricalMatchPairs(); }
    catch(_) { histMatchData = []; }
  }
  const histBySupplier = {};
  for (const p of histMatchData) {
    const key = (p.supplier_name || '').trim().toLowerCase();
    if (!histBySupplier[key]) histBySupplier[key] = [];
    histBySupplier[key].push(p);
  }
  for (const bi of bomItems) {
    if (bi.is_service) continue;
    const biDesc = bi.custom_description || bi.description;
    if (!biDesc) continue;
    for (const s of suppliersWithItems) {
      if (matches.find(m => m.bom_item_id === bi.id && m.supplier_id === s.id)) continue;
      if (newMatches.some(m => m.bom_item_id === bi.id && m.supplier_id === s.id)) continue;
      const histPairs = histBySupplier[(s.name || '').trim().toLowerCase()] || [];
      if (!histPairs.length) continue;
      let p0matched = false;
      for (const qi of (quotationMap[s.id] || [])) {
        if (rejectedSet.has(`${bi.id}:${s.id}:${qi.id}`)) continue;
        for (const hp of histPairs) {
          if (_fuzzyScore(qi.raw_description, hp.quot_desc) >= 0.9 &&
              _fuzzyScore(biDesc, hp.bom_desc) >= 0.75) {
            newMatches.push({ process_id: processId, bom_item_id: bi.id, supplier_id: s.id, quotation_item_id: qi.id, match_type: 'auto', confidence: 1.0 });
            phase0Matched.add(`${bi.id}:${s.id}`);
            p0matched = true;
            break;
          }
        }
        if (p0matched) break;
      }
    }
  }

  for (const bi of bomItems) {
    if (bi.is_service) continue;
    const biTokens = _matchTokenize(bi.description);
    if (!biTokens.length) continue;
    const biSpecTokens = biTokens.filter(t => /\d/.test(t)); // numeric specs (sizes, fractions, model codes)

    for (const s of suppliersWithItems) {
      if (matches.find(m => m.bom_item_id === bi.id && m.supplier_id === s.id)) continue; // already matched
      if (phase0Matched.has(`${bi.id}:${s.id}`)) continue; // matched in Phase 0
      let bestItem = null, bestScore = 0;

      for (const qi of quotationMap[s.id]) {
        // 1. Part number exact match — highest priority, skip word matching
        if (bi.part_number && qi.raw_part_number && norm(bi.part_number) === norm(qi.raw_part_number)) {
          bestItem = qi; bestScore = 1.0; break;
        }
        // 2. Fuzzy match (token_sort_ratio)
        const qTokens = _matchTokenize(qi.raw_description);
        // Spec gate: BOM numeric specs (sizes, fractions) must appear in quotation
        if (biSpecTokens.length > 0 && !biSpecTokens.some(bs => qTokens.includes(bs))) continue;
        const score = _fuzzyScore(bi.description, qi.raw_description);
        if (score > bestScore) { bestScore = score; bestItem = qi; }
      }

      if (bestItem && bestScore >= 0.55 && !rejectedSet.has(`${bi.id}:${s.id}:${bestItem.id}`)) {
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

async function openHistoricalPriceModal(bi) {
  const el = document.createElement('div');
  el.style.cssText = 'min-width:580px;max-width:780px;display:flex;flex-direction:column;gap:12px';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;font-size:15px';
  title.textContent = bi.custom_description || bi.description;
  el.appendChild(title);

  // Global markup row
  const markupRow = document.createElement('div');
  markupRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px';
  const markupLabel = document.createElement('label');
  markupLabel.textContent = 'Markup %';
  markupLabel.style.cssText = 'white-space:nowrap;color:var(--muted)';
  const markupInput = document.createElement('input');
  markupInput.type = 'number'; markupInput.min = '0'; markupInput.step = '0.1';
  markupInput.value = _histMarkupGlobal;
  markupInput.style.cssText = 'width:80px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--surface2);color:var(--text)';
  markupInput.addEventListener('input', () => { _histMarkupGlobal = parseFloat(markupInput.value) || 0; });
  markupRow.appendChild(markupLabel);
  markupRow.appendChild(markupInput);
  el.appendChild(markupRow);

  // Search row
  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'display:flex;gap:6px';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.value = bi.custom_description || bi.description;
  searchInput.style.cssText = 'flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--surface2);color:var(--text)';
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button'; searchBtn.className = 'btn btn-sm btn-secondary';
  searchBtn.textContent = 'Pesquisar';
  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchBtn);
  el.appendChild(searchRow);

  // Results container
  const resultsDiv = document.createElement('div');
  resultsDiv.style.cssText = 'max-height:380px;overflow-y:auto';
  el.appendChild(resultsDiv);

  showModalLg(el);

  async function doSearch() {
    const query = searchInput.value.trim();
    resultsDiv.replaceChildren();
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'padding:16px;text-align:center;color:var(--muted);font-size:13px';
    loadingDiv.textContent = 'A pesquisar…';
    resultsDiv.appendChild(loadingDiv);
    let rows;
    try { rows = await API.searchPriceHistory(query); }
    catch(e) {
      resultsDiv.replaceChildren();
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'padding:12px;color:#f87171;font-size:13px';
      errDiv.textContent = 'Erro: ' + e.message;
      resultsDiv.appendChild(errDiv);
      return;
    }
    resultsDiv.replaceChildren();

    // Exclude rows whose supplier already has a match for this bom_item
    const existingMatchSupplierIds = new Set(
      matches.filter(m => m.bom_item_id === bi.id).map(m => m.supplier_id)
    );
    const filtered = rows.filter(row => {
      const suppName = (row.suppliers?.name || '').trim().toLowerCase();
      const currentProcessSupp = suppliers.find(s => s.name.trim().toLowerCase() === suppName);
      return !(currentProcessSupp && existingMatchSupplierIds.has(currentProcessSupp.id));
    });

    if (!filtered.length) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'padding:20px;text-align:center;color:var(--muted);font-size:13px;font-style:italic';
      emptyDiv.textContent = 'Nenhum resultado encontrado.';
      resultsDiv.appendChild(emptyDiv);
      return;
    }

    const globalMkp = parseFloat(markupInput.value) || 0;

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
    const thead = table.createTHead();
    const hRow = thead.insertRow();
    ['Fornecedor', 'Descrição (fornecedor)', 'Preço base', 'Markup %', 'Preço final', 'Data', 'Processo', ''].forEach(h => {
      const th = document.createElement('th');
      th.style.cssText = 'text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);color:var(--muted);white-space:nowrap;font-weight:500;position:sticky;top:0;background:var(--surface)';
      th.textContent = h;
      hRow.appendChild(th);
    });
    const tbody = table.createTBody();

    for (const row of filtered) {
      const suppName = (row.suppliers?.name || '').trim().toLowerCase();
      const currentProcessSupp = suppliers.find(s => s.name.trim().toLowerCase() === suppName);
      const tr = tbody.insertRow();
      if (currentProcessSupp) tr.style.cssText = 'background:rgba(34,197,94,.07);outline:1px solid rgba(34,197,94,.3)';
      const basePrice = row.price || 0;
      const proc = row.suppliers?.processes;

      const tdSupp = tr.insertCell(); tdSupp.style.cssText = 'padding:5px 6px;white-space:nowrap;font-weight:500';
      tdSupp.textContent = row.suppliers?.name || '—';

      const tdDesc = tr.insertCell(); tdDesc.style.cssText = 'padding:5px 6px;max-width:200px;word-break:break-word';
      tdDesc.textContent = row.raw_description || '—';

      const rowCurrency = row.currency || 'MZN';
      const rowCambio = (rowCurrency !== 'MZN') ? (row.suppliers?.cambio || 1) : 1;

      const tdBase = tr.insertCell(); tdBase.style.cssText = "padding:5px 6px;white-space:nowrap;font-family:'IBM Plex Mono',monospace";
      tdBase.textContent = fmtPrice(basePrice) + ' ' + rowCurrency;

      const tdMkp = tr.insertCell(); tdMkp.style.cssText = 'padding:5px 6px';
      const rowMkpInput = document.createElement('input');
      rowMkpInput.type = 'number'; rowMkpInput.min = '0'; rowMkpInput.step = '0.1';
      rowMkpInput.value = globalMkp;
      rowMkpInput.style.cssText = 'width:65px;padding:3px 5px;border:1px solid var(--border);border-radius:3px;font-size:11px;background:var(--surface2);color:var(--text)';
      tdMkp.appendChild(rowMkpInput);

      const tdFinal = tr.insertCell(); tdFinal.style.cssText = "padding:5px 6px;white-space:nowrap;font-family:'IBM Plex Mono',monospace;font-weight:600;color:#f59e0b";
      const finalPriceDiv = document.createElement('div');
      // Final in MZN: base × cambio × (1 + markup%)
      const calcFinal = () => basePrice * rowCambio * (1 + (parseFloat(rowMkpInput.value) || 0) / 100);
      finalPriceDiv.textContent = fmtPrice(calcFinal()) + ' MZN';
      tdFinal.appendChild(finalPriceDiv);
      rowMkpInput.addEventListener('input', () => { finalPriceDiv.textContent = fmtPrice(calcFinal()) + ' MZN'; });

      const tdDate = tr.insertCell(); tdDate.style.cssText = 'padding:5px 6px;white-space:nowrap;color:var(--muted)';
      tdDate.textContent = fmtDate(row.created_at);

      const tdProc = tr.insertCell(); tdProc.style.cssText = 'padding:5px 6px;color:var(--muted);max-width:130px;word-break:break-word';
      const procLabel = proc ? ((proc.project_name || '') + (proc.client_name ? ' / ' + proc.client_name : '')) : '—';
      tdProc.textContent = procLabel;

      const tdUsar = tr.insertCell(); tdUsar.style.cssText = 'padding:5px 6px';
      const usarBtn = document.createElement('button');
      usarBtn.type = 'button'; usarBtn.className = 'btn btn-sm btn-primary';
      usarBtn.textContent = 'Usar';
      usarBtn.addEventListener('click', async () => {
        usarBtn.disabled = true; usarBtn.textContent = '…';
        try {
          _histMarkupGlobal = parseFloat(rowMkpInput.value) || 0;
          const markup = parseFloat(rowMkpInput.value) || 0;
          // Store price in original currency (markup applied), matching tab converts via cambio
          const priceToStore = basePrice * (1 + markup / 100);
          const rawHistDesc = row.raw_description || '';
          let targetSuppId = currentProcessSupp?.id ?? null;
          if (!targetSuppId) {
            if (!await _showConfirmModal('Adicionar fornecedor?', (row.suppliers?.name || 'Este fornecedor') + ' não está neste processo. Adicionar?', 'Adicionar')) {
              usarBtn.disabled = false; usarBtn.textContent = 'Usar'; return;
            }
            const newSupp = await API.createSupplier({ process_id: processId, name: row.suppliers?.name, status: 'Historical price', cambio: rowCambio > 1 ? rowCambio : undefined });
            targetSuppId = newSupp.id;
            suppliers = await API.getSuppliers(processId);
          }
          await API.createHistoricalMatch(processId, bi.id, targetSuppId, rawHistDesc, priceToStore, rowCurrency);
          closeModal();
          await loadMatchData(); renderMatchingTab();
          showToast('Preço histórico aplicado.');
        } catch(e) {
          usarBtn.disabled = false; usarBtn.textContent = 'Usar';
          showToast('Erro: ' + e.message, true);
        }
      });
      tdUsar.appendChild(usarBtn);
    }
    resultsDiv.appendChild(table);
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  doSearch();
}

function makeRowHeightCalc(fontPtSize) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = fontPtSize + 'pt Calibri, "Segoe UI", Arial, sans-serif';
  const measure = (t) => ctx.measureText(t).width;
  // Excel column "width" unit ≈ 7px per unit of default 11pt Calibri
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

  return { wrapCount, colToPx };
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

  const FONT = 'Calibri';
  const FONT_DATA = 11;
  const TITLE_BG = 'FF0F1E2E';
  const TITLE_FG = 'FFFFFFFF';
  const TITLE_SUB = 'FFB3C0D1';
  const HDR_BG  = 'FF1D2D44';
  const HDR_FG  = 'FFFFFFFF';
  const ROW_WHITE = 'FFFFFFFF';
  const ROW_ZEBRA = 'FFF3F4F6';
  const TEXT = 'FF111827';
  const BORDER = 'FFE5E7EB';
  const ACCENT = 'FF3B82F6';

  const { wrapCount, colToPx } = makeRowHeightCalc(FONT_DATA);
  const PT_PER_LINE = 14;
  const V_PADDING = 8;

  const cols = [
    { h: 'Part #',      min: 14, max: 24, align: 'left'   },
    { h: 'Descri\u00e7\u00e3o', min: 40, max: 70, align: 'left'   },
    { h: 'Qty',         min: 7,  max: 10, align: 'center' },
    { h: 'Unidade',     min: 10, max: 14, align: 'center' },
    { h: 'Categoria',   min: 18, max: 30, align: 'left'   },
  ];

  for (const [sheetName, items] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(sheetName.substring(0, 31), {
      properties: { tabColor: { argb: ACCENT } },
      views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    });

    const rows = items.map(bi => [
      bi.part_number || '\u2014',
      bi.description || '',
      bi.quantity ?? '',
      bi.unit || '',
      bi.category || '',
    ]);

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
    ws.columns = colWidths.map(w => ({ width: w }));

    ws.mergeCells(1, 1, 1, cols.length);
    const title = ws.getCell(1, 1);
    title.value = 'Itens em Falta \u2014 ' + sheetName;
    title.font = { name: FONT, bold: true, size: 16, color: { argb: TITLE_FG } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
    title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 32;

    ws.mergeCells(2, 1, 2, cols.length);
    const sub = ws.getCell(2, 1);
    sub.value = 'Gerado em ' + new Date().toLocaleDateString('pt-PT') + '  \u2022  ' + items.length + ' item' + (items.length === 1 ? '' : 's') + ' em falta';
    sub.font = { name: FONT, size: 10, color: { argb: TITLE_SUB } };
    sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
    sub.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 18;
    ws.getRow(3).height = 6;

    const hRow = ws.getRow(4);
    cols.forEach((cfg, i) => {
      const c = hRow.getCell(i + 1);
      c.value = cfg.h;
      c.font = { name: FONT, bold: true, size: FONT_DATA, color: { argb: HDR_FG } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
      c.alignment = {
        horizontal: cfg.align,
        vertical: 'middle',
        indent: cfg.align === 'left' ? 1 : 0,
      };
    });
    hRow.height = 26;

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
