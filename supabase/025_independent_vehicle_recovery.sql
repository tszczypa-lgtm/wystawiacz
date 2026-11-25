begin;
alter table public.ovoko_vehicle_creations add column if not exists attempt_id uuid not null default gen_random_uuid();
create table if not exists public.ovoko_manual_overrides (
 id uuid primary key, owner_id uuid not null references auth.users(id), kind text not null check(kind in ('part','vehicle')),
 ovoko_account text not null, seller_id text not null, offer_id text not null, model_id text, vehicle_year text,
 previous_row jsonb not null, found_id text, action text not null check(action in ('released','reconciled')),
 reason text not null check(char_length(reason) between 10 and 1000), risk_accepted boolean not null default true, created_at timestamptz not null default now()
);
alter table public.ovoko_manual_overrides enable row level security;
revoke all on public.ovoko_manual_overrides from public,anon,authenticated;
grant select,insert on public.ovoko_manual_overrides to service_role;
grant delete on public.ovoko_vehicle_creations to service_role;
create or replace function public.release_ovoko_vehicle_attempt(p_owner uuid,p_id uuid,p_kind text,p_account text,p_seller text,p_offer text,p_model text,p_year text,p_expected jsonb,p_found text,p_reason text,p_allegro text,p_ovoko text) returns setof public.ovoko_manual_overrides
language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous jsonb; done public.ovoko_manual_overrides; changed integer;
begin
 perform pg_advisory_xact_lock(190019);
 if p_owner is null or p_id is null or p_kind is distinct from 'vehicle' or p_found is not null or p_account is null or p_account!~'^[a-f0-9]{64}$' or p_seller is null or p_seller!~'^[0-9]{1,30}$' or p_offer is null or p_offer!~'^[0-9]{1,30}$' or p_model is null or p_model!~'^[1-9][0-9]{0,11}$' or p_year is null or p_year!~'^[12][0-9]{3}$' or p_reason is null or char_length(p_reason) not between 10 and 1000 or jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'invalid vehicle override'; end if;
 select * into done from public.ovoko_manual_overrides where id=p_id;
 if found then
  if done.owner_id<>p_owner or done.kind<>'vehicle' or done.ovoko_account<>p_account or done.seller_id<>p_seller or done.offer_id<>p_offer or done.model_id is distinct from p_model or done.vehicle_year is distinct from p_year or done.reason<>p_reason or done.action<>'released' then raise exception 'override id reused'; end if;
  return next done; return;
 end if;
 if not exists(select 1 from public.allegro_connections where owner_id=p_owner and sealed=p_allegro) or not exists(select 1 from public.ovoko_connections where owner_id=p_owner and sealed=p_ovoko) then raise exception 'connection changed'; end if;
 select to_jsonb(j) into previous from public.ovoko_vehicle_creations j where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year for update;
 if previous is null or previous->>'state' not in ('sending','uncertain','created') then raise exception 'no stale attempt to release'; end if;
 if previous->>'state'='sending' and (previous->>'updated_at')::timestamptz>now()-interval '5 minutes' then raise exception 'vehicle operation in progress'; end if;
 if previous->>'state' is distinct from p_expected->>'state' or previous->>'owner_id' is distinct from p_expected->>'owner_id' or (previous->>'updated_at')::timestamptz is distinct from (p_expected->>'updated_at')::timestamptz or previous->>'attempt_id' is distinct from p_expected->>'attempt_id' or previous->>'car_id' is distinct from p_expected->>'car_id' then raise exception 'operation changed'; end if;
 insert into public.ovoko_manual_overrides(id,owner_id,kind,ovoko_account,seller_id,offer_id,model_id,vehicle_year,previous_row,found_id,action,reason,risk_accepted) values(p_id,p_owner,'vehicle',p_account,p_seller,p_offer,p_model,p_year,previous,null,'released',p_reason,true);
 delete from public.ovoko_vehicle_creations where ovoko_account=p_account and model_id=p_model and vehicle_year=p_year;
 get diagnostics changed=row_count; if changed<>1 then raise exception 'operation changed'; end if;
 return query select * from public.ovoko_manual_overrides where id=p_id;
end $$;
revoke all on function public.release_ovoko_vehicle_attempt(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.release_ovoko_vehicle_attempt(uuid,uuid,text,text,text,text,text,text,jsonb,text,text,text,text) to service_role;
commit;
