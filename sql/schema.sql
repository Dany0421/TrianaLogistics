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
-- Storage bucket for BOM and quotation files
-- ============================================================
-- Run this separately in Supabase Storage UI or via:
-- insert into storage.buckets (id, name, public) values ('procurement-files', 'procurement-files', false);
