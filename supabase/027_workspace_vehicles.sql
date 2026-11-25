begin;
create table if not exists public.workspace_vehicles (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  revision integer not null default 1 check(revision > 0),
  payload jsonb not null check(jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,id)
);
create index if not exists workspace_vehicles_recent on public.workspace_vehicles(owner_id,updated_at desc,id);
alter table public.workspace_vehicles enable row level security;
revoke all on public.workspace_vehicles from anon,authenticated;
grant select on public.workspace_vehicles to authenticated;
grant all on public.workspace_vehicles to service_role;
drop policy if exists workspace_vehicles_owner_read on public.workspace_vehicles;
create policy workspace_vehicles_owner_read on public.workspace_vehicles for select to authenticated using(owner_id=auth.uid());

create table if not exists public.workspace_vehicle_ovoko (
  owner_id uuid not null,
  vehicle_id uuid not null,
  ovoko_account text not null check(ovoko_account ~ '^[a-f0-9]{64}$'),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  state text not null check(state in ('sending','created','uncertain')),
  attempt_id uuid not null,
  car_id text check(car_id ~ '^[1-9][0-9]{0,11}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,vehicle_id,ovoko_account),
  foreign key(owner_id,vehicle_id) references public.workspace_vehicles(owner_id,id) on delete cascade,
  check(state <> 'created' or car_id is not null)
);
create unique index if not exists workspace_vehicle_ovoko_car on public.workspace_vehicle_ovoko(owner_id,ovoko_account,car_id) where car_id is not null;
alter table public.workspace_vehicle_ovoko enable row level security;
revoke all on public.workspace_vehicle_ovoko from anon,authenticated;
grant select on public.workspace_vehicle_ovoko to authenticated;
grant all on public.workspace_vehicle_ovoko to service_role;
drop policy if exists workspace_vehicle_ovoko_owner_read on public.workspace_vehicle_ovoko;
create policy workspace_vehicle_ovoko_owner_read on public.workspace_vehicle_ovoko for select to authenticated using(owner_id=auth.uid());
create or replace function public.guard_workspace_vehicle_ovoko() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.payload->'ovoko' is distinct from new.payload->'ovoko' and exists(select 1 from public.workspace_vehicle_ovoko where owner_id=old.owner_id and vehicle_id=old.id) then
  raise exception 'Linked vehicle technical data is immutable';
 end if;
 return new;
end $$;
drop trigger if exists guard_workspace_vehicle_ovoko on public.workspace_vehicles;
create trigger guard_workspace_vehicle_ovoko before update on public.workspace_vehicles for each row execute function public.guard_workspace_vehicle_ovoko();
create or replace function public.reserve_workspace_vehicle(p_owner uuid,p_vehicle uuid,p_payload jsonb,p_account text,p_hash text,p_attempt uuid)
returns setof public.workspace_vehicle_ovoko language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.workspace_vehicles;
begin
 select * into v from public.workspace_vehicles where owner_id=p_owner and id=p_vehicle for update;
 if not found or v.payload is distinct from p_payload then return; end if;
 return query insert into public.workspace_vehicle_ovoko(owner_id,vehicle_id,ovoko_account,request_hash,state,attempt_id)
 values(p_owner,p_vehicle,p_account,p_hash,'sending',p_attempt) on conflict do nothing returning *;
end $$;
revoke all on function public.reserve_workspace_vehicle(uuid,uuid,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_workspace_vehicle(uuid,uuid,jsonb,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
