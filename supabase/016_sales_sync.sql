-- Pilot: future Allegro purchases withdraw exact linked Ovoko parts. Service-only.
create table if not exists public.sales_sync (
  owner_id uuid primary key references auth.users(id), epoch uuid not null,
  enabled boolean not null default false, seller_id text not null,
  ovoko_account text not null, fingerprint text not null, client_id text not null,
  armed_at timestamptz not null, cursor text, caught_up boolean not null default false,
  lease uuid, lease_until timestamptz, last_attempt_at timestamptz,
  last_checked_at timestamptz, last_error text
);
create table if not exists public.sales_sync_actions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  epoch uuid not null, seller_id text not null, offer_id text not null, part_id text not null,
  publication_hash text not null, item_id text not null, order_id text,
  bought_at timestamptz not null, state text not null check(state in ('waiting','queued','preflight','running','submitted','done','review','uncertain')),
  diagnostic text, checked_at timestamptz, created_at timestamptz not null default now(),
  unique(owner_id,part_id,publication_hash,item_id)
);
alter table public.sales_sync enable row level security;
alter table public.sales_sync_actions enable row level security;
revoke all on public.sales_sync, public.sales_sync_actions from public, anon, authenticated;
grant select, insert, update on public.sales_sync, public.sales_sync_actions to service_role;
create index if not exists sales_sync_pending on public.sales_sync_actions(owner_id,epoch,state,checked_at);

create or replace function public.claim_sales_sync() returns setof public.sales_sync
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o uuid;
begin
  select owner_id into o from public.sales_sync where enabled and (lease_until is null or lease_until < now())
    and (last_attempt_at is null or last_attempt_at < now()-interval '45 seconds')
    order by last_attempt_at nulls first for update skip locked limit 1;
  if o is null then return; end if;
  return query update public.sales_sync set lease=gen_random_uuid(), lease_until=now()+interval '5 minutes',last_attempt_at=now()
    where owner_id=o returning *;
end $$;

-- Evidence and cursor move in one transaction; failed ingestion cannot skip a purchase.
create or replace function public.ingest_sales_sync(p_owner uuid,p_epoch uuid,p_lease uuid,p_cursor text,p_next text,p_caught_up boolean,p_evidence jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.sales_sync; e jsonb; b timestamptz;
begin
  select * into s from public.sales_sync where owner_id=p_owner for update;
  if not found or not s.enabled or s.epoch is distinct from p_epoch or s.lease is distinct from p_lease or s.lease is null or s.lease_until is null or s.lease_until<=now() or s.cursor is distinct from p_cursor then raise exception 'sync lease changed'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence)>5000 then raise exception 'invalid evidence'; end if;
  for e in select value from jsonb_array_elements(p_evidence) loop
    if e->>'kind'='cancelled' then
      update public.sales_sync_actions set state='review',diagnostic='cancelled_no_relist' where owner_id=p_owner and seller_id=s.seller_id and item_id=e->>'itemId';
    elsif e->>'kind'='purchase' then
      b:=coalesce(e->>'boughtAt',e->>'at')::timestamptz;
      if b<s.armed_at then continue; end if;
      insert into public.sales_sync_actions(owner_id,epoch,seller_id,offer_id,part_id,publication_hash,item_id,order_id,bought_at,state,diagnostic)
        select p_owner,p_epoch,s.seller_id,j.allegro_offer_id,j.part_id,j.request_hash,e->>'itemId',e->>'orderId',b,
          case when e->>'boughtAt' is null or e->>'quantity'<>'1' then 'review' when e->>'orderId' is null then 'waiting' else 'queued' end,
          case when e->>'boughtAt' is null or e->>'quantity'<>'1' then 'missing_purchase_time_or_multiunit' else null end
        from public.ovoko_single_publications j where j.owner_id=p_owner and j.ovoko_account=s.ovoko_account and j.allegro_seller_id=s.seller_id
          and j.allegro_offer_id=e->>'listingId' and j.state='created' and j.updated_at<=b
        on conflict(owner_id,part_id,publication_hash,item_id) do update set order_id=coalesce(excluded.order_id,sales_sync_actions.order_id),
          state=case when sales_sync_actions.state='waiting' and excluded.order_id is not null then 'queued' else sales_sync_actions.state end;
    end if;
  end loop;
  update public.sales_sync set cursor=p_next,caught_up=p_caught_up,last_checked_at=now(),last_error=null where owner_id=p_owner;
end $$;
revoke all on function public.claim_sales_sync(), public.ingest_sales_sync(uuid,uuid,uuid,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.claim_sales_sync(), public.ingest_sales_sync(uuid,uuid,uuid,text,text,boolean,jsonb) to service_role;
