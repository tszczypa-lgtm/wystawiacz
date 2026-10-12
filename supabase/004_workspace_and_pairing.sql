-- Apply before enabling the new server features. No existing listings are changed.
begin;
alter table public.customer_accounts add column if not exists trial_until timestamptz default (now() + interval '30 days');
alter table public.customer_accounts add column if not exists trial_claimed_nip text;
alter table public.customer_accounts add column if not exists allegro_account_limit integer not null default 1 check (allegro_account_limit between 1 and 10);
-- Retained separately so deleting an application account does not restart a trial.
create table public.company_trial_claims (
  identity text primary key, expires_at timestamptz not null
);
alter table public.company_trial_claims enable row level security;
revoke all on public.company_trial_claims from anon,authenticated;
grant all on public.company_trial_claims to service_role;
create function public.claim_company_trial(p_owner uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare customer public.customer_accounts; nip text; expiry timestamptz;
begin
  select * into customer from public.customer_accounts where owner_id=p_owner for update;
  if not found then raise exception 'Account missing'; end if;
  nip := customer.company->>'nip';
  if nip is null or nip !~ '^[0-9]{10}$' then return null; end if;
  if customer.trial_until is null then return null; end if;
  insert into public.company_trial_claims(identity,expires_at) values('nip:'||nip,customer.trial_until)
    on conflict(identity) do update set expires_at=least(public.company_trial_claims.expires_at,excluded.expires_at)
    returning expires_at into expiry;
  update public.customer_accounts set trial_until=least(trial_until,expiry),trial_claimed_nip=nip where owner_id=p_owner;
  return expiry;
end; $$;
revoke all on function public.claim_company_trial(uuid) from public,anon,authenticated;
grant execute on function public.claim_company_trial(uuid) to service_role;

create table public.allowed_allegro_sellers (
  owner_id uuid not null references public.customer_accounts(owner_id) on delete cascade,
  seller_id text not null check (seller_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  primary key(owner_id, seller_id), unique(seller_id)
);
create table public.workspace_sessions (
  id uuid not null, owner_id uuid not null references public.customer_accounts(owner_id) on delete cascade,
  name text not null, payload jsonb not null, revision integer not null default 1,
  updated_at timestamptz not null default now(), primary key(owner_id,id)
);
create table public.workspace_preferences (
  owner_id uuid primary key references public.customer_accounts(owner_id) on delete cascade,
  description_template text not null check (length(description_template)<=20000)
);
alter table public.workspace_preferences enable row level security;
revoke all on public.workspace_preferences from anon,authenticated;
grant all on public.workspace_preferences to service_role;
create table public.workspace_session_versions (
  owner_id uuid not null, session_id uuid not null, revision integer not null, payload jsonb not null,
  created_at timestamptz not null default now(), primary key(owner_id,session_id,revision),
  foreign key(owner_id,session_id) references public.workspace_sessions(owner_id,id) on delete cascade
);
create table public.listing_publications (
  owner_id uuid not null references public.customer_accounts(owner_id) on delete cascade,
  product_id uuid not null, seller_id text not null, status text not null default 'pending',
  offer_id text, created_at timestamptz not null default now(), primary key(owner_id,product_id)
);
alter table public.allowed_allegro_sellers enable row level security;
alter table public.workspace_sessions enable row level security;
alter table public.workspace_session_versions enable row level security;
alter table public.listing_publications enable row level security;
revoke all on public.allowed_allegro_sellers, public.workspace_sessions, public.workspace_session_versions, public.listing_publications from anon, authenticated;
grant all on public.allowed_allegro_sellers, public.workspace_sessions, public.workspace_session_versions, public.listing_publications to service_role;

create function public.claim_allegro_seller(p_owner uuid, p_seller text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare max_accounts integer; trial_expiry timestamptz;
begin
  select allegro_account_limit into max_accounts from public.customer_accounts where owner_id=p_owner and not suspended for update;
  if not found then return false; end if;
  if exists(select 1 from public.allowed_allegro_sellers where owner_id=p_owner and seller_id=p_seller) then return true; end if;
  if exists(select 1 from public.allowed_allegro_sellers where seller_id=p_seller)
    or (select count(*) from public.allowed_allegro_sellers where owner_id=p_owner)>=max_accounts then return false; end if;
  insert into public.allowed_allegro_sellers(owner_id,seller_id) values(p_owner,p_seller);
  select trial_until into trial_expiry from public.customer_accounts where owner_id=p_owner;
  if trial_expiry is not null then
    insert into public.company_trial_claims(identity,expires_at) values('seller:'||p_seller,trial_expiry)
      on conflict(identity) do update set expires_at=least(public.company_trial_claims.expires_at,excluded.expires_at)
      returning expires_at into trial_expiry;
    update public.customer_accounts set trial_until=least(trial_until,trial_expiry) where owner_id=p_owner;
  end if;
  return true;
exception when unique_violation then return false;
end; $$;

create function public.save_workspace_session(p_owner uuid,p_id uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_row public.workspace_sessions;
begin
  perform 1 from public.customer_accounts where owner_id=p_owner and not suspended for update;
  if not found then raise exception 'Forbidden'; end if;
  select * into current_row from public.workspace_sessions where owner_id=p_owner and id=p_id for update;
  if found and current_row.revision<>p_revision then return jsonb_build_object('conflict',true); end if;
  if not found and p_revision<>0 then return jsonb_build_object('conflict',true); end if;
  if current_row.id is null then
    if (select count(*) from public.workspace_sessions where owner_id=p_owner)>=100 then raise exception 'Session limit'; end if;
    insert into public.workspace_sessions(id,owner_id,name,payload) values(p_id,p_owner,left(coalesce(p_payload->>'name','Sesja'),120),p_payload) returning * into current_row;
  else
    insert into public.workspace_session_versions(owner_id,session_id,revision,payload) values(p_owner,p_id,current_row.revision,current_row.payload);
    delete from public.workspace_session_versions where owner_id=p_owner and session_id=p_id and revision<=current_row.revision-20;
    update public.workspace_sessions set payload=p_payload,name=left(coalesce(p_payload->>'name','Sesja'),120),revision=revision+1,updated_at=now() where owner_id=p_owner and id=p_id returning * into current_row;
  end if;
  return jsonb_build_object('revision',current_row.revision);
end; $$;

create function public.claim_listing_publication(p_owner uuid,p_product uuid,p_seller text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing public.listing_publications;
begin
  insert into public.listing_publications(owner_id,product_id,seller_id) values(p_owner,p_product,p_seller) on conflict do nothing;
  if found then return jsonb_build_object('claimed',true); end if;
  select * into existing from public.listing_publications where owner_id=p_owner and product_id=p_product;
  return jsonb_build_object('claimed',false,'status',existing.status,'id',existing.offer_id,'seller',existing.seller_id);
end; $$;

create function public.admin_allegro_binding(p_actor uuid,p_target uuid,p_limit integer,p_remove text,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.account_admins a join public.customer_accounts c on c.owner_id=a.owner_id where a.owner_id=p_actor and not c.suspended)
    or p_limit not between 1 and 10 or length(trim(p_reason)) not between 3 and 500 then raise exception 'Forbidden'; end if;
  perform 1 from public.customer_accounts where owner_id=p_target for update;
  if not found then raise exception 'Account missing'; end if;
  -- Replacement invalidates the old token as well; logout alone never clears bindings.
  if p_remove is not null then
    delete from public.allowed_allegro_sellers where owner_id=p_target and seller_id=p_remove;
    delete from public.allegro_connections where owner_id=p_target;
  end if;
  if (select count(*) from public.allowed_allegro_sellers where owner_id=p_target)>p_limit then raise exception 'Limit below existing bindings'; end if;
  update public.customer_accounts set allegro_account_limit=p_limit where owner_id=p_target;
  insert into public.account_audit(actor_id,target_id,action,reason) values(p_actor,p_target,'allegro_binding',p_reason);
end; $$;
revoke all on function public.claim_allegro_seller(uuid,text), public.save_workspace_session(uuid,uuid,integer,jsonb), public.claim_listing_publication(uuid,uuid,text), public.admin_allegro_binding(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.claim_allegro_seller(uuid,text), public.save_workspace_session(uuid,uuid,integer,jsonb), public.claim_listing_publication(uuid,uuid,text), public.admin_allegro_binding(uuid,uuid,integer,text,text) to service_role;
commit;
