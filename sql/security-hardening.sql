-- ============================================================
-- PROCUREMENT SYSTEM — Security Hardening Migration
-- Run AFTER schema.sql and security.sql
-- ============================================================

-- ============================================================
-- 1. Fix processes table: add missing assigned_to column + status CHECK
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'processes' AND column_name = 'assigned_to'
  ) THEN
    ALTER TABLE processes ADD COLUMN assigned_to uuid REFERENCES profiles(id);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE processes DROP CONSTRAINT IF EXISTS chk_process_status;
  ALTER TABLE processes ADD CONSTRAINT chk_process_status
    CHECK (status IN ('Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Closed','Cancelled'));
END $$;

-- ============================================================
-- 2. Fix handle_new_user: NEVER trust client-supplied role
--    Only creates profile for @triana.co.mz emails.
--    Uses public.profiles (trigger runs in auth schema context).
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  IF new.email LIKE '%@triana.co.mz' THEN
    INSERT INTO public.profiles (id, name, role)
    VALUES (
      new.id,
      COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      'commercial'
    );
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. RLS: allow profile INSERT during signup (auth.uid() is NULL)
-- ============================================================
DROP POLICY IF EXISTS "profiles_insert_on_signup" ON profiles;
CREATE POLICY "profiles_insert_on_signup"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- 4. Prevent users from changing their own role via profile update
--    Allows SQL Editor (auth.uid() IS NULL) to change roles.
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_role_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    IF auth.uid() IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
      ) THEN
        RAISE EXCEPTION 'Only admins can change user roles.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_role_change_trigger ON profiles;
CREATE TRIGGER prevent_role_change_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_role_change();

-- ============================================================
-- 5. CHECK constraints — input length limits
-- ============================================================
DO $$ BEGIN
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_name_length;
  ALTER TABLE profiles ADD CONSTRAINT chk_name_length CHECK (char_length(name) <= 100);

  ALTER TABLE processes DROP CONSTRAINT IF EXISTS chk_client_name_length;
  ALTER TABLE processes ADD CONSTRAINT chk_client_name_length CHECK (char_length(client_name) <= 200);
  ALTER TABLE processes DROP CONSTRAINT IF EXISTS chk_project_name_length;
  ALTER TABLE processes ADD CONSTRAINT chk_project_name_length CHECK (char_length(project_name) <= 200);
  ALTER TABLE processes DROP CONSTRAINT IF EXISTS chk_notes_length;
  ALTER TABLE processes ADD CONSTRAINT chk_notes_length CHECK (char_length(notes) <= 5000);

  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_supplier_name_length;
  ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_name_length CHECK (char_length(name) <= 200);
  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_supplier_email_length;
  ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_email_length CHECK (char_length(email) <= 254);
  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_supplier_notes_length;
  ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_notes_length CHECK (char_length(notes) <= 5000);
  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_cambio_range;
  ALTER TABLE suppliers ADD CONSTRAINT chk_cambio_range CHECK (cambio IS NULL OR (cambio > 0 AND cambio < 100000));
  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_transport_range;
  ALTER TABLE suppliers ADD CONSTRAINT chk_transport_range CHECK (transport IS NULL OR (transport >= 0 AND transport < 100000000));
  ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_direitos_range;
  ALTER TABLE suppliers ADD CONSTRAINT chk_direitos_range CHECK (direitos >= 0 AND direitos <= 100);

  ALTER TABLE bom_items DROP CONSTRAINT IF EXISTS chk_bom_description_length;
  ALTER TABLE bom_items ADD CONSTRAINT chk_bom_description_length CHECK (char_length(description) <= 500);
  ALTER TABLE bom_items DROP CONSTRAINT IF EXISTS chk_bom_part_number_length;
  ALTER TABLE bom_items ADD CONSTRAINT chk_bom_part_number_length CHECK (part_number IS NULL OR char_length(part_number) <= 100);
  ALTER TABLE bom_items DROP CONSTRAINT IF EXISTS chk_bom_quantity_range;
  ALTER TABLE bom_items ADD CONSTRAINT chk_bom_quantity_range CHECK (quantity > 0 AND quantity < 1000000);

  ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS chk_quot_description_length;
  ALTER TABLE quotation_items ADD CONSTRAINT chk_quot_description_length CHECK (char_length(raw_description) <= 500);
  ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS chk_quot_price_range;
  ALTER TABLE quotation_items ADD CONSTRAINT chk_quot_price_range CHECK (price >= 0 AND price < 1000000000);
  ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS chk_quot_currency;
  ALTER TABLE quotation_items ADD CONSTRAINT chk_quot_currency CHECK (currency IN ('MZN', 'USD', 'EUR', 'ZAR'));

  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_senior_count;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_senior_count CHECK (senior_count >= 0 AND senior_count <= 100);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_senior_rate;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_senior_rate CHECK (senior_rate >= 0 AND senior_rate < 1000000);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_senior_hours;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_senior_hours CHECK (senior_hours >= 0 AND senior_hours < 10000);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_intermediate_count;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_intermediate_count CHECK (intermediate_count >= 0 AND intermediate_count <= 100);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_intermediate_rate;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_intermediate_rate CHECK (intermediate_rate >= 0 AND intermediate_rate < 1000000);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_intermediate_hours;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_intermediate_hours CHECK (intermediate_hours >= 0 AND intermediate_hours < 10000);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_junior_count;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_junior_count CHECK (junior_count >= 0 AND junior_count <= 100);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_junior_rate;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_junior_rate CHECK (junior_rate >= 0 AND junior_rate < 1000000);
  ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS chk_install_junior_hours;
  ALTER TABLE installation_costs ADD CONSTRAINT chk_install_junior_hours CHECK (junior_hours >= 0 AND junior_hours < 10000);
END $$;

-- ============================================================
-- 6. Tighten RLS: bom_items update/delete for procurement/admin
--    or the commercial who created the process
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
-- 7. Storage: commercials can upload to bom/,
--    quotations/ restricted to procurement/admin
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

-- ============================================================
-- 8. Limit BOM items per process (prevent abuse)
-- ============================================================
CREATE OR REPLACE FUNCTION check_bom_items_limit()
RETURNS trigger AS $$
DECLARE
  item_count integer;
BEGIN
  SELECT count(*) INTO item_count
  FROM bom_items
  WHERE process_id = NEW.process_id AND bom_version_id = NEW.bom_version_id;
  IF item_count >= 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 BOM items per version.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_bom_items_limit_trigger ON bom_items;
CREATE TRIGGER check_bom_items_limit_trigger
  BEFORE INSERT ON bom_items
  FOR EACH ROW EXECUTE FUNCTION check_bom_items_limit();

-- ============================================================
-- 9. Limit suppliers per process
-- ============================================================
CREATE OR REPLACE FUNCTION check_suppliers_limit()
RETURNS trigger AS $$
DECLARE
  supp_count integer;
BEGIN
  SELECT count(*) INTO supp_count
  FROM suppliers WHERE process_id = NEW.process_id;
  IF supp_count >= 50 THEN
    RAISE EXCEPTION 'Maximum 50 suppliers per process.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_suppliers_limit_trigger ON suppliers;
CREATE TRIGGER check_suppliers_limit_trigger
  BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION check_suppliers_limit();

-- ============================================================
-- 10. Limit quotation items per supplier
-- ============================================================
CREATE OR REPLACE FUNCTION check_quotation_items_limit()
RETURNS trigger AS $$
DECLARE
  qi_count integer;
BEGIN
  SELECT count(*) INTO qi_count
  FROM quotation_items WHERE supplier_id = NEW.supplier_id;
  IF qi_count >= 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 quotation items per supplier.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_quotation_items_limit_trigger ON quotation_items;
CREATE TRIGGER check_quotation_items_limit_trigger
  BEFORE INSERT ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION check_quotation_items_limit();

-- ============================================================
-- 11. Audit log table
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_select"
  ON audit_log FOR SELECT
  USING (get_my_role() = 'admin');

-- ============================================================
-- 12. Audit trigger function (uses public.audit_log explicitly)
-- ============================================================
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_id, action, table_name, record_id, new_data)
    VALUES (auth.uid(), 'INSERT', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (user_id, action, table_name, record_id, old_data)
    VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_processes ON processes;
CREATE TRIGGER audit_processes
  AFTER INSERT OR UPDATE OR DELETE ON processes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_suppliers ON suppliers;
CREATE TRIGGER audit_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_selected_offers ON selected_offers;
CREATE TRIGGER audit_selected_offers
  AFTER INSERT OR UPDATE OR DELETE ON selected_offers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

DROP TRIGGER IF EXISTS audit_profiles ON profiles;
CREATE TRIGGER audit_profiles
  AFTER UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ============================================================
-- 13. Limit BOM versions per process
-- ============================================================
CREATE OR REPLACE FUNCTION check_bom_versions_limit()
RETURNS trigger AS $$
DECLARE
  ver_count integer;
BEGIN
  SELECT count(*) INTO ver_count
  FROM bom_versions WHERE process_id = NEW.process_id;
  IF ver_count >= 50 THEN
    RAISE EXCEPTION 'Maximum 50 BOM versions per process.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_bom_versions_limit_trigger ON bom_versions;
CREATE TRIGGER check_bom_versions_limit_trigger
  BEFORE INSERT ON bom_versions
  FOR EACH ROW EXECUTE FUNCTION check_bom_versions_limit();

-- ============================================================
-- 14. Limit processes per user
-- ============================================================
CREATE OR REPLACE FUNCTION check_processes_limit()
RETURNS trigger AS $$
DECLARE
  proc_count integer;
BEGIN
  SELECT count(*) INTO proc_count
  FROM processes WHERE created_by = auth.uid();
  IF proc_count >= 500 THEN
    RAISE EXCEPTION 'Maximum 500 processes per user.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_processes_limit_trigger ON processes;
CREATE TRIGGER check_processes_limit_trigger
  BEFORE INSERT ON processes
  FOR EACH ROW EXECUTE FUNCTION check_processes_limit();

-- ============================================================
-- 15. Prevent deletion of processes that have selected_offers
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_process_delete_with_offers()
RETURNS trigger AS $$
DECLARE
  offer_count integer;
BEGIN
  SELECT count(*) INTO offer_count
  FROM selected_offers WHERE process_id = OLD.id;
  IF offer_count > 0 AND get_my_role() != 'admin' THEN
    RAISE EXCEPTION 'Cannot delete a process with selected offers. Close it instead, or ask an admin.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_process_delete_with_offers_trigger ON processes;
CREATE TRIGGER prevent_process_delete_with_offers_trigger
  BEFORE DELETE ON processes
  FOR EACH ROW EXECUTE FUNCTION prevent_process_delete_with_offers();

-- ============================================================
-- 16. Auto-clean expired audit log entries (> 1 year)
-- ============================================================
CREATE OR REPLACE FUNCTION clean_old_audit_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM public.audit_log WHERE created_at < now() - interval '1 year';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 17. Helper: delete user by email (use from SQL Editor)
-- ============================================================
CREATE OR REPLACE FUNCTION delete_user_by_email(user_email text)
RETURNS void AS $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE email = user_email;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found: %', user_email;
  END IF;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
