// ── Matching Tab ──
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
    <div id="matchTableScroll" style="overflow-x:auto">
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
          const currency = m.quotation_items?.currency || '';
          return `<td><div class="match-cell${isSel?' match-selected':''}${isLowest&&!isSel?' match-lowest':''}" onclick="openMatchModal('${bi.id}','${s.id}')">
            <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600">${fmtPrice(price)}<span style="font-size:9px;opacity:.6;margin-left:2px">${esc(currency)}</span></div>
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

  html += `</tbody>
    <tfoot><tr>
      <td></td><td></td>
      ${suppliers.map(s=>`<td style="text-align:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase;padding:8px 10px;white-space:nowrap;border-top:1px solid var(--border)">${esc(s.name)}</td>`).join('')}
      <td></td>
    </tr></tfoot>
    </table></div>`;
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
    <div id="compTableScroll" class="comp-wrap">
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
    <tfoot>
    <tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase">Total Equipamento</td>
      ${suppliers.map(s => `<td>${colTotals[s.id] > 0 ? fmtPrice(colTotals[s.id]) : '<span style="color:#334">—</span>'}</td>`).join('')}
      ${hasServices ? `<td style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--warn);font-weight:600">${serviceTotal > 0 ? fmtPrice(serviceTotal) : '—'}</td>` : ''}
    </tr>
    <tr>
      <td></td>
      ${suppliers.map(s => `<td style="text-align:center;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.6px;text-transform:uppercase;padding:6px 12px;white-space:nowrap">${esc(s.name)}</td>`).join('')}
      ${hasServices ? '<td style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--warn);letter-spacing:.6px;text-transform:uppercase;text-align:center;padding:6px 12px">Triana</td>' : ''}
    </tr>
    </tfoot>
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
      const source = group.find(bi => allMatchLookup[bi.id]?.[suppId]);
      if (!source) continue;
      const quotItemId = allMatchLookup[source.id][suppId];
      for (const bi of group) {
        if (allMatchLookup[bi.id]?.[suppId]) continue; // already matched
        if (rejectedSet.has(`${bi.id}:${suppId}:${quotItemId}`)) continue;
        newMatches.push({ process_id: processId, bom_item_id: bi.id, supplier_id: suppId, quotation_item_id: quotItemId, match_type: 'auto', confidence: 1.0 });
        if (!allMatchLookup[bi.id]) allMatchLookup[bi.id] = {};
        allMatchLookup[bi.id][suppId] = quotItemId;
        propagated++;
      }
    }
  }

  if (!newMatches.length) { showToast('Nenhum match automático encontrado.'); return; }
  try {
    await API.saveMatches(newMatches);
    await loadMatchData();
    renderMatchingTab();
    const msg = propagated > 0
      ? `${newMatches.length} match(es) criado(s) — ${propagated} propagado(s) de itens repetidos.`
      : `${newMatches.length} match(es) automático(s) criado(s).`;
    showToast(msg);
  } catch(e) {
    // Sync state with DB even on error — partial saves may have occurred
    await loadMatchData(); renderMatchingTab();
    showToast('Erro: ' + e.message, true);
  }
}
