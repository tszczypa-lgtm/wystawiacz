begin;
create or replace function public.apply_ovoko_manual_override(p_owner uuid,p_id uuid,p_kind text,p_account text,p_seller text,p_offer text,p_model text,p_year text,p_expected jsonb,p_found text,p_reason text,p_allegro text,p_ovoko text) returns setof public.ovoko_manual_overrides
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous jsonb; old_at timestamptz; done public.ovoko_manual_overrides; changed integer; generation text;
begin
 perform pg_advisory_xact_lock(190019);
 if p_kind is null or p_kind not in ('part','vehicle') or p_reason is null or char_length(p_reason) not between 10 and 1000 or p_offer is null or p_offer!~'^[0-9]{1,30}$' or jsonb_typeof(p_expected) is distinct from 'object' or p_found is not null and p_found!~'^[1-9][0-9]{0,11}$' then raise exception 'invalid manual override'; end if;
 select * into done from public.ovoko_manual_overrides where id=p_id;
 if found then
  if done.owner_id<>p_owner or done.kind<>p_kind or done.ovoko_account<>p_account or done.seller_id<>p_seller or done.offer_id<>p_offer or done.model_id is distinct from p_model or done.vehicle_year is distinct from p_year or done.reason<>p_reason then raise exception 'override id reused'; end if;
  return next done; return;
 end if;
 if not public.sync_account_lock(p_owner,p_seller,p_account,'claim') then raise exception 'physical account ownership conflict'; end if;
 if exists(select 1 from public.inventory_link_recovery where state='prepared' and expires_at>now() and (owner_id=p_owner or seller_id=p_seller or ovoko_account=p_account)) then raise exception 'link recovery pending'; end if;
 perform 1 from public.sales_sync where owner_id=p_owner for update;
 perform 1 from public.sales_sync_reverse where owner_id=p_owner for update;
 if p_found is null and (exists(select 1 from public.sales_sync where owner_id=p_owner and lease_until>now()) or exists(select 1 from public.sales_sync_reverse where owner_id=p_owner and lease_until>now())) then raise exception 'synchronization check in progress'; end if;
 if p_kind='part' and (exists(select 1 from public.sales_sync_actions where owner_id=p_owner and seller_id=p_seller and offer_id=p_offer and state in ('waiting','queued','preflight','running','submitted','uncertain')) or exists(select 1 from public.sales_sync_reverse_actions where owner_id=p_owner and offer_id=p_offer and state in ('queued','preflight','running','submitted','uncertain'))) then raise exception 'pending sale action for this offer'; end if;
 if not exists(select 1 from public.allegro_connections where owner_id=p_owner and sealed=p_allegro) or not exists(select 1 from public.ovoko_connections where owner_id=p_owner and sealed=p_ovoko) then raise exception 'connection changed'; end if;
 if p_kind='part' then
  select to_jsonb(j) into previous from public.ovoko_single_publications j where ovoko_account=p_account and allegro_seller_id=p_seller and allegro_offer_id=p_offer for update;
 else
  if p_model is null or p_model!~'^[1-9][0-9]{0,11}$' or p_year is null or p_year!~'^[12][0-9]{3}$' then raise exception 'invalid vehicle'; end if;
  select to_jsonb(j) into previous from public.ovoko_vehicle_creations j where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year for update;
 end if;
 if previous is null then
  if p_kind<>'part' or p_found is null or p_expected<>'{}'::jsonb then raise exception 'no lock or confirmed part to recover'; end if;
 else
  old_at=(previous->>'updated_at')::timestamptz;
  if p_found is null and old_at>now()-interval '30 minutes' then raise exception 'operation too recent'; end if;
  if previous->>'state' is distinct from p_expected->>'state' or previous->>'owner_id' is distinct from p_expected->>'owner_id' or old_at is distinct from (p_expected->>'updated_at')::timestamptz or previous->>'request_hash' is distinct from p_expected->>'request_hash' or previous->>'attempt_id' is distinct from p_expected->>'attempt_id' or previous->>'part_id' is distinct from p_expected->>'part_id' or previous->>'car_id' is distinct from p_expected->>'car_id' then raise exception 'operation changed'; end if;
  if p_kind='part' and p_found is not null and previous->>'part_id' is not null and previous->>'part_id'<>p_found then raise exception 'conflicting part ids'; end if;
 end if;
 generation=replace(p_id::text,'-','')||replace(p_id::text,'-','');
 insert into public.ovoko_manual_overrides(id,owner_id,kind,ovoko_account,seller_id,offer_id,model_id,vehicle_year,previous_row,found_id,action,reason,risk_accepted)
 values(p_id,p_owner,p_kind,p_account,p_seller,p_offer,p_model,p_year,coalesce(previous,'{}'::jsonb),p_found,case when p_found is null then 'released' else 'reconciled' end,p_reason,p_found is null);
 if p_kind='part' then
  if p_found is null then delete from public.ovoko_single_publications where ovoko_account=p_account and allegro_seller_id=p_seller and allegro_offer_id=p_offer;
  elsif previous is null then
   insert into public.ovoko_single_publications(owner_id,ovoko_account,allegro_seller_id,allegro_offer_id,part_id,request_hash,state,origin) values(p_owner,p_account,p_seller,p_offer,p_found,generation,'created','recovered') on conflict do nothing;
   get diagnostics changed=row_count; if changed<>1 then raise exception 'publication appeared concurrently'; end if;
  else update public.ovoko_single_publications set owner_id=p_owner,state='created',part_id=p_found,request_hash=case when previous->>'state'='created' and previous->>'owner_id'=p_owner::text and previous->>'part_id'=p_found then request_hash else generation end,updated_at=case when previous->>'state'='created' and previous->>'owner_id'=p_owner::text and previous->>'part_id'=p_found then updated_at else now() end where ovoko_account=p_account and allegro_seller_id=p_seller and allegro_offer_id=p_offer; end if;
 else
  if p_found is null then delete from public.ovoko_vehicle_creations where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year;
  else update public.ovoko_vehicle_creations set owner_id=p_owner,state='created',car_id=p_found,attempt_id=gen_random_uuid(),updated_at=now() where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year; end if;
 end if;
 return query select * from public.ovoko_manual_overrides where id=p_id;
end $$;
revoke all on function public.apply_ovoko_manual_override(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_ovoko_manual_override(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) to service_role;
commit;
