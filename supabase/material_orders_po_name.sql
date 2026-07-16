-- Optional PO name/number on manual material orders.
-- Run in Supabase SQL editor if material_orders already exists.

alter table public.material_orders
  add column if not exists po_name text;

comment on column public.material_orders.po_name is 'Optional contractor PO number/name';
