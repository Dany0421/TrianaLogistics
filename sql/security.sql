-- ============================================================
-- PROCUREMENT SYSTEM — Security Migration
-- Run this in Supabase SQL Editor AFTER schema.sql
-- Replaces the permissive "auth_all" policies with role-aware RLS
-- ============================================================

-- ============================================================
-- Helper: get the current user's role from profiles
-- security definer = runs as postgres, not the calling user
-- This prevents a user from spoofing their own role
-- ============================================================
create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

-- ============================================================
-- Drop all permissive blanket policies
-- ============================================================
drop policy if exists "auth_all" on profiles;
drop policy if exists "auth_all" on processes;
drop policy if exists "auth_all" on bom_versions;
drop policy if exists "auth_all" on bom_items;
drop policy if exists "auth_all" on suppliers;
drop policy if exists "auth_all" on quotation_files;
drop policy if exists "auth_all" on quotation_items;
drop policy if exists "auth_all" on item_matches;
drop policy if exists "auth_all" on selected_offers;
drop policy if exists "auth_all" on installation_costs;

-- ============================================================
-- profiles
-- ============================================================
-- Read: all authenticated users (needed to display names/roles in UI)
create policy "profiles_select"
  on profiles for select
  using (auth.role() = 'authenticated');

-- Update own profile (name etc) — but CANNOT change own role
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    AND role = (select role from profiles where id = auth.uid())
  );

-- Insert: handled only by the trigger on auth.users — block direct client inserts
-- (no insert policy = blocked for anon/authenticated client)

-- Delete: nobody via client
-- (no delete policy = blocked)

-- ============================================================
-- processes
-- ============================================================
-- Read: all authenticated (commercial and procurement both see all processes)
create policy "processes_select"
  on processes for select
  using (auth.role() = 'authenticated');

-- Create: any authenticated user (commercial creates, procurement can too)
create policy "processes_insert"
  on processes for insert
  with check (auth.role() = 'authenticated');

-- Update: commercial can only edit their own processes; procurement/admin can edit all
create policy "processes_update"
  on processes for update
  using (
    get_my_role() in ('procurement', 'admin')
    OR created_by = auth.uid()
  );

-- Delete: only admin or the creator
create policy "processes_delete"
  on processes for delete
  using (
    get_my_role() = 'admin'
    OR created_by = auth.uid()
  );

-- ============================================================
-- bom_versions
-- Commercial uploads BOM → needs insert
-- Procurement/admin can delete old versions
-- ============================================================
create policy "bom_versions_select"
  on bom_versions for select
  using (auth.role() = 'authenticated');

create policy "bom_versions_insert"
  on bom_versions for insert
  with check (auth.role() = 'authenticated');

create policy "bom_versions_delete"
  on bom_versions for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- bom_items
-- Commercial can insert (after BOM validation)
-- Procurement/admin can update/delete (e.g. on revision handling)
-- ============================================================
create policy "bom_items_select"
  on bom_items for select
  using (auth.role() = 'authenticated');

create policy "bom_items_insert"
  on bom_items for insert
  with check (auth.role() = 'authenticated');

create policy "bom_items_update"
  on bom_items for update
  using (auth.role() = 'authenticated');

create policy "bom_items_delete"
  on bom_items for delete
  using (auth.role() = 'authenticated');

-- ============================================================
-- suppliers — procurement/admin only
-- ============================================================
create policy "suppliers_select"
  on suppliers for select
  using (auth.role() = 'authenticated');

create policy "suppliers_insert"
  on suppliers for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "suppliers_update"
  on suppliers for update
  using (get_my_role() in ('procurement', 'admin'));

create policy "suppliers_delete"
  on suppliers for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- quotation_files — procurement/admin only
-- ============================================================
create policy "quotation_files_select"
  on quotation_files for select
  using (auth.role() = 'authenticated');

create policy "quotation_files_insert"
  on quotation_files for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "quotation_files_delete"
  on quotation_files for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- quotation_items — procurement/admin only
-- ============================================================
create policy "quotation_items_select"
  on quotation_items for select
  using (auth.role() = 'authenticated');

create policy "quotation_items_insert"
  on quotation_items for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "quotation_items_update"
  on quotation_items for update
  using (get_my_role() in ('procurement', 'admin'));

create policy "quotation_items_delete"
  on quotation_items for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- item_matches — procurement/admin only
-- ============================================================
create policy "item_matches_select"
  on item_matches for select
  using (auth.role() = 'authenticated');

create policy "item_matches_insert"
  on item_matches for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "item_matches_update"
  on item_matches for update
  using (get_my_role() in ('procurement', 'admin'));

create policy "item_matches_delete"
  on item_matches for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- selected_offers — procurement/admin only
-- ============================================================
create policy "selected_offers_select"
  on selected_offers for select
  using (auth.role() = 'authenticated');

create policy "selected_offers_insert"
  on selected_offers for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "selected_offers_update"
  on selected_offers for update
  using (get_my_role() in ('procurement', 'admin'));

create policy "selected_offers_delete"
  on selected_offers for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- installation_costs — procurement/admin only
-- ============================================================
create policy "installation_costs_select"
  on installation_costs for select
  using (auth.role() = 'authenticated');

create policy "installation_costs_insert"
  on installation_costs for insert
  with check (get_my_role() in ('procurement', 'admin'));

create policy "installation_costs_update"
  on installation_costs for update
  using (get_my_role() in ('procurement', 'admin'));

create policy "installation_costs_delete"
  on installation_costs for delete
  using (get_my_role() in ('procurement', 'admin'));

-- ============================================================
-- Storage bucket RLS — procurement-files bucket
-- Run this after creating the bucket
-- ============================================================
-- Only authenticated users can upload files
insert into storage.buckets (id, name, public) values ('procurement-files', 'procurement-files', false)
  on conflict do nothing;

create policy "storage_select"
  on storage.objects for select
  using (bucket_id = 'procurement-files' AND auth.role() = 'authenticated');

create policy "storage_insert"
  on storage.objects for insert
  with check (bucket_id = 'procurement-files' AND auth.role() = 'authenticated');

create policy "storage_delete"
  on storage.objects for delete
  using (bucket_id = 'procurement-files' AND get_my_role() in ('procurement', 'admin'));
