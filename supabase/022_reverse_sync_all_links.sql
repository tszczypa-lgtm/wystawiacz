begin;
create index if not exists ovoko_publications_sync_scope on public.ovoko_single_publications(owner_id,ovoko_account,allegro_seller_id,state,part_id);
create or replace function public.reverse_sales_sync_coverage(p_owner uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('scopeVersion',2,
  'linked',count(*) filter(where j.state='created' and j.part_id is not null),
  'blocked',count(*) filter(where j.state<>'created' or j.part_id is null))
 from public.ovoko_single_publications j join public.sales_sync_reverse s
 on s.owner_id=p_owner and j.owner_id=s.owner_id and j.ovoko_account=s.ovoko_account and j.allegro_seller_id=s.seller_id;
$$;
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
   from public.ovoko_single_publications j
   where j.owner_id=p_owner and j.ovoko_account=s.ovoko_account and j.allegro_seller_id=s.seller_id and j.part_id=e->>'partId' and j.state='created'
    and not exists(select 1 from public.ovoko_single_publications other where other.owner_id=j.owner_id and other.ovoko_account=j.ovoko_account and other.allegro_seller_id=j.allegro_seller_id and other.part_id=j.part_id and other.state='created' and other.allegro_offer_id<>j.allegro_offer_id)
   on conflict(owner_id,part_id,publication_hash) do update set
    state=case when sales_sync_reverse_actions.order_id<>excluded.order_id or excluded.state='review' then 'review' else sales_sync_reverse_actions.state end,
    diagnostic=case when sales_sync_reverse_actions.order_id<>excluded.order_id then 'multiple_orders' when excluded.state='review' then excluded.diagnostic else sales_sync_reverse_actions.diagnostic end;
 end loop;
 update public.sales_sync_reverse set last_checked_at=now(),last_error=null where owner_id=p_owner;
end $$;
revoke all on function public.reverse_sales_sync_coverage(uuid),public.ingest_reverse_sales_sync(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.reverse_sales_sync_coverage(uuid),public.ingest_reverse_sales_sync(uuid,uuid,uuid,jsonb) to service_role;
commit;
