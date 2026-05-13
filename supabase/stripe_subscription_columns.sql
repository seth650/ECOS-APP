-- Run in Supabase SQL Editor (profiles table).
-- Links ECOS users to Stripe + subscription UI + grace period after failed payments.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists grace_period_start timestamptz,
  add column if not exists grace_email_stage integer default 0;

comment on column public.profiles.stripe_customer_id is 'Stripe Customer id (cus_...) for Checkout + Billing Portal';
comment on column public.profiles.stripe_subscription_id is 'Stripe Subscription id (sub_...) while Tier 1 active';
comment on column public.profiles.subscription_status is 'Stripe subscription.status mirror (active, past_due, canceled, ...)';
comment on column public.profiles.subscription_current_period_end is 'Current period end from Stripe (next billing)';
comment on column public.profiles.grace_period_start is 'Set on first invoice.payment_failed; cleared on successful payment';
comment on column public.profiles.grace_email_stage is 'Grace emails: 0 none, 1 day1 sent, 2 day2, 3 day3; cron downgrades after 72h at stage 3';

create index if not exists profiles_stripe_customer_id_idx on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists profiles_stripe_subscription_id_idx on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists profiles_grace_period_start_idx on public.profiles (grace_period_start) where grace_period_start is not null;
