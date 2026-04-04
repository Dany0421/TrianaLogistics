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
    const { data, error } = await supabase
      .from('item_matches')
      .upsert(match, { onConflict: 'bom_item_id,supplier_id' })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  async deleteMatch(id) {
    const { error } = await supabase.from('item_matches').delete().eq('id', id);
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
      const t = processSearch.trim();
      q = q.or(`new_data->>project_name.ilike.%${t}%,new_data->>client_name.ilike.%${t}%,old_data->>project_name.ilike.%${t}%,old_data->>client_name.ilike.%${t}%`);
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

  // ── Installation Costs ──
  async getInstallation(processId) {
    const { data } = await supabase.from('installation_costs').select('*').eq('process_id', processId).single();
    return data;
  },

  async saveInstallation(processId, fields) {
    const { data, error } = await supabase
      .from('installation_costs')
      .upsert({ process_id: processId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'process_id' })
      .select()
      .single();
    if (error) throw _sanitizeError(error);
    return data;
  },

  // ── File upload ──
  async uploadFile(bucket, path, file) {
    if (path.includes('..')) throw new Error('Caminho inválido.');
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
              description: qi.description,
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
      .from('suppliers')
      .select('name, email, email_cc')
      .not('email', 'is', null)
      .order('created_at', { ascending: false });
    if (error) throw _sanitizeError(error);
    const map = {};
    for (const s of (data || [])) {
      if (!map[s.name]) map[s.name] = s;
    }
    return Object.values(map);
  },

  // ── Price History ──
  async searchPriceHistory(query, dateFrom) {
    let q = supabase
      .from('quotation_items')
      .select('raw_description, raw_part_number, price, currency, quantity, created_at, suppliers(name, processes(id, project_name, client_name))')
      .order('created_at', { ascending: false })
      .limit(200);
    if (query && query.trim()) q = q.or(`raw_description.ilike.%${query.trim()}%,raw_part_number.ilike.%${query.trim()}%`);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    const { data, error } = await q;
    if (error) throw _sanitizeError(error);
    return data;
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
