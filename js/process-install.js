// ── Installation Tab (service items only) ──
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

// ── Process Report ──
function generateReport() {
  if (hasRole('commercial')) { showToast('Sem permissao para gerar relatorio.', true); return; }

  const suppLookup = {};
  for (const s of suppliers) suppLookup[s.id] = s.name;

  const selItems = [];
  let equipTotal = 0;
  const selectedBomIds = new Set(selectedOffers.map(o => o.bom_item_id));

  // Selected offers
  for (const o of selectedOffers) {
    const bi = bomItems.find(b => b.id === o.bom_item_id);
    const qi = (quotationMap[o.supplier_id] || []).find(q => q.id === o.quotation_item_id);
    if (!bi || !qi || bi.is_service) continue;
    const effP = (qi.price || 0) * (1 - ((qi.discount || 0) / 100));
    const total = effP * (bi.quantity || 1);
    equipTotal += total;
    selItems.push({ description: bi.custom_description || bi.description, part: bi.part_number || '-', qty: bi.quantity || 1,
      supplier: suppLookup[o.supplier_id] || '-', unitPrice: effP, totalPrice: total });
  }

  // Items with exactly 1 match (not selected)
  for (const bi of bomItems) {
    if (bi.is_service || selectedBomIds.has(bi.id)) continue;
    const biMatches = matches.filter(m => m.bom_item_id === bi.id);
    if (biMatches.length !== 1) continue;
    const m = biMatches[0];
    const qi = (quotationMap[m.supplier_id] || []).find(q => q.id === m.quotation_item_id);
    if (!qi) continue;
    const effP = (qi.price || 0) * (1 - ((qi.discount || 0) / 100));
    const total = effP * (bi.quantity || 1);
    equipTotal += total;
    selItems.push({ description: bi.custom_description || bi.description, part: bi.part_number || '-', qty: bi.quantity || 1,
      supplier: suppLookup[m.supplier_id] || '-', unitPrice: effP, totalPrice: total });
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
