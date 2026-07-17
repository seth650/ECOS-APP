-- ============================================================================
-- Clean duplicate contractor_vendors, remap layer vendorIds, then unique index
-- Run once in Supabase SQL Editor (safe to re-run).
-- ============================================================================

-- 1) Map every duplicate vendor → the row we will KEEP (oldest by created_at, then id)
create temporary table if not exists _vendor_keep_map (
  user_id uuid not null,
  email_key text not null,
  keep_id uuid not null,
  drop_id uuid not null,
  primary key (drop_id)
) on commit drop;

truncate _vendor_keep_map;

insert into _vendor_keep_map (user_id, email_key, keep_id, drop_id)
select
  d.user_id,
  d.email_key,
  d.keep_id,
  d.id as drop_id
from (
  select
    v.id,
    v.user_id,
    lower(trim(v.email)) as email_key,
    first_value(v.id) over (
      partition by v.user_id, lower(trim(v.email))
      order by v.created_at asc nulls last, v.id asc
    ) as keep_id
  from public.contractor_vendors v
  where v.email is not null
    and trim(v.email) <> ''
) d
where d.id <> d.keep_id;

-- Preview (optional): how many duplicates will be removed
-- select count(*) as duplicates_to_delete from _vendor_keep_map;
-- select * from _vendor_keep_map limit 50;

-- 2) Remap custom_floor_systems.layers[].vendorId from drop_id → keep_id
--    layers is jsonb array of objects with optional "vendorId" string/uuid
do $$
declare
  sys record;
  new_layers jsonb;
  changed boolean;
  drop_rec record;
begin
  for sys in
    select id, user_id, layers
    from public.custom_floor_systems
    where layers is not null
      and jsonb_typeof(layers) = 'array'
      and jsonb_array_length(layers) > 0
  loop
    new_layers := sys.layers;
    changed := false;

    for drop_rec in
      select drop_id, keep_id
      from _vendor_keep_map
      where user_id = sys.user_id
    loop
      -- Replace vendorId when it matches a duplicate id (as text)
      if new_layers::text like '%' || drop_rec.drop_id::text || '%' then
        new_layers := replace(
          new_layers::text,
          drop_rec.drop_id::text,
          drop_rec.keep_id::text
        )::jsonb;
        changed := true;
      end if;
    end loop;

    if changed then
      update public.custom_floor_systems
      set
        layers = new_layers,
        updated_at = now()
      where id = sys.id;
    end if;
  end loop;
end $$;

-- 3) Delete duplicate vendor rows (keep oldest per user_id + lower(email))
delete from public.contractor_vendors v
using _vendor_keep_map m
where v.id = m.drop_id;

-- 4) Unique index so this cannot happen again
create unique index if not exists contractor_vendors_user_email_uidx
  on public.contractor_vendors (user_id, lower(email));

-- 5) Sanity check — should return 0 rows
-- select user_id, lower(email) as email_key, count(*)
-- from public.contractor_vendors
-- where email is not null and trim(email) <> ''
-- group by user_id, lower(email)
-- having count(*) > 1;
