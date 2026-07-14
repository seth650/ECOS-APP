-- Material Order Form (Phase 7) — run in Supabase SQL Editor.

create table if not exists public.material_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  total_msrp numeric(12, 2) not null default 0,
  total_discount numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  pricing_tier_key text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  request_id text
);

-- If table already existed without request_id:
alter table public.material_orders
  add column if not exists request_id text;

create unique index if not exists material_orders_request_id_uidx
  on public.material_orders (request_id)
  where request_id is not null;

create index if not exists material_orders_user_id_idx on public.material_orders (user_id);
create index if not exists material_orders_created_at_idx on public.material_orders (created_at desc);

comment on table public.material_orders is 'ECOS standalone material POs (My Account → My Orders)';
comment on column public.material_orders.request_id is 'Client idempotency key — prevents duplicate Gary emails on double-submit';

-- Optional: contractor tier on profiles for Tier 2 / Preferred material pricing
alter table public.profiles
  add column if not exists contractor_tier text;

comment on column public.profiles.contractor_tier is 'FGP material pricing: tier2 | preferred (Tier 2 membership); Tier 1 uses small unless FGP elevated';

alter table public.material_orders enable row level security;

drop policy if exists material_orders_select_own on public.material_orders;
create policy material_orders_select_own on public.material_orders
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists material_orders_insert_own on public.material_orders;
create policy material_orders_insert_own on public.material_orders
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Required for client (anon key + logged-in user) to select own history.
-- Inserts are performed by the API with the service role (bypasses RLS).
grant usage on schema public to anon, authenticated;
grant select, insert on public.material_orders to authenticated;
grant select on public.material_orders to anon;
