// ── Icon helper — Lucide stroke icons ──
// licon(name, size) — returns <i data-lucide="..."> and schedules createIcons after current tick
// lbtn(el, name, label) — appends icon + text to el (same auto-schedule)
let _liconTimer = null;
function _schedLucide() {
  if (typeof lucide === 'undefined') return;
  clearTimeout(_liconTimer);
  _liconTimer = setTimeout(() => lucide.createIcons(), 0);
}
function licon(name, size = 13) {
  const i = document.createElement('i');
  i.dataset.lucide = name;
  i.style.cssText = `width:${size}px;height:${size}px;vertical-align:middle;stroke-width:1.75;flex-shrink:0`;
  _schedLucide();
  return i;
}
function lbtn(el, name, label, size = 13) {
  el.appendChild(licon(name, size));
  if (label) el.appendChild(document.createTextNode('\u00a0' + label));
}

// ── API — all Supabase calls in one place ──

function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
function _fuzzySearchScore(s1, s2) {
  const tok = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1).sort().join(' ');
  const t1 = tok(s1), t2 = tok(s2);
  if (!t1 || !t2) return 0;
  const dist = _levenshtein(t1, t2);
  return 1 - dist / Math.max(t1.length, t2.length);
}

function _sanitizeError(error) {
  if (!error) return new Error('Unknown error');
  const msg = error.message || String(error);
  const lower = msg.toLowerCase();
  // User-actionable BOM checks (Postgres check constraints — show real limit, not generic toast)
  if (lower.includes('chk_bom_description_length')) {
    return new Error('Descrição do item demasiado longa (máximo 2000 caracteres por linha do BOM).');
  }
  if (lower.includes('chk_bom_part_number_length')) {
    return new Error('Referência (part number) demasiado longa (máximo 100 caracteres).');
  }
  if (lower.includes('chk_bom_quantity_range')) {
    return new Error('Quantidade inválida (deve ser maior que 0 e inferior a 1 000 000).');
  }
  if (lower.includes('chk_quot_description_length')) {
    return new Error('Descrição da linha de cotação demasiado longa (máximo 2000 caracteres).');
  }
  const blocked = ['relation', 'column', 'constraint', 'pg_', 'auth.', 'storage.', 'schema'];
  if (blocked.some(k => lower.includes(k))) {
    console.error('[API]', msg);
    return new Error('Operação não permitida.');
  }
  return error;
}

const QUOT_MAX_RAW_DESC_LEN = 2000; // must match chk_quot_description_length in DB

/** Strip client-only fields before quotation_items insert/upsert (PostgREST rejects unknown columns). */
function _quotationItemRowForDb(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const k of Object.keys(row)) {
    if (k.startsWith('_')) continue;
    out[k] = row[k];
  }
  if (out.raw_description != null) {
    out.raw_description = String(out.raw_description).slice(0, QUOT_MAX_RAW_DESC_LEN);
  }
  return out;
}

const API = {

  // ── Processes ──
  async getProcesses() {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id), commercial_name, procurement_name')
      .order('created_at', { ascending: false });
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getProcess(id) {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id), commercial_name, procurement_name')
      .eq('id', id)
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getProcurementUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role')
      .in('role', ['procurement', 'admin'])
      .order('name');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async createProcess(fields) {
    const { data, error } = await supabase
      .from('processes')
      .insert({ ...fields, created_by: currentUser.id })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async updateProcess(id, fields) {
    const { data, error } = await supabase
      .from('processes')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async deleteProcess(id) {
    const { error } = await supabase.from('processes').delete().eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async saveDismissedSuggestions(processId, namesArr) {
    const { error } = await supabase
      .from('processes')
      .update({ dismissed_suggestions: namesArr })
      .eq('id', processId);
    if (error) throw _sanitizeError(error);
  },

  // ── BOM Versions ──
  async createBomVersion(processId, originalName, filePath, versionNumber) {
    const { data, error } = await supabase
      .from('bom_versions')
      .insert({ process_id: processId, original_name: originalName, file_path: filePath, version_number: versionNumber, uploaded_by: currentUser.id })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getBomVersions(processId) {
    const { data, error } = await supabase
      .from('bom_versions')
      .select('*')
      .eq('process_id', processId)
      .order('version_number', { ascending: false });
    if (error) throw _sanitizeError(error);
    return data;
  },

  // ── BOM Items ──
  async saveBomItems(items) {
    const { data, error } = await supabase.from('bom_items').insert(items).select();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async updateBomItemsSortOrder(updates) {
    if (!updates.length) return;
    const results = await Promise.all(
      updates.map(u => supabase.from('bom_items').update({ sort_order: u.sort_order }).eq('id', u.id))
    );
    const err = results.find(r => r.error);
    if (err) throw _sanitizeError(err.error);
  },

  async getBomItems(processId, versionId = null) {
    let q = supabase.from('bom_items').select('*').eq('process_id', processId);
    if (versionId) q = q.eq('bom_version_id', versionId);
    q = q.order('sort_order');
    const { data, error } = await q;
    if (error) throw _sanitizeError(error);
    return data;
  },

  // ── Suppliers ──
  async getSuppliers(processId) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('process_id', processId)
      .order('created_at');
    if (error) throw _sanitizeError(error);
    return data;
  },

  async createSupplier(fields) {
    const { data, error } = await supabase.from('suppliers').insert(fields).select().single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async updateSupplier(id, fields) {
    const { data, error } = await supabase.from('suppliers').update(fields).eq('id', id).select().single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async deleteSupplier(id) {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  // ── Quotation Items ──
  async saveQuotationItems(items) {
    const rows = (items || []).map(_quotationItemRowForDb);
    const { data, error } = await supabase.from('quotation_items').insert(rows).select();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getQuotationItems(supplierId) {
    const { data, error } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('created_at');
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getQuotationItemsForSuppliers(supplierIds) {
    if (!supplierIds.length) return [];
    const { data, error } = await supabase
      .from('quotation_items')
      .select('*')
      .in('supplier_id', supplierIds)
      .order('created_at');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async deleteQuotationItems(supplierId) {
    const { error } = await supabase.from('quotation_items').delete().eq('supplier_id', supplierId);
    if (error) throw _sanitizeError(error);
  },

  async updateQuotationItems(items, idsToDelete) {
    // Delete only items explicitly removed
    if (idsToDelete.length > 0) {
      const { error } = await supabase.from('quotation_items').delete().in('id', idsToDelete);
      if (error) throw _sanitizeError(error);
    }
    // Update items that already exist in DB (have an id)
    const toUpsert = items.filter(i => i.id).map(_quotationItemRowForDb);
    if (toUpsert.length > 0) {
      const { error } = await supabase.from('quotation_items').upsert(toUpsert, { onConflict: 'id' });
      if (error) throw _sanitizeError(error);
    }
    // Insert truly new items (no id yet)
    const toInsert = items.filter(i => !i.id).map(({ id, ...rest }) => _quotationItemRowForDb(rest));
    if (toInsert.length > 0) {
      const { error } = await supabase.from('quotation_items').insert(toInsert);
      if (error) throw _sanitizeError(error);
    }
  },

  // ── Item Matches ──
  async getMatches(processId, bomItemIds) {
    if (bomItemIds && bomItemIds.length) {
      const BATCH = 80;
      const all = [];
      for (let i = 0; i < bomItemIds.length; i += BATCH) {
        const chunk = bomItemIds.slice(i, i + BATCH);
        const { data, error } = await supabase
          .from('item_matches')
          .select('*, bom_items!bom_item_id(*), quotation_items(*), suppliers(name)')
          .eq('process_id', processId)
          .in('bom_item_id', chunk);
        if (error) throw _sanitizeError(error);
        if (data) all.push(...data);
      }
      return all;
    }
    const { data, error } = await supabase
      .from('item_matches')
      .select('*, bom_items!bom_item_id(*), quotation_items(*), suppliers(name)')
      .eq('process_id', processId);
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async saveMatch(match) {
    const payload = { ...match, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('item_matches')
      .upsert(payload, { onConflict: 'bom_item_id,supplier_id' })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async saveMatches(matches) {
    if (!matches.length) return [];
    const now = new Date().toISOString();
    const payloads = matches.map(m => ({ ...m, updated_at: now }));
    const BATCH = 50;
    const allSaved = [];
    for (let i = 0; i < payloads.length; i += BATCH) {
      const chunk = payloads.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('item_matches')
        .upsert(chunk, { onConflict: 'bom_item_id,supplier_id' })
        .select();
      if (error) {
        console.error('[API] saveMatches batch failed:', error.message, 'batch', Math.floor(i/BATCH)+1);
        throw _sanitizeError(error);
      }
      if (data) allSaved.push(...data);
    }
    return allSaved;
  },

  async deleteMatch(id) {
    const { error } = await supabase.from('item_matches').delete().eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async getMatchExtraItems(matchIds) {
    if (!matchIds || !matchIds.length) return [];
    const BATCH = 80;
    const all = [];
    for (let i = 0; i < matchIds.length; i += BATCH) {
      const chunk = matchIds.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('match_extra_items')
        .select('id, item_match_id, quotation_item_id, quotation_items(price, currency, discount, raw_description, eta_value, eta_unit)')
        .in('item_match_id', chunk);
      if (error) throw _sanitizeError(error);
      if (data) all.push(...data);
    }
    return all;
  },

  async addMatchExtraItem(itemMatchId, quotationItemId) {
    const { data, error } = await supabase
      .from('match_extra_items')
      .insert({ item_match_id: itemMatchId, quotation_item_id: quotationItemId })
      .select('id, item_match_id, quotation_item_id, quotation_items(price, currency, discount, raw_description, eta_value, eta_unit)')
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async removeMatchExtraItem(extraItemId) {
    const { error } = await supabase.from('match_extra_items').delete().eq('id', extraItemId);
    if (error) throw _sanitizeError(error);
  },

  async getRejectedAutoMatch(processId) {
    const { data, error } = await supabase.from('rejected_automatch').select('*').eq('process_id', processId);
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async addRejectedAutoMatch(processId, bomItemId, supplierId, quotItemId) {
    const { error } = await supabase.from('rejected_automatch')
      .upsert({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotItemId },
               { onConflict: 'process_id,bom_item_id,supplier_id,quotation_item_id', ignoreDuplicates: true });
    if (error) throw _sanitizeError(error);
  },

  async removeRejectedAutoMatch(processId, bomItemId, supplierId) {
    // When user manually links a pair, clear all prior rejections for it
    const { error } = await supabase.from('rejected_automatch')
      .delete().eq('process_id', processId).eq('bom_item_id', bomItemId).eq('supplier_id', supplierId);
    if (error) throw _sanitizeError(error);
  },

  async copyItemMatches(oldBomItemId, newBomItemId, processId) {
    const { data: matches } = await supabase.from('item_matches').select('*').eq('bom_item_id', oldBomItemId);
    if (!matches?.length) return;
    const copies = matches.map(m => ({
      process_id: processId,
      bom_item_id: newBomItemId,
      supplier_id: m.supplier_id,
      quotation_item_id: m.quotation_item_id,
      match_type: m.match_type,
      confidence: m.confidence,
    }));
    const { error } = await supabase.from('item_matches').insert(copies);
    if (error) throw _sanitizeError(error);
  },

  // ── Audit Log ──
  async getAuditLog({ limit = 100, offset = 0, processSearch = '', userId = '', eventType = '', dateFrom = '', dateTo = '' } = {}) {
    const eventTypeMap = {
      process_changes:  ['processes'],
      supplier_changes: ['suppliers'],
      bom_changes:      ['bom_versions', 'bom_items'],
      offer_selections: ['selected_offers', 'item_matches'],
      profile_changes:  ['profiles'],
    };

    let q = supabase
      .from('audit_log')
      .select('id, user_id, action, table_name, record_id, old_data, new_data, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (eventType && eventTypeMap[eventType]) q = q.in('table_name', eventTypeMap[eventType]);
    if (userId) q = q.eq('user_id', userId);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (dateTo)   q = q.lte('created_at', dateTo);
    if (processSearch.trim()) {
      // Strip chars that could be used to inject additional Supabase filter predicates
      const t = processSearch.trim().replace(/[,()%]/g, '');
      if (t) q = q.or(`new_data->>project_name.ilike.%${t}%,new_data->>client_name.ilike.%${t}%,old_data->>project_name.ilike.%${t}%,old_data->>client_name.ilike.%${t}%`);
    }

    const { data, error } = await q;
    if (error) throw _sanitizeError(error);

    const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
    let profileMap = {};
    if (userIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, name, role').in('id', userIds);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }
    return (data || []).map(row => ({ ...row, actor: profileMap[row.user_id] || null }));
  },

  async getAuditUsers() {
    const { data, error } = await supabase.from('profiles').select('id, name, role').order('name');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  // ── User Management (admin only) ──
  async getUsers() {
    const { data, error } = await supabase.rpc('get_all_users');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async adminUpdateUserRole(targetId, role) {
    const { error } = await supabase.rpc('admin_set_user_role', { target_id: targetId, new_role: role });
    if (error) throw _sanitizeError(error);
  },

  async adminUpdateUserName(targetId, name) {
    const { error } = await supabase.rpc('admin_set_user_name', { target_id: targetId, new_name: name });
    if (error) throw _sanitizeError(error);
  },

  async adminUpdateUserAssignment(targetId, showInAssignment) {
    const { error } = await supabase.rpc('admin_set_user_assignment', { target_id: targetId, new_value: showInAssignment });
    if (error) throw _sanitizeError(error);
  },

  async getAssignableUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role')
      .in('role', ['procurement', 'admin'])
      .eq('show_in_assignment', true)
      .order('name');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async getTopSuppliers(limit = 5) {
    const { data, error } = await supabase.from('suppliers').select('name, process_id');
    if (error) throw _sanitizeError(error);
    const counts = {};
    (data || []).forEach(s => { counts[s.name] = (counts[s.name] || 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  },

  async copySelectedOffer(oldBomItemId, newBomItemId, processId) {
    const { data: offer } = await supabase.from('selected_offers')
      .select('*').eq('bom_item_id', oldBomItemId).eq('process_id', processId).maybeSingle();
    if (!offer) return;
    const { error } = await supabase.from('selected_offers').insert({
      process_id: processId,
      bom_item_id: newBomItemId,
      supplier_id: offer.supplier_id,
      quotation_item_id: offer.quotation_item_id,
      selected_by: offer.selected_by,
    });
    if (error) throw _sanitizeError(error);
  },

  // ── Selected Offers ──
  async getSelectedOffers(processId) {
    const { data, error } = await supabase
      .from('selected_offers')
      .select('*, suppliers(name), quotation_items(*)')
      .eq('process_id', processId);
    if (error) throw _sanitizeError(error);
    return data;
  },

  async selectOffer(processId, bomItemId, supplierId, quotationItemId) {
    const { data, error } = await supabase
      .from('selected_offers')
      .upsert({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotationItemId, selected_by: currentUser.id }, { onConflict: 'process_id,bom_item_id' })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async deleteSelectedOffer(processId, bomItemId) {
    const { error } = await supabase.from('selected_offers').delete().eq('process_id', processId).eq('bom_item_id', bomItemId);
    if (error) throw _sanitizeError(error);
  },

  // ── BOM Item service flag ──
  async updateBomItemService(id, isService) {
    const { error } = await supabase.from('bom_items').update({ is_service: isService }).eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async updateBomItemServicePrice(id, price) {
    const { error } = await supabase.from('bom_items').update({ service_price: price }).eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async updateBomItemServiceCost(id, qty, price) {
    const { error } = await supabase.from('bom_items').update({ quantity: qty, service_price: price }).eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async updateBomItemCustomDescription(id, text) {
    const { error } = await supabase.from('bom_items').update({ custom_description: text || null }).eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  // ── Installation Costs ──
  async getInstallation(processId) {
    const { data } = await supabase.from('installation_costs')
      .select('*')
      .eq('process_id', processId)
      .order('sort_order');
    return data ?? [];
  },

  async saveInstallation(processId, records) {
    // records = [{ sheet_name, sort_order, senior_count, ... }]
    await supabase.from('installation_costs').delete().eq('process_id', processId);
    if (!records.length) return [];
    const { data, error } = await supabase.from('installation_costs')
      .insert(records.map(r => ({ process_id: processId, updated_at: new Date().toISOString(), ...r })))
      .select();
    if (error) throw _sanitizeError(error);
    return data ?? [];
  },

  // ── File upload ──
  async uploadFile(bucket, path, file) {
    if (path.includes('..')) throw new Error('Caminho inválido.');
    // Verify file magic bytes — reject anything that isn't Excel (ZIP) or PDF
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isZip = header[0] === 0x50 && header[1] === 0x4B; // PK\x03\x04 — XLSX/ZIP
    const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46; // %PDF
    if (!isZip && !isPdf) throw new Error('Tipo de ficheiro inválido. Usa .xlsx, .xls ou .pdf.');
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getSignedUrl(bucket, path, expiresIn = 3600) {
    if (path.includes('..')) throw new Error('Caminho inválido.');
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw _sanitizeError(error);
    return data.signedUrl;
  },

  async saveQuotationFile(supplierId, filePath, originalName) {
    const { error } = await supabase.from('quotation_files')
      .insert({ supplier_id: supplierId, file_path: filePath, original_name: originalName });
    if (error) throw _sanitizeError(error);
  },

  async getQuotationFiles(supplierIds) {
    if (!supplierIds.length) return [];
    const { data } = await supabase.from('quotation_files')
      .select('*')
      .in('supplier_id', supplierIds)
      .order('uploaded_at', { ascending: false });
    return data || [];
  },

  // ── Clone Process ──
  async cloneProcess(sourceId, fields, { copyBom = true, copySuppliers = true, copyQuotations = true } = {}) {
    // 1. Fetch source data in parallel
    const [bomVersions, sourceSuppliers] = await Promise.all([
      copyBom       ? API.getBomVersions(sourceId) : Promise.resolve([]),
      copySuppliers ? API.getSuppliers(sourceId)   : Promise.resolve([]),
    ]);
    const latestVersion = bomVersions[0] || null;
    const sourceBomItems = (copyBom && latestVersion)
      ? await API.getBomItems(sourceId, latestVersion.id)
      : [];

    let sourceQuotItems = [], sourceMatches = [], sourceOffers = [];
    if (copySuppliers && copyQuotations && sourceSuppliers.length) {
      const supIds = sourceSuppliers.map(s => s.id);
      [sourceQuotItems, sourceMatches, sourceOffers] = await Promise.all([
        API.getQuotationItemsForSuppliers(supIds),
        API.getMatches(sourceId),
        API.getSelectedOffers(sourceId),
      ]);
    }

    // 2. Create new process
    const newProc = await API.createProcess(fields);
    const newId = newProc.id;

    // 3. Clone BOM → build bomItemMap (oldId → newId)
    const bomItemMap = {};
    if (copyBom && latestVersion && sourceBomItems.length) {
      const newVer = await API.createBomVersion(newId, latestVersion.original_name, latestVersion.file_path, 1);
      const newItems = sourceBomItems.map(bi => ({
        process_id:     newId,
        bom_version_id: newVer.id,
        part_number:    bi.part_number,
        description:    bi.description,
        quantity:       bi.quantity,
        unit:           bi.unit,
        category:       bi.category,
        sort_order:     bi.sort_order,
      }));
      const savedItems = await API.saveBomItems(newItems);
      savedItems.forEach((ni, idx) => { bomItemMap[sourceBomItems[idx].id] = ni.id; });
    }

    // 4. Clone suppliers → build supplierMap + quotItemMap
    const supplierMap = {};
    const quotItemMap = {};
    if (copySuppliers && sourceSuppliers.length) {
      for (const s of sourceSuppliers) {
        const newS = await API.createSupplier({
          process_id: newId,
          name:       s.name,
          email:      s.email,
          status:     'Not contacted',
          notes:      s.notes,
          is_foreign: s.is_foreign,
          cambio:     s.cambio,
          transport:  s.transport,
          direitos:   s.direitos,
        });
        supplierMap[s.id] = newS.id;

        if (copyQuotations) {
          const items = sourceQuotItems.filter(qi => qi.supplier_id === s.id);
          if (items.length) {
            const newQItems = items.map(qi => ({
              supplier_id:      newS.id,
              raw_part_number:  qi.raw_part_number,
              raw_description:  qi.raw_description,
              quantity:         qi.quantity,
              price:            qi.price,
              currency:         qi.currency,
              discount:         qi.discount,
              eta_value:        qi.eta_value,
              eta_unit:         qi.eta_unit,
            }));
            const savedQ = await API.saveQuotationItems(newQItems);
            savedQ.forEach((nq, idx) => { quotItemMap[items[idx].id] = nq.id; });
          }
        }
      }

      // 5. Rebuild item_matches with new IDs
      if (copyBom && copyQuotations && sourceMatches.length) {
        const newMatches = sourceMatches
          .filter(m => bomItemMap[m.bom_item_id] && supplierMap[m.supplier_id] && quotItemMap[m.quotation_item_id])
          .map(m => ({
            process_id:        newId,
            bom_item_id:       bomItemMap[m.bom_item_id],
            supplier_id:       supplierMap[m.supplier_id],
            quotation_item_id: quotItemMap[m.quotation_item_id],
            match_type:        m.match_type,
            confidence:        m.confidence,
          }));
        if (newMatches.length) {
          const { error } = await supabase.from('item_matches').insert(newMatches);
          if (error) throw _sanitizeError(error);
        }
      }

      // 6. Rebuild selected_offers with new IDs
      if (copyBom && copyQuotations && sourceOffers.length) {
        const newOffers = sourceOffers
          .filter(o => bomItemMap[o.bom_item_id] && supplierMap[o.supplier_id] && quotItemMap[o.quotation_item_id])
          .map(o => ({
            process_id:        newId,
            bom_item_id:       bomItemMap[o.bom_item_id],
            supplier_id:       supplierMap[o.supplier_id],
            quotation_item_id: quotItemMap[o.quotation_item_id],
            selected_by:       currentUser.id,
          }));
        if (newOffers.length) {
          const { error } = await supabase.from('selected_offers').insert(newOffers);
          if (error) throw _sanitizeError(error);
        }
      }
    }

    return newProc;
  },

  // ── Known Suppliers (for auto-fill) ──
  async getKnownSuppliers() {
    const { data, error } = await supabase
      .from('global_suppliers')
      .select('name, email, email_cc, avg_response_hours, response_count')
      .order('name');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  // ── Global Suppliers Directory ──
  async getGlobalSuppliers() {
    const { data, error } = await supabase
      .from('global_suppliers')
      .select('*')
      .order('name');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async createGlobalSupplier(fields) {
    const { data, error } = await supabase.from('global_suppliers').insert(fields).select().single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async updateGlobalSupplier(id, fields) {
    const { error } = await supabase.from('global_suppliers').update(fields).eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async updateSupplierFinance(id, eta_condition, account_status, has_credit) {
    const { error } = await supabase.from('global_suppliers')
      .update({ eta_condition, account_status, has_credit })
      .eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async deleteGlobalSupplier(id) {
    const { error } = await supabase.from('global_suppliers').delete().eq('id', id);
    if (error) throw _sanitizeError(error);
  },

  async recordSupplierResponse(name, hours) {
    const { error } = await supabase.rpc('record_supplier_response', {
      p_name: name,
      p_hours: hours,
    });
    if (error) throw _sanitizeError(error);
  },

  async getDurationEstimates(categories) {
    if (!categories || !categories.length) return null;
    const { data, error } = await supabase.rpc('get_duration_estimates', { p_categories: categories });
    if (error) throw _sanitizeError(error);
    return data?.[0] || null;
  },

  async upsertGlobalSupplier(name, email, emailCc, categories, brands) {
    const { error } = await supabase.rpc('upsert_global_supplier', {
      p_name: name,
      p_email: email || '',
      p_email_cc: emailCc || '',
      p_categories: categories || [],
      p_brands: brands || [],
    });
    if (error) throw _sanitizeError(error);
  },

  // ── Price Anomaly Detection ──
  async getPriceHistoryBatch(partNumbers, descriptions) {
    const filters = [];
    partNumbers.filter(Boolean).forEach(p => filters.push('raw_part_number.ilike.' + p.trim().toLowerCase()));
    descriptions.forEach(d => {
      const key = d.trim().slice(0, 40).replace(/[%_]/g, '');
      if (key) filters.push('raw_description.ilike.%' + key + '%');
    });
    if (!filters.length) return [];
    const { data, error } = await supabase
      .from('quotation_items')
      .select('raw_part_number, raw_description, price, currency')
      .or(filters.join(','))
      .limit(500);
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  // ── Supplier Detail ──
  async getSupplierProcessHistory(name) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, status, created_at, contacted_at, replied_at, is_foreign, cambio, transport, direitos, process_id, processes!inner(id, project_name, client_name, status, created_at)')
      .ilike('name', name.trim())
      .order('created_at', { ascending: false });
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async getSupplierQuotationHistory(supplierIds) {
    if (!supplierIds.length) return [];
    const { data, error } = await supabase
      .from('quotation_items')
      .select('id, raw_description, raw_part_number, price, currency, created_at, supplier_id, item_matches(bom_items!bom_item_id(category, description, custom_description)), suppliers!inner(name, process_id, processes!inner(id, project_name, client_name))')
      .in('supplier_id', supplierIds)
      .order('created_at', { ascending: false });
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async getBomCategoriesByProcessIds(processIds) {
    if (!processIds.length) return {};
    const { data, error } = await supabase
      .from('bom_items')
      .select('process_id, category')
      .in('process_id', processIds)
      .not('category', 'is', null);
    if (error) throw _sanitizeError(error);
    const map = {};
    (data || []).forEach(r => {
      if (!map[r.process_id]) map[r.process_id] = new Set();
      map[r.process_id].add(r.category);
    });
    return map;
  },

  // ── Price History ──
  async searchPriceHistory(query, dateFrom) {
    let q = supabase
      .from('quotation_items')
      .select('raw_description, raw_part_number, price, currency, quantity, created_at, suppliers(name, cambio, processes(id, project_name, client_name)), item_matches(bom_items!bom_item_id(description, part_number, custom_description))')
      .order('created_at', { ascending: false });
    if (dateFrom) q = q.gte('created_at', dateFrom);
    q = q.limit(1000);
    const { data, error } = await q;
    if (error) throw _sanitizeError(error);
    const rows = data || [];
    if (!query || !query.trim()) return rows;
    const queryStr = query.trim();
    const qToks = queryStr.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
    if (!qToks.length) return rows;
    const matchesField = field => {
      const fToks = (field||'').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
      if (!fToks.length) return false;
      return qToks.every(qt => fToks.some(ft => {
        const d = _levenshtein(qt, ft);
        return 1 - d / Math.max(qt.length, ft.length) >= 0.7;
      }));
    };
    return rows.filter(item => {
      const bom = item.item_matches?.[0]?.bom_items;
      const bomDesc = (bom?.custom_description || bom?.description || '');
      const bomPart = (bom?.part_number || '');
      return [item.raw_description, item.raw_part_number, bomDesc, bomPart].some(matchesField);
    });
  },

  // ── Notifications ──
  async getMyNotifications() {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getAllSupplierStats() {
    const { data, error } = await supabase
      .from('suppliers')
      .select('name, process_id, contacted_at, replied_at');
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async markNotificationsRead() {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('read', false);
    if (error) throw _sanitizeError(error);
  },

  async createNotification(userId, title, body, processId) {
    const { error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title, body, process_id: processId });
    if (error) throw _sanitizeError(error);
  },

  // ── Pending Margin Alerts ──
  async getPendingMarginAlerts() {
    const _d = new Date(); _d.setHours(0, 0, 0, 0);
    const cutoff = _d.toISOString();
    const { data, error } = await supabase
      .from('processes')
      .select('id, project_name, client_name, last_margin_followup_at')
      .eq('status', 'Pending margin')
      .or(`last_margin_followup_at.is.null,last_margin_followup_at.lt.${cutoff}`)
      .order('last_margin_followup_at', { ascending: true, nullsFirst: true });
    if (error) throw _sanitizeError(error);
    return data || [];
  },

  async markMarginFollowup(processId) {
    const { error } = await supabase
      .from('processes')
      .update({ last_margin_followup_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', processId);
    if (error) throw _sanitizeError(error);
  },

  // ── Follow-up Alerts ──
  async getOverdueFollowups() {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, next_followup_at, status, processes(id, project_name, client_name, assigned_to)')
      .lte('next_followup_at', today)
      .not('next_followup_at', 'is', null)
      .not('status', 'in', '("Replied complete","No stock","Not available","Ignored / no response")')
      .order('next_followup_at', { ascending: true });
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getHistoricalCategorySuppliers() {
    const { data, error } = await supabase
      .from('item_matches')
      .select('suppliers(name), bom_items!bom_item_id(category)')
      .not('supplier_id', 'is', null)
      .not('bom_item_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(2000);
    if (error) throw _sanitizeError(error);
    return (data || [])
      .map(m => ({ category: m.bom_items?.category, supplier_name: m.suppliers?.name }))
      .filter(r => r.category && r.supplier_name);
  },

  async getHistoricalMatchPairs() {
    const { data, error } = await supabase
      .from('item_matches')
      .select('suppliers(name), bom_items!bom_item_id(description, custom_description), quotation_items!quotation_item_id(raw_description)')
      .not('supplier_id', 'is', null)
      .not('bom_item_id', 'is', null)
      .not('quotation_item_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3000);
    if (error) throw _sanitizeError(error);
    return (data || [])
      .map(m => ({
        supplier_name: m.suppliers?.name,
        bom_desc: m.bom_items?.custom_description || m.bom_items?.description,
        quot_desc: m.quotation_items?.raw_description,
      }))
      .filter(r => r.supplier_name && r.bom_desc && r.quot_desc);
  },

  async createHistoricalMatch(processId, biId, supplierId, rawDesc, finalPrice, currency = 'MZN') {
    const { data: qi, error: e1 } = await supabase
      .from('quotation_items')
      .insert({ supplier_id: supplierId, raw_description: String(rawDesc).slice(0, 500), price: finalPrice, quantity: 1, currency: currency || 'MZN' })
      .select()
      .single();
    if (e1) throw _sanitizeError(e1);
    const { data: im, error: e2 } = await supabase
      .from('item_matches')
      .upsert({ process_id: processId, bom_item_id: biId, supplier_id: supplierId, quotation_item_id: qi.id, match_type: 'historical', updated_at: new Date().toISOString() }, { onConflict: 'bom_item_id,supplier_id' })
      .select()
      .single();
    if (e2) throw _sanitizeError(e2);
    return { quotation_item: qi, item_match: im };
  },

  async getHistoricalSkuPairs() {
    const { data, error } = await supabase
      .from('item_matches')
      .select('suppliers(name), quotation_items!quotation_item_id!inner(raw_sku), bom_items!bom_item_id(description, custom_description)')
      .not('quotation_item_id', 'is', null)
      .not('supplier_id', 'is', null)
      .not('bom_item_id', 'is', null)
      .not('quotation_items.raw_sku', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(3000);
    if (error) throw _sanitizeError(error);
    return (data || [])
      .filter(m => m.quotation_items?.raw_sku)
      .map(m => ({
        supplier_name: m.suppliers?.name,
        raw_sku: m.quotation_items.raw_sku,
        bom_desc: m.bom_items?.custom_description || m.bom_items?.description,
      }))
      .filter(r => r.supplier_name && r.raw_sku && r.bom_desc);
  },

  async updateGlobalSupplierRefType(name, refType) {
    const { error } = await supabase
      .from('global_suppliers')
      .update({ last_ref_type: refType, last_ref_type_at: new Date().toISOString() })
      .ilike('name', name.trim());
    if (error) throw _sanitizeError(error);
  },
};
