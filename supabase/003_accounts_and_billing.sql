-- Run once in Supabase SQL Editor before publishing the account API.
create table public.customer_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  company jsonb not null default '{}'::jsonb,
  access_mode text not null default 'standard' check (access_mode in ('standard', 'free')),
  free_until timestamptz,
  suspended boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'none',
  paid_until timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_event_created bigint not null default 0,
  checkout_key text,
  checkout_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.account_admins (
  owner_id uuid primary key references auth.users(id) on delete cascade
);
create table public.account_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  action text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table public.billing_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);
alter table public.customer_accounts enable row level security;
alter table public.account_admins enable row level security;
alter table public.account_audit enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.customer_accounts, public.account_admins, public.account_audit, public.billing_events from anon, authenticated;
grant all on public.customer_accounts, public.account_admins, public.account_audit, public.billing_events to service_role;
grant usage, select on sequence public.account_audit_id_seq to service_role;

-- Metadata seeds billing details only, never roles, suspension or entitlements.
create function public.create_customer_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  details jsonb := new.raw_user_meta_data -> 'billing_company';
begin
  insert into public.customer_accounts(owner_id, email, company)
  values (new.id, coalesce(new.email, ''), case when jsonb_typeof(details) = 'object' then
    jsonb_build_object('name', left(details->>'name', 200), 'nip', left(details->>'nip', 20),
      'street', left(details->>'street', 200), 'postcode', left(details->>'postcode', 6),
      'city', left(details->>'city', 100), 'country', 'PL') else '{}'::jsonb end);
  return new;
end;
$$;
revoke all on function public.create_customer_account() from public, anon, authenticated;
create trigger on_auth_user_account_created after insert on auth.users
for each row execute function public.create_customer_account();
create function public.sync_customer_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.customer_accounts set email = coalesce(new.email, ''), updated_at = now() where owner_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_customer_email() from public, anon, authenticated;
create trigger on_auth_user_email_changed after update of email on auth.users
for each row execute function public.sync_customer_email();
insert into public.customer_accounts(owner_id, email, company)
select id, coalesce(email, ''), case when jsonb_typeof(raw_user_meta_data -> 'billing_company') = 'object'
then jsonb_build_object('name', left(raw_user_meta_data->'billing_company'->>'name', 200),
  'nip', left(raw_user_meta_data->'billing_company'->>'nip', 20),
  'street', left(raw_user_meta_data->'billing_company'->>'street', 200),
  'postcode', left(raw_user_meta_data->'billing_company'->>'postcode', 6),
  'city', left(raw_user_meta_data->'billing_company'->>'city', 100), 'country', 'PL') else '{}'::jsonb end
from auth.users on conflict(owner_id) do nothing;

create function public.admin_account_action(p_actor uuid, p_target uuid, p_action text, p_reason text, p_free_until timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.account_admins where owner_id = p_actor) then raise exception 'Forbidden'; end if;
  if length(trim(p_reason)) < 3 or length(p_reason) > 500 then raise exception 'Reason required'; end if;
  if exists(select 1 from public.account_admins where owner_id = p_target) then raise exception 'Cannot modify administrator access'; end if;
  perform 1 from public.customer_accounts where owner_id = p_target for update;
  if not found then raise exception 'Account not found'; end if;
  if p_action = 'suspend' then
    update public.customer_accounts set suspended = true, updated_at = now() where owner_id = p_target;
  elsif p_action = 'resume' then
    update public.customer_accounts set suspended = false, updated_at = now() where owner_id = p_target;
  elsif p_action = 'grant_free' then
    if p_free_until is not null and p_free_until <= now() then raise exception 'Invalid expiry'; end if;
    update public.customer_accounts set access_mode = 'free', free_until = p_free_until, updated_at = now() where owner_id = p_target;
  elsif p_action = 'revoke_free' then
    update public.customer_accounts set access_mode = 'standard', free_until = null, updated_at = now() where owner_id = p_target;
  else raise exception 'Unknown action'; end if;
  insert into public.account_audit(actor_id, target_id, action, reason) values(p_actor, p_target, p_action, trim(p_reason));
end;
$$;
revoke all on function public.admin_account_action(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_account_action(uuid, uuid, text, text, timestamptz) to service_role;

-- Concurrent Checkout requests use the same durable attempt and Stripe key.
create function public.claim_checkout(p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account public.customer_accounts;
begin
  select * into account from public.customer_accounts where owner_id = p_owner for update;
  if not found or account.suspended then raise exception 'Checkout not allowed'; end if;
  if account.subscription_status not in ('none', 'canceled', 'incomplete_expired')
    or (account.access_mode = 'free' and (account.free_until is null or account.free_until > now())) then
    raise exception 'Existing access or subscription';
  end if;
  if account.checkout_key is null or account.checkout_until <= now() then
    update public.customer_accounts set checkout_key = gen_random_uuid()::text, checkout_until = now() + interval '24 hours'
    where owner_id = p_owner returning * into account;
  end if;
  return jsonb_build_object('key', account.checkout_key, 'expires_at', floor(extract(epoch from account.checkout_until)));
end;
$$;
revoke all on function public.claim_checkout(uuid) from public, anon, authenticated;
grant execute on function public.claim_checkout(uuid) to service_role;

-- The event receipt and account update commit together. Replays are harmless;
-- webhook updates never override manual free access or suspension.
create function public.apply_billing_event(p_event_id text, p_created bigint, p_customer text, p_subscription text,
  p_status text, p_paid_until timestamptz, p_cancel boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare account public.customer_accounts;
begin
  select * into account from public.customer_accounts where stripe_customer_id = p_customer for update;
  if not found then raise exception 'Unknown billing customer'; end if;
  insert into public.billing_events(event_id) values(p_event_id) on conflict do nothing;
  if not found then return; end if;
  if p_created < account.stripe_event_created then return; end if;
  update public.customer_accounts set stripe_subscription_id = p_subscription, subscription_status = p_status,
    paid_until = p_paid_until, cancel_at_period_end = p_cancel, stripe_event_created = p_created, updated_at = now(),
    checkout_key = case when p_status = 'active' then null else checkout_key end,
    checkout_until = case when p_status = 'active' then null else checkout_until end
  where owner_id = account.owner_id;
end;
$$;
revoke all on function public.apply_billing_event(text, bigint, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.apply_billing_event(text, bigint, text, text, text, timestamptz, boolean) to service_role;

-- Bootstrap admin manually with a verified, known auth.users UUID. Never use signup metadata.
-- insert into public.account_admins(owner_id) values ('YOUR-VERIFIED-USER-UUID');
