create table if not exists public.sales_sync_reverse (
  owner_id uuid primary key references auth.users(id), epoch uuid not null, enabled boolean not null default false,
  seller_id text not null, ovoko_account text not null, fingerprint text not null, client_id text not null,
  armed_at timestamptz not null, baseline jsonb not null, watch jsonb not null,
  lease uuid, lease_until timestamptz, last_attempt_at timestamptz, last_checked_at timestamptz, last_error text
);
create table if not exists public.sales_sync_reverse_actions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), epoch uuid not null,
  order_id text not null, part_id text not null, offer_id text not null, publication_hash text not null,
  state text not null check(state in ('queued','preflight','running','submitted','done','review','uncertain')),
  diagnostic text, checked_at timestamptz, created_at timestamptz not null default now(), unique(owner_id,part_id,publication_hash)
);
alter table public.sales_sync_reverse enable row level security;
alter table public.sales_sync_reverse_actions enable row level security;
revoke all on public.sales_sync_reverse,public.sales_sync_reverse_actions from public,anon,authenticated;
grant select,insert,update on public.sales_sync_reverse,public.sales_sync_reverse_actions to service_role;
create or replace function public.claim_reverse_sales_sync() returns setof public.sales_sync_reverse
language plpgsql security invoker set search_path=public,pg_temp as $$
declare o uuid;
begin
  select owner_id into o from public.sales_sync_reverse where enabled and (lease_until is null or lease_until<now())
    and (last_attempt_at is null or last_attempt_at<now()-interval '45 seconds') order by last_attempt_at nulls first for update skip locked limit 1;
  if o is null then return; end if;
  return query update public.sales_sync_reverse set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',last_attempt_at=now() where owner_id=o returning *;
end $$;
create or replace function public.ingest_reverse_sales_sync(p_owner uuid,p_epoch uuid,p_lease uuid,p_rows jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.sales_sync_reverse; e jsonb;
begin
  select * into s from public.sales_sync_reverse where owner_id=p_owner for update;
  if not found or not s.enabled or s.epoch is distinct from p_epoch or s.lease is distinct from p_lease or s.lease is null or s.lease_until is null or s.lease_until<=now() then raise exception 'reverse lease changed'; end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>5000 then raise exception 'invalid rows'; end if;
  for e in select value from jsonb_array_elements(p_rows) loop
    if s.baseline ? (e->>'orderId') then continue; end if;
    insert into public.sales_sync_reverse_actions(owner_id,epoch,order_id,part_id,offer_id,publication_hash,state,diagnostic)
      select p_owner,p_epoch,e->>'orderId',j.part_id,j.allegro_offer_id,j.request_hash,
        case when e->>'status'='NEW' then 'queued' else 'review' end,
        case when e->>'status'='NEW' then null else 'order_status_not_supported:'||(e->>'status') end
      from public.ovoko_single_publications j where j.owner_id=p_owner and j.ovoko_account=s.ovoko_account and j.allegro_seller_id=s.seller_id and j.part_id=e->>'partId' and j.state='created'
        and (j.updated_at>=s.armed_at or exists(select 1 from jsonb_array_elements(s.watch) w where w->>'partId'=j.part_id and w->>'offerId'=j.allegro_offer_id and w->>'hash'=j.request_hash))
      on conflict(owner_id,part_id,publication_hash) do update set state=case when sales_sync_reverse_actions.order_id<>excluded.order_id or excluded.state='review' then 'review' else sales_sync_reverse_actions.state end,
        diagnostic=case when sales_sync_reverse_actions.order_id<>excluded.order_id then 'multiple_orders' when excluded.state='review' then excluded.diagnostic else sales_sync_reverse_actions.diagnostic end;
  end loop;
  update public.sales_sync_reverse set last_checked_at=now(),last_error=null where owner_id=p_owner;
end $$;
revoke all on function public.claim_reverse_sales_sync(),public.ingest_reverse_sales_sync(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_reverse_sales_sync(),public.ingest_reverse_sales_sync(uuid,uuid,uuid,jsonb) to service_role;
