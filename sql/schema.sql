-- ============================================================
-- PROCUREMENT SYSTEM — Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid references auth.users primary key,
  name text,
  role text check (role in ('commercial', 'procurement', 'admin')) default 'procurement',
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, name, role)
  values (new.id, new.raw_user_meta_data->>'name', coalesce(new.raw_user_meta_data->>'role', 'procurement'));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================

create table if not exists processes (
  id uuid default gen_random_uuid() primary key,
  client_name text not null,
  project_name text not null,
  deadline date,
  priority text check (priority in ('Low','Medium','High','Urgent')) default 'Medium',
  status text check (status in ('Active','Waiting for suppliers','Waiting for internal info','Partial responses','Ready for Excel','Closed','Cancelled')) default 'Active',
  notes text,
  created_by uuid references profiles(id),
  assigned_to uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================

create table if not exists bom_versions (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade,
  version_number int not null default 1,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz default now(),
  file_path text,
  original_name text
);

-- ============================================================

create table if not exists bom_items (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade,
  bom_version_id uuid references bom_versions(id) on delete cascade,
  part_number text,
  description text not null,
  quantity numeric not null default 1,
  unit text,
  category text,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- ============================================================

create table if not exists suppliers (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade,
  name text not null,
  email text,
  email_cc text,
  status text default 'Not contacted',
  notes text,
  last_contact_at date,
  next_followup_at date,
  is_foreign boolean default false,
  cambio numeric,
  transport numeric,
  direitos numeric default 0,
  created_at timestamptz default now()
);

-- ============================================================

create table if not exists quotation_files (
  id uuid default gen_random_uuid() primary key,
  supplier_id uuid references suppliers(id) on delete cascade,
  file_path text,
  original_name text,
  uploaded_at timestamptz default now()
);

-- ============================================================

create table if not exists quotation_items (
  id uuid default gen_random_uuid() primary key,
  supplier_id uuid references suppliers(id) on delete cascade,
  raw_part_number text,
  raw_description text not null,
  quantity numeric default 1,
  price numeric,
  currency text default 'MZN',
  created_at timestamptz default now()
);

-- ============================================================

create table if not exists item_matches (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade,
  bom_item_id uuid references bom_items(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  quotation_item_id uuid references quotation_items(id) on delete cascade,
  match_type text check (match_type in ('auto','manual')) default 'manual',
  confidence numeric,
  created_at timestamptz default now(),
  unique(bom_item_id, supplier_id)
);

-- ============================================================

create table if not exists selected_offers (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade,
  bom_item_id uuid references bom_items(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  quotation_item_id uuid references quotation_items(id) on delete cascade,
  selected_by uuid references profiles(id),
  selected_at timestamptz default now(),
  unique(process_id, bom_item_id)
);

-- ============================================================

create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  title text not null,
  body text,
  process_id uuid references processes(id) on delete cascade,
  read boolean default false not null,
  created_at timestamptz default now()
);

-- ============================================================

create table if not exists installation_costs (
  id uuid default gen_random_uuid() primary key,
  process_id uuid references processes(id) on delete cascade unique,
  senior_count int default 0,
  senior_rate numeric default 0,
  senior_hours numeric default 0,
  intermediate_count int default 0,
  intermediate_rate numeric default 0,
  intermediate_hours numeric default 0,
  junior_count int default 0,
  junior_rate numeric default 0,
  junior_hours numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- RLS — Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table processes enable row level security;
alter table bom_versions enable row level security;
alter table bom_items enable row level security;
alter table suppliers enable row level security;
alter table quotation_files enable row level security;
alter table quotation_items enable row level security;
alter table item_matches enable row level security;
alter table selected_offers enable row level security;
alter table installation_costs enable row level security;

-- Authenticated users can read/write everything (tighten per role later)
create policy "auth_all" on profiles for all using (auth.role() = 'authenticated');
create policy "auth_all" on processes for all using (auth.role() = 'authenticated');
create policy "auth_all" on bom_versions for all using (auth.role() = 'authenticated');
create policy "auth_all" on bom_items for all using (auth.role() = 'authenticated');
create policy "auth_all" on suppliers for all using (auth.role() = 'authenticated');
create policy "auth_all" on quotation_files for all using (auth.role() = 'authenticated');
create policy "auth_all" on quotation_items for all using (auth.role() = 'authenticated');
create policy "auth_all" on item_matches for all using (auth.role() = 'authenticated');
create policy "auth_all" on selected_offers for all using (auth.role() = 'authenticated');
create policy "auth_all" on installation_costs for all using (auth.role() = 'authenticated');

-- ============================================================
-- Audit triggers for BOM, quotation and match tables
-- (audit_log table + audit_trigger_fn() already created above)
-- ============================================================
DROP TRIGGER IF EXISTS audit_bom_versions    ON bom_versions;
DROP TRIGGER IF EXISTS audit_bom_items       ON bom_items;
DROP TRIGGER IF EXISTS audit_quotation_items ON quotation_items;
DROP TRIGGER IF EXISTS audit_item_matches    ON item_matches;

CREATE TRIGGER audit_bom_versions
  AFTER INSERT OR UPDATE OR DELETE ON bom_versions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_bom_items
  AFTER INSERT OR UPDATE OR DELETE ON bom_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_quotation_items
  AFTER INSERT OR UPDATE OR DELETE ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_item_matches
  AFTER INSERT OR UPDATE OR DELETE ON item_matches
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ============================================================
-- Storage bucket for BOM and quotation files
-- ============================================================
-- Run this separately in Supabase Storage UI or via:
-- insert into storage.buckets (id, name, public) values ('procurement-files', 'procurement-files', false);

-- ============================================================
-- Global Suppliers Directory
-- ============================================================
CREATE TABLE IF NOT EXISTS global_suppliers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text,
  email_cc text,
  categories text[] DEFAULT '{}',
  brands text[] DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE global_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gs_read" ON global_suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "gs_write" ON global_suppliers
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','procurement')
  ));

GRANT ALL ON TABLE global_suppliers TO authenticated;

-- Migrate existing suppliers
INSERT INTO global_suppliers (name, email, email_cc)
SELECT DISTINCT ON (lower(trim(name))) name, email, email_cc
FROM suppliers
WHERE name IS NOT NULL AND trim(name) != ''
ORDER BY lower(trim(name)), created_at DESC
ON CONFLICT DO NOTHING;

-- RPC: merge categories + brands (always append, never replace)
CREATE OR REPLACE FUNCTION upsert_global_supplier(
  p_name text, p_email text, p_email_cc text,
  p_categories text[], p_brands text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO global_suppliers (name, email, email_cc, categories, brands)
  VALUES (
    p_name,
    NULLIF(p_email, ''),
    NULLIF(p_email_cc, ''),
    ARRAY(SELECT DISTINCT unnest(p_categories) WHERE unnest IS NOT NULL AND unnest != ''),
    ARRAY(SELECT DISTINCT unnest(p_brands) WHERE unnest IS NOT NULL AND unnest != '')
  )
  ON CONFLICT DO NOTHING;

  UPDATE global_suppliers
  SET
    email     = CASE WHEN p_email    != '' THEN COALESCE(NULLIF(p_email,''),    email)    ELSE email    END,
    email_cc  = CASE WHEN p_email_cc != '' THEN COALESCE(NULLIF(p_email_cc,''), email_cc) ELSE email_cc END,
    categories = ARRAY(SELECT DISTINCT unnest(categories || p_categories) WHERE unnest IS NOT NULL AND unnest != ''),
    brands     = ARRAY(SELECT DISTINCT unnest(brands || p_brands) WHERE unnest IS NOT NULL AND unnest != '')
  WHERE lower(trim(name)) = lower(trim(p_name));
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_global_supplier TO authenticated;

-- Response time tracking
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contacted_at timestamptz;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE global_suppliers ADD COLUMN IF NOT EXISTS response_count int DEFAULT 0;
ALTER TABLE global_suppliers ADD COLUMN IF NOT EXISTS avg_response_hours numeric DEFAULT 0;
ALTER TABLE installation_costs ADD COLUMN IF NOT EXISTS diversos numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION record_supplier_response(
  p_name text,
  p_hours numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE global_suppliers
  SET
    avg_response_hours = (avg_response_hours * response_count + p_hours) / (response_count + 1),
    response_count = response_count + 1
  WHERE lower(trim(name)) = lower(trim(p_name));
END;
$$;
GRANT EXECUTE ON FUNCTION record_supplier_response TO authenticated;

-- Audit triggers for suppliers and processes (missing from initial schema)
CREATE TRIGGER audit_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_processes
  AFTER INSERT OR UPDATE OR DELETE ON processes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_global_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON global_suppliers
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ============================================================
-- Updates applied 2026-04-04 / 2026-04-05
-- ============================================================

-- Fix RLS on global_suppliers (replace gs_read/gs_write with auth_all pattern)
DROP POLICY IF EXISTS "gs_read" ON global_suppliers;
DROP POLICY IF EXISTS "gs_write" ON global_suppliers;
DROP POLICY IF EXISTS "auth_all" ON global_suppliers;
CREATE POLICY "auth_all" ON global_suppliers FOR ALL USING (auth.role() = 'authenticated');

-- Fix RLS on quotation_items (ensure consistent pattern)
DROP POLICY IF EXISTS "auth_all" ON quotation_items;
CREATE POLICY "auth_all" ON quotation_items FOR ALL USING (auth.role() = 'authenticated');

-- Notifications RLS (was missing)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all" ON notifications;
CREATE POLICY "auth_all" ON notifications FOR ALL USING (auth.role() = 'authenticated');

-- Unique index on global_suppliers name (prevents duplicate rows)
CREATE UNIQUE INDEX IF NOT EXISTS gs_name_unique ON global_suppliers (lower(trim(name)));

-- Updated upsert_global_supplier: uses unique index for proper ON CONFLICT UPDATE
CREATE OR REPLACE FUNCTION upsert_global_supplier(
  p_name text, p_email text, p_email_cc text,
  p_categories text[], p_brands text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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
GRANT EXECUTE ON FUNCTION upsert_global_supplier TO authenticated;

-- Process duration tracking
ALTER TABLE processes ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}';
ALTER TABLE processes ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Custom process status color
ALTER TABLE processes ADD COLUMN IF NOT EXISTS status_color text;

-- RPC: estimate process duration based on historical closed processes
CREATE OR REPLACE FUNCTION get_duration_estimates(p_categories text[])
RETURNS TABLE(avg_days numeric, min_days numeric, max_days numeric, sample_count int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROUND(AVG(d)::numeric, 0),
    ROUND(MIN(d)::numeric, 0),
    ROUND(MAX(d)::numeric, 0),
    COUNT(*)::int
  FROM (
    SELECT EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400 AS d
    FROM processes
    WHERE closed_at IS NOT NULL
      AND status = 'Closed'
      AND categories && p_categories
      AND EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400 BETWEEN 1 AND 730
  ) sub
  HAVING COUNT(*) >= 2;
END;
$$;

-- ── Service items in BOM ──
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS is_service boolean DEFAULT false;
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS service_price numeric DEFAULT 0;

-- ── Multi-sheet BOM support ──
-- bom_items: track which sheet each item came from
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS sheet_name text DEFAULT 'Sheet1';

-- installation_costs: one row per sheet instead of one per process
-- tech_rows stores ordered technician rows as [{ description, count, hours, rate }]
ALTER TABLE installation_costs DROP CONSTRAINT IF EXISTS installation_costs_process_id_key;
ALTER TABLE installation_costs ADD COLUMN IF NOT EXISTS sheet_name text NOT NULL DEFAULT 'Sheet1';
ALTER TABLE installation_costs ADD COLUMN IF NOT EXISTS sort_order int DEFAULT 0;
ALTER TABLE installation_costs ADD COLUMN IF NOT EXISTS tech_rows jsonb DEFAULT '[]';
ALTER TABLE installation_costs ADD CONSTRAINT installation_costs_process_sheet_unique UNIQUE (process_id, sheet_name);
GRANT EXECUTE ON FUNCTION get_duration_estimates TO authenticated;

-- ── Quotation discount ──
ALTER TABLE quotation_items ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0;

-- ── item_matches: track last update time for last-write-wins propagation ──
ALTER TABLE item_matches ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
