begin;
-- The server verifies provider absence and explicit consent; this never transfers synchronization ownership.
create or replace function public.release_stale_ovoko_attempt(p_owner uuid,p_id uuid,p_kind text,p_account text,p_seller text,p_offer text,p_model text,p_year text,p_expected jsonb,p_found text,p_reason text,p_allegro text,p_ovoko text) returns setof public.ovoko_manual_overrides
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous jsonb; done public.ovoko_manual_overrides; changed integer;
begin
 perform pg_advisory_xact_lock(190019);
 if p_owner is null or p_id is null or p_found is not null or p_kind is null or p_kind not in ('part','vehicle') or p_account is null or p_account!~'^[a-f0-9]{64}$' or p_seller is null or p_seller!~'^[0-9]{1,30}$' or p_offer is null or p_offer!~'^[0-9]{1,30}$' or p_reason is null or char_length(p_reason) not between 10 and 1000 or jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'invalid manual override'; end if;
 select * into done from public.ovoko_manual_overrides where id=p_id;
 if found then
  if done.owner_id<>p_owner or done.kind<>p_kind or done.ovoko_account<>p_account or done.seller_id<>p_seller or done.offer_id<>p_offer or done.model_id is distinct from p_model or done.vehicle_year is distinct from p_year or done.reason<>p_reason or done.action<>'released' then raise exception 'override id reused'; end if;
  return next done; return;
 end if;
 if not exists(select 1 from public.allegro_connections where owner_id=p_owner and sealed=p_allegro) or not exists(select 1 from public.ovoko_connections where owner_id=p_owner and sealed=p_ovoko) then raise exception 'connection changed'; end if;
 perform 1 from public.sales_sync where seller_id=p_seller or ovoko_account=p_account order by owner_id for update;
 perform 1 from public.sales_sync_reverse where seller_id=p_seller or ovoko_account=p_account order by owner_id for update;
 if exists(select 1 from public.sales_sync where (seller_id=p_seller or ovoko_account=p_account) and lease_until>now()) or exists(select 1 from public.sales_sync_reverse where (seller_id=p_seller or ovoko_account=p_account) and lease_until>now()) then raise exception 'synchronization check in progress'; end if;
 if exists(select 1 from public.sales_sync_actions where seller_id=p_seller and offer_id=p_offer and state in ('waiting','queued','preflight','running','submitted','uncertain')) or exists(select 1 from public.sales_sync_reverse_actions where offer_id=p_offer and state in ('queued','preflight','running','submitted','uncertain')) then raise exception 'pending sale action for this offer'; end if;
 if exists(select 1 from public.inventory_link_recovery where offer_id=p_offer and state='prepared' and expires_at>now() and (seller_id=p_seller or ovoko_account=p_account)) then raise exception 'link recovery pending'; end if;
 if p_kind='part' then
  select to_jsonb(j) into previous from public.ovoko_single_publications j where ovoko_account=p_account and allegro_seller_id=p_seller and allegro_offer_id=p_offer for update;
 else
  if p_model is null or p_model!~'^[1-9][0-9]{0,11}$' or p_year is null or p_year!~'^[12][0-9]{3}$' then raise exception 'invalid vehicle'; end if;
  select to_jsonb(j) into previous from public.ovoko_vehicle_creations j where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year for update;
 end if;
 if previous is null or previous->>'state' not in ('sending','uncertain','created') then raise exception 'no stale attempt to release'; end if;
 if (previous->>'updated_at')::timestamptz>now()-interval '30 minutes' then raise exception 'operation too recent'; end if;
 if previous->>'state' is distinct from p_expected->>'state' or previous->>'owner_id' is distinct from p_expected->>'owner_id' or (previous->>'updated_at')::timestamptz is distinct from (p_expected->>'updated_at')::timestamptz or previous->>'request_hash' is distinct from p_expected->>'request_hash' or previous->>'attempt_id' is distinct from p_expected->>'attempt_id' or previous->>'part_id' is distinct from p_expected->>'part_id' or previous->>'car_id' is distinct from p_expected->>'car_id' then raise exception 'operation changed'; end if;
 insert into public.ovoko_manual_overrides(id,owner_id,kind,ovoko_account,seller_id,offer_id,model_id,vehicle_year,previous_row,found_id,action,reason,risk_accepted) values(p_id,p_owner,p_kind,p_account,p_seller,p_offer,p_model,p_year,previous,null,'released',p_reason,true);
 if p_kind='part' then delete from public.ovoko_single_publications where ovoko_account=p_account and allegro_seller_id=p_seller and allegro_offer_id=p_offer;
 else delete from public.ovoko_vehicle_creations where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year; end if;
 get diagnostics changed=row_count; if changed<>1 then raise exception 'operation changed'; end if;
 return query select * from public.ovoko_manual_overrides where id=p_id;
end $$;
revoke all on function public.release_stale_ovoko_attempt(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.release_stale_ovoko_attempt(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) to service_role;
commit;
