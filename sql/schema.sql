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
-- Indexes on foreign keys (performance)
-- ============================================================

create index if not exists idx_bom_items_process_id on bom_items(process_id);
create index if not exists idx_bom_items_bom_version_id on bom_items(bom_version_id);
create index if not exists idx_bom_versions_process_id on bom_versions(process_id);
create index if not exists idx_bom_versions_uploaded_by on bom_versions(uploaded_by);
create index if not exists idx_item_matches_process_id on item_matches(process_id);
create index if not exists idx_item_matches_supplier_id on item_matches(supplier_id);
create index if not exists idx_item_matches_quotation_item_id on item_matches(quotation_item_id);
create index if not exists idx_processes_created_by on processes(created_by);
create index if not exists idx_processes_assigned_to on processes(assigned_to);
create index if not exists idx_quotation_files_supplier_id on quotation_files(supplier_id);
create index if not exists idx_quotation_items_supplier_id on quotation_items(supplier_id);
create index if not exists idx_selected_offers_bom_item_id on selected_offers(bom_item_id);
create index if not exists idx_selected_offers_supplier_id on selected_offers(supplier_id);
create index if not exists idx_selected_offers_quotation_item_id on selected_offers(quotation_item_id);
create index if not exists idx_selected_offers_selected_by on selected_offers(selected_by);
create index if not exists idx_suppliers_process_id on suppliers(process_id);

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

-- ============================================================
-- Storage bucket for BOM and quotation files
-- ============================================================
-- Run this separately in Supabase Storage UI or via:
-- insert into storage.buckets (id, name, public) values ('procurement-files', 'procurement-files', false);
