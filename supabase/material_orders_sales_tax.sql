-- Indiana 7% sales tax on manual material POs.
-- Run in Supabase SQL editor if material_orders already exists.

alter table public.material_orders
  add column if not exists sales_tax numeric(12, 2),
  add column if not exists total_with_tax numeric(12, 2);

comment on column public.material_orders.sales_tax is 'Indiana sales tax (7%) on subtotal after discount';
comment on column public.material_orders.total_with_tax is 'Grand total including IN sales tax';

-- Backfill: older rows stored pre-tax total in total_price.
update public.material_orders
set
  sales_tax = round(total_price * 0.07, 2),
  total_with_tax = round(total_price * 1.07, 2)
where total_with_tax is null and coalesce(total_price, 0) > 0;
