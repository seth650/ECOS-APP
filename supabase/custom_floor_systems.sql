-- My Floor Systems (Tier 2+) — run in Supabase SQL Editor.

-- Vendors per contractor
create table if not exists public.contractor_vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contractor_vendors_user_id_idx
  on public.contractor_vendors (user_id);

alter table public.contractor_vendors enable row level security;

drop policy if exists contractor_vendors_select_own on public.contractor_vendors;
create policy contractor_vendors_select_own on public.contractor_vendors
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists contractor_vendors_insert_own on public.contractor_vendors;
create policy contractor_vendors_insert_own on public.contractor_vendors
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists contractor_vendors_update_own on public.contractor_vendors;
create policy contractor_vendors_update_own on public.contractor_vendors
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists contractor_vendors_delete_own on public.contractor_vendors;
create policy contractor_vendors_delete_own on public.contractor_vendors
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.contractor_vendors to authenticated;

-- Custom flooring systems
create table if not exists public.custom_floor_systems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  layers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists custom_floor_systems_user_id_idx
  on public.custom_floor_systems (user_id);

alter table public.custom_floor_systems enable row level security;

drop policy if exists custom_floor_systems_select_own on public.custom_floor_systems;
create policy custom_floor_systems_select_own on public.custom_floor_systems
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists custom_floor_systems_insert_own on public.custom_floor_systems;
create policy custom_floor_systems_insert_own on public.custom_floor_systems
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists custom_floor_systems_update_own on public.custom_floor_systems;
create policy custom_floor_systems_update_own on public.custom_floor_systems
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists custom_floor_systems_delete_own on public.custom_floor_systems;
create policy custom_floor_systems_delete_own on public.custom_floor_systems
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.custom_floor_systems to authenticated;

-- Diagram requests (Submit for Custom Diagram)
create table if not exists public.diagram_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  system_id uuid references public.custom_floor_systems (id) on delete set null,
  system_name text,
  contractor_name text,
  email text,
  description text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists diagram_requests_user_id_idx on public.diagram_requests (user_id);

alter table public.diagram_requests enable row level security;

drop policy if exists diagram_requests_select_own on public.diagram_requests;
create policy diagram_requests_select_own on public.diagram_requests
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists diagram_requests_insert_own on public.diagram_requests;
create policy diagram_requests_insert_own on public.diagram_requests
  for insert to authenticated
  with check (auth.uid() = user_id);

grant select, insert on public.diagram_requests to authenticated;

-- Vendor PO tracking on calculator orders
alter table public.orders
  add column if not exists vendor_po_sent_at timestamptz;

alter table public.orders
  add column if not exists vendor_name text;

alter table public.orders
  add column if not exists vendor_email text;

alter table public.orders
  add column if not exists is_custom_system boolean default false;

comment on table public.contractor_vendors is 'Tier 2+ contractor vendor contacts for custom system POs';
comment on table public.custom_floor_systems is 'Tier 2+ reusable custom flooring systems';
comment on column public.orders.vendor_po_sent_at is 'When vendor PO email was sent via ECOS';

-- v2 columns (safe if already applied)
alter table public.contractor_vendors
  add column if not exists phone text;

alter table public.custom_floor_systems
  add column if not exists location text;

alter table public.custom_floor_systems
  add column if not exists system_type text;

alter table public.custom_floor_systems
  add column if not exists diagram_status text;

alter table public.custom_floor_systems
  add column if not exists cutaway_url text;
