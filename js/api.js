// ── API — all Supabase calls in one place ──

function _sanitizeError(error) {
  if (!error) return new Error('Unknown error');
  const msg = error.message || String(error);
  const blocked = ['relation', 'column', 'constraint', 'pg_', 'auth.', 'storage.', 'schema'];
  if (blocked.some(k => msg.toLowerCase().includes(k))) {
    console.error('[API]', msg);
    return new Error('Operação não permitida.');
  }
  return error;
}

const API = {

  // ── Processes ──
  async getProcesses() {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id)')
      .order('created_at', { ascending: false });
    if (error) throw _sanitizeError(error);
    return data;
  },

  async getProcess(id) {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id)')
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
    const { data, error } = await supabase.from('quotation_items').insert(items).select();
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
    const toUpsert = items.filter(i => i.id);
    if (toUpsert.length > 0) {
      const { error } = await supabase.from('quotation_items').upsert(toUpsert, { onConflict: 'id' });
      if (error) throw _sanitizeError(error);
    }
    // Insert truly new items (no id yet)
    const toInsert = items.filter(i => !i.id).map(({ id, ...rest }) => rest);
    if (toInsert.length > 0) {
      const { error } = await supabase.from('quotation_items').insert(toInsert);
      if (error) throw _sanitizeError(error);
    }
  },

  // ── Item Matches ──
  async getMatches(processId) {
    const { data, error } = await supabase
      .from('item_matches')
      .select('*, bom_items(*), quotation_items(*), suppliers(name)')
      .eq('process_id', processId);
    if (error) throw _sanitizeError(error);
    return data;
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
              supplier_id: newS.id,
              part_number: qi.part_number,
              price:       qi.price,
              currency:    qi.currency,
              unit:        qi.unit,
              notes:       qi.notes,
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
      .select('id, raw_description, raw_part_number, price, currency, created_at, supplier_id, item_matches(bom_items(category)), suppliers!inner(name, process_id, processes!inner(id, project_name, client_name))')
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
      .select('raw_description, raw_part_number, price, currency, quantity, created_at, suppliers(name, processes(id, project_name, client_name))')
      .order('created_at', { ascending: false });
    if (dateFrom) q = q.gte('created_at', dateFrom);
    // Server-side filter on first word to cut down rows before transfer
    if (query && query.trim()) {
      const first = query.trim().split(/\s+/)[0].replace(/[%_]/g, '');
      if (first) q = q.ilike('raw_description', `%${first}%`);
    }
    q = q.limit(1000);
    const { data, error } = await q;
    if (error) throw _sanitizeError(error);
    const rows = data || [];
    if (!query || !query.trim()) return rows;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(1);
    if (!words.length) return rows;
    return rows.filter(item => {
      const hay = ((item.raw_description || '') + ' ' + (item.raw_part_number || '')).toLowerCase();
      return words.every(w => hay.includes(w));
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

  // ── Follow-up Alerts ──
  async getOverdueFollowups() {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('suppliers')
      .select('id, name, next_followup_at, status, processes(id, project_name, client_name)')
      .lte('next_followup_at', today)
      .not('next_followup_at', 'is', null)
      .not('status', 'in', '("Replied complete","No stock","Not available","Ignored / no response")')
      .order('next_followup_at', { ascending: true });
    if (error) throw _sanitizeError(error);
    return data;
  },
};
