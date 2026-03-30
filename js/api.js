// ── API — all Supabase calls in one place ──

// Processes
const API = {

  // ── Processes ──
  async getProcesses() {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getProcess(id) {
    const { data, error } = await supabase
      .from('processes')
      .select('*, creator:profiles!created_by(name), assignee:profiles!assigned_to(name, id)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getProcurementUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role')
      .in('role', ['procurement', 'admin'])
      .order('name');
    if (error) throw error;
    return data || [];
  },

  async createProcess(fields) {
    const { data, error } = await supabase
      .from('processes')
      .insert({ ...fields, created_by: currentUser.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateProcess(id, fields) {
    const { data, error } = await supabase
      .from('processes')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteProcess(id) {
    const { error } = await supabase.from('processes').delete().eq('id', id);
    if (error) throw error;
  },

  // ── BOM Versions ──
  async createBomVersion(processId, originalName, filePath, versionNumber) {
    const { data, error } = await supabase
      .from('bom_versions')
      .insert({ process_id: processId, original_name: originalName, file_path: filePath, version_number: versionNumber, uploaded_by: currentUser.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getBomVersions(processId) {
    const { data, error } = await supabase
      .from('bom_versions')
      .select('*')
      .eq('process_id', processId)
      .order('version_number', { ascending: false });
    if (error) throw error;
    return data;
  },

  // ── BOM Items ──
  async saveBomItems(items) {
    const { data, error } = await supabase.from('bom_items').insert(items).select();
    if (error) throw error;
    return data;
  },

  async getBomItems(processId, versionId = null) {
    let q = supabase.from('bom_items').select('*').eq('process_id', processId);
    if (versionId) q = q.eq('bom_version_id', versionId);
    q = q.order('sort_order');
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  // ── Suppliers ──
  async getSuppliers(processId) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('process_id', processId)
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async createSupplier(fields) {
    const { data, error } = await supabase.from('suppliers').insert(fields).select().single();
    if (error) throw error;
    return data;
  },

  async updateSupplier(id, fields) {
    const { data, error } = await supabase.from('suppliers').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async deleteSupplier(id) {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },

  // ── Quotation Items ──
  async saveQuotationItems(items) {
    const { data, error } = await supabase.from('quotation_items').insert(items).select();
    if (error) throw error;
    return data;
  },

  async getQuotationItems(supplierId) {
    const { data, error } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('created_at');
    if (error) throw error;
    return data;
  },

  async deleteQuotationItems(supplierId) {
    const { error } = await supabase.from('quotation_items').delete().eq('supplier_id', supplierId);
    if (error) throw error;
  },

  // ── Item Matches ──
  async getMatches(processId) {
    const { data, error } = await supabase
      .from('item_matches')
      .select('*, bom_items(*), quotation_items(*), suppliers(name)')
      .eq('process_id', processId);
    if (error) throw error;
    return data;
  },

  async saveMatch(match) {
    const { data, error } = await supabase
      .from('item_matches')
      .upsert(match, { onConflict: 'bom_item_id,supplier_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteMatch(id) {
    const { error } = await supabase.from('item_matches').delete().eq('id', id);
    if (error) throw error;
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
    if (error) throw error;
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
    if (error) throw error;
  },

  // ── Selected Offers ──
  async getSelectedOffers(processId) {
    const { data, error } = await supabase
      .from('selected_offers')
      .select('*, suppliers(name), quotation_items(*)')
      .eq('process_id', processId);
    if (error) throw error;
    return data;
  },

  async selectOffer(processId, bomItemId, supplierId, quotationItemId) {
    const { data, error } = await supabase
      .from('selected_offers')
      .upsert({ process_id: processId, bom_item_id: bomItemId, supplier_id: supplierId, quotation_item_id: quotationItemId, selected_by: currentUser.id }, { onConflict: 'process_id,bom_item_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteSelectedOffer(processId, bomItemId) {
    const { error } = await supabase.from('selected_offers').delete().eq('process_id', processId).eq('bom_item_id', bomItemId);
    if (error) throw error;
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
    if (error) throw error;
    return data;
  },

  // ── File upload ──
  async uploadFile(bucket, path, file) {
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    if (error) throw error;
    return data;
  },
};
