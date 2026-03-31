-- ============================================================
-- FIX: Allow commercials to upload BOM and edit BOM items
-- Run this in Supabase SQL Editor AFTER security-hardening.sql
-- ============================================================

-- ============================================================
-- 1. bom_items: allow update/delete for the commercial who
--    created the process (not just procurement/admin)
-- ============================================================
DROP POLICY IF EXISTS "bom_items_update" ON bom_items;
CREATE POLICY "bom_items_update"
  ON bom_items FOR UPDATE
  USING (
    get_my_role() IN ('procurement', 'admin')
    OR EXISTS (
      SELECT 1 FROM processes
      WHERE processes.id = bom_items.process_id
      AND processes.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "bom_items_delete" ON bom_items;
CREATE POLICY "bom_items_delete"
  ON bom_items FOR DELETE
  USING (
    get_my_role() IN ('procurement', 'admin')
    OR EXISTS (
      SELECT 1 FROM processes
      WHERE processes.id = bom_items.process_id
      AND processes.created_by = auth.uid()
    )
  );

-- ============================================================
-- 2. Storage: allow commercials to upload to bom/ path
--    but keep quotations/ restricted to procurement/admin
-- ============================================================
DROP POLICY IF EXISTS "storage_insert" ON storage.objects;
CREATE POLICY "storage_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'procurement-files'
    AND auth.role() = 'authenticated'
    AND name NOT LIKE '%..%'
    AND (
      (name LIKE 'bom/%')
      OR (name LIKE 'quotations/%' AND get_my_role() IN ('procurement', 'admin'))
    )
  );
