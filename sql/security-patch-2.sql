-- ============================================================
-- SECURITY PATCH 2 — Run in Supabase SQL Editor
-- Fixes:
--   1. Commercial users can SELECT sensitive tables via console
--   2. record_supplier_response has no role check
--   3. upsert_global_supplier has no role check
--   4. audit_log: explicit DELETE block
--   5. rejected_automatch: RLS (if table exists without it)
-- ============================================================

-- ============================================================
-- 1. Restrict SELECT on sensitive procurement tables
--    Commercial users should NOT be able to read supplier
--    pricing, matches, or quotation data directly via API.
-- ============================================================

-- suppliers
DROP POLICY IF EXISTS "suppliers_select" ON suppliers;
CREATE POLICY "suppliers_select"
  ON suppliers FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- quotation_files
DROP POLICY IF EXISTS "quotation_files_select" ON quotation_files;
CREATE POLICY "quotation_files_select"
  ON quotation_files FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- quotation_items
DROP POLICY IF EXISTS "quotation_items_select" ON quotation_items;
CREATE POLICY "quotation_items_select"
  ON quotation_items FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- item_matches
DROP POLICY IF EXISTS "item_matches_select" ON item_matches;
CREATE POLICY "item_matches_select"
  ON item_matches FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- selected_offers
DROP POLICY IF EXISTS "selected_offers_select" ON selected_offers;
CREATE POLICY "selected_offers_select"
  ON selected_offers FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- installation_costs
DROP POLICY IF EXISTS "installation_costs_select" ON installation_costs;
CREATE POLICY "installation_costs_select"
  ON installation_costs FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

-- global_suppliers (catalog readable by all auth, but keep it — low risk)
-- Leave global_suppliers_select as 'authenticated' — it's a public catalog


-- ============================================================
-- 2. Add role check to record_supplier_response
--    Any authenticated user could call this and poison supplier
--    response time data.
-- ============================================================
CREATE OR REPLACE FUNCTION record_supplier_response(
  p_name text,
  p_hours numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() NOT IN ('procurement', 'admin') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  IF p_hours < 0 OR p_hours > 8760 THEN -- max 1 year in hours
    RAISE EXCEPTION 'Valor de horas inválido.';
  END IF;
  UPDATE global_suppliers
  SET
    avg_response_hours = (avg_response_hours * response_count + p_hours) / (response_count + 1),
    response_count = response_count + 1
  WHERE lower(trim(name)) = lower(trim(p_name));
END;
$$;

-- ============================================================
-- 3. Add role check to upsert_global_supplier
--    Any authenticated user could call this directly and
--    modify supplier emails/categories in the global catalog.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_global_supplier(
  p_name text, p_email text, p_email_cc text,
  p_categories text[], p_brands text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF get_my_role() NOT IN ('procurement', 'admin') THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;
  INSERT INTO global_suppliers (name, email, email_cc, categories, brands)
  VALUES (
    p_name,
    NULLIF(p_email, ''),
    NULLIF(p_email_cc, ''),
    ARRAY(SELECT DISTINCT u FROM unnest(p_categories) u WHERE u IS NOT NULL AND u != ''),
    ARRAY(SELECT DISTINCT u FROM unnest(p_brands) u WHERE u IS NOT NULL AND u != '')
  )
  ON CONFLICT (lower(trim(name))) DO UPDATE SET
    email      = CASE WHEN p_email    != '' THEN COALESCE(NULLIF(p_email,''),    global_suppliers.email)    ELSE global_suppliers.email    END,
    email_cc   = CASE WHEN p_email_cc != '' THEN COALESCE(NULLIF(p_email_cc,''), global_suppliers.email_cc) ELSE global_suppliers.email_cc END,
    categories = ARRAY(SELECT DISTINCT u FROM unnest(global_suppliers.categories || p_categories) u WHERE u IS NOT NULL AND u != ''),
    brands     = ARRAY(SELECT DISTINCT u FROM unnest(global_suppliers.brands || p_brands) u WHERE u IS NOT NULL AND u != '');
END;
$$;

-- ============================================================
-- 4. Explicitly block DELETE on audit_log from client
-- ============================================================
DROP POLICY IF EXISTS "audit_log_delete_blocked" ON audit_log;
CREATE POLICY "audit_log_delete_blocked"
  ON audit_log FOR DELETE
  USING (false);

-- ============================================================
-- 5. rejected_automatch RLS (was added via migration but may
--    have used a permissive policy — tighten it)
-- ============================================================
DROP POLICY IF EXISTS "auth_rejected_automatch" ON rejected_automatch;

CREATE POLICY "rejected_automatch_select"
  ON rejected_automatch FOR SELECT
  USING (get_my_role() IN ('procurement', 'admin'));

CREATE POLICY "rejected_automatch_insert"
  ON rejected_automatch FOR INSERT
  WITH CHECK (get_my_role() IN ('procurement', 'admin'));

CREATE POLICY "rejected_automatch_delete"
  ON rejected_automatch FOR DELETE
  USING (get_my_role() IN ('procurement', 'admin'));

-- ============================================================
-- 6. Tighten profiles_insert_on_signup
--    'with check (true)' allows any auth user to insert profiles.
--    Restrict to: either it's a trigger (auth.uid() IS NULL)
--    or the user is inserting their own profile.
-- ============================================================
DROP POLICY IF EXISTS "profiles_insert_on_signup" ON profiles;
CREATE POLICY "profiles_insert_on_signup"
  ON profiles FOR INSERT
  WITH CHECK (
    auth.uid() IS NULL  -- trigger-based insert (handle_new_user)
    OR id = auth.uid()  -- user inserting their own profile
  );
