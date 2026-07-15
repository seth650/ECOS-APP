-- Tier 1 annual PO counter (calculator orders + material_orders).
-- Run in Supabase SQL editor after profiles table exists.

alter table public.profiles
  add column if not exists annual_po_count integer not null default 0,
  add column if not exists po_year_start_date timestamptz;

comment on column public.profiles.annual_po_count is 'PO submissions in the current PO year (Tier 1 cap: 50)';
comment on column public.profiles.po_year_start_date is 'Start of the current PO counting year; resets annually';

-- Backfill from legacy fields when present.
update public.profiles
set po_year_start_date = coalesce(po_year_start_date, signup_anniversary_date, created_at, now())
where po_year_start_date is null;

update public.profiles
set annual_po_count = coalesce(nullif(annual_po_count, 0), pos_submitted_this_year, 0)
where annual_po_count is null or (annual_po_count = 0 and coalesce(pos_submitted_this_year, 0) > 0);
