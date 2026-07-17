-- My Floor Systems v2 schema additions — run after custom_floor_systems.sql

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

comment on column public.contractor_vendors.phone is 'Optional phone — future SMS to vendors';
comment on column public.custom_floor_systems.location is 'indoor | outdoor';
comment on column public.custom_floor_systems.system_type is 'flake | solid | solid_texture | metallic | quartz | grind_seal';
comment on column public.custom_floor_systems.diagram_status is 'pending | ready | null';
comment on column public.custom_floor_systems.cutaway_url is 'Supabase storage URL for custom cutaway PNG';

-- Prevent future duplicate vendors per contractor email
create unique index if not exists contractor_vendors_user_email_uidx
  on public.contractor_vendors (user_id, lower(email));
