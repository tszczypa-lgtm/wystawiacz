begin;

do $$
declare required text;
begin
 foreach required in array array['ovoko_single_publications','sales_sync','sales_sync_actions','sales_sync_reverse','sales_sync_reverse_actions','sales_sync_accounts','inventory_operations'] loop
  if to_regclass('public.'||required) is null then
   raise exception 'Brak tabeli public.%. Najpierw uzupelnij schemat 012, 016, 017, 018, 019 i 022. Zmiana 026 zostanie wycofana w calosci.',required;
  end if;
 end loop;
end $$;

create table if not exists public.ovoko_stock_groups (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 ovoko_account text not null check(ovoko_account ~ '^[a-f0-9]{64}$'),
 seller_id text not null check(seller_id ~ '^[0-9]{1,30}$'),
 offer_id text not null check(offer_id ~ '^[0-9]{1,30}$'),
 quantity integer not null check(quantity between 2 and 10000),
 mode text not null default 'separate' check(mode in ('separate','shared')), paused boolean not null default false,
 created_at timestamptz not null default now(), unique(ovoko_account,seller_id,offer_id)
);
create table if not exists public.ovoko_stock_units (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.ovoko_stock_groups(id),
 ovoko_account text not null check(ovoko_account ~ '^[a-f0-9]{64}$'),
 ordinal integer not null check(ordinal between 1 and 10000), external_id text not null,
 state text not null default 'pending' check(state in ('pending','sending','created','uncertain')),
 part_id text check(part_id ~ '^[1-9][0-9]{0,11}$'), request_hash text check(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(group_id,ordinal), unique(ovoko_account,external_id), unique(ovoko_account,part_id),
 check(state <> 'created' or (part_id is not null and request_hash is not null))
);
create table if not exists public.ovoko_stock_events (
 id uuid primary key default gen_random_uuid(), group_id uuid not null references public.ovoko_stock_groups(id),
 direction text not null check(direction in ('allegro','ovoko')), reference text not null check(length(reference)>0),
 order_id text, item_id text, quantity integer not null check(quantity between 1 and 10000),
 bought_at timestamptz, state text not null check(state in ('queued','waiting','cancelled','review')),
 diagnostic text, created_at timestamptz not null default now(), unique(group_id,direction,reference)
);
create table if not exists public.ovoko_stock_actions (
 id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.ovoko_stock_units(id),
 event_id uuid not null references public.ovoko_stock_events(id),
 state text not null default 'queued' check(state in ('queued','preflight','running','submitted','done','review','uncertain')),
 diagnostic text, checked_at timestamptz, created_at timestamptz not null default now(),
 command_kind text check(command_kind in ('quantity','end')), command_payload jsonb,
 quantity_done boolean not null default false, allocation_released boolean not null default false,
 end_command_id uuid not null default gen_random_uuid(),
 end_state text not null default 'pending' check(end_state in ('pending','running','submitted','uncertain','done')),
 relist_state text not null default 'pending' check(relist_state in ('pending','running','submitted','uncertain','done')),
 unique(event_id,unit_id)
);
create index if not exists ovoko_stock_actions_unit on public.ovoko_stock_actions(unit_id);
create index if not exists ovoko_stock_actions_claim on public.ovoko_stock_actions(state,checked_at,created_at);
create index if not exists ovoko_stock_events_group on public.ovoko_stock_events(group_id,direction);

alter table public.ovoko_stock_groups enable row level security;
alter table public.ovoko_stock_units enable row level security;
alter table public.ovoko_stock_events enable row level security;
alter table public.ovoko_stock_actions enable row level security;
revoke all on public.ovoko_stock_groups,public.ovoko_stock_units,public.ovoko_stock_events,public.ovoko_stock_actions from public,anon,authenticated;
grant select,insert,update on public.ovoko_stock_groups,public.ovoko_stock_units,public.ovoko_stock_events,public.ovoko_stock_actions to service_role;

-- The same lock is used by account handover and both publication journals.
create or replace function public.ovoko_stock_group_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if tg_op='UPDATE' and (new.id,new.owner_id,new.ovoko_account,new.seller_id,new.offer_id,new.quantity,new.mode,new.created_at)
  is distinct from (old.id,old.owner_id,old.ovoko_account,old.seller_id,old.offer_id,old.quantity,old.mode,old.created_at) then
  raise exception 'stock group identity is immutable';
 end if;
 if exists(select 1 from public.ovoko_single_publications where ovoko_account=new.ovoko_account
  and allegro_seller_id=new.seller_id and allegro_offer_id=new.offer_id) then raise exception 'legacy publication exists'; end if;
 return new;
end $$;
drop trigger if exists ovoko_stock_group_guard on public.ovoko_stock_groups;
create trigger ovoko_stock_group_guard before insert or update on public.ovoko_stock_groups for each row execute function public.ovoko_stock_group_guard();

create or replace function public.ovoko_stock_legacy_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if exists(select 1 from public.ovoko_stock_groups where ovoko_account=new.ovoko_account
  and seller_id=new.allegro_seller_id and offer_id=new.allegro_offer_id) then raise exception 'stock group exists'; end if;
 if new.part_id is not null and exists(select 1 from public.ovoko_stock_units where ovoko_account=new.ovoko_account and part_id=new.part_id) then
  raise exception 'stock part already linked'; end if;
 return new;
end $$;
drop trigger if exists ovoko_stock_legacy_guard on public.ovoko_single_publications;
create trigger ovoko_stock_legacy_guard before insert or update on public.ovoko_single_publications for each row execute function public.ovoko_stock_legacy_guard();

create or replace function public.ovoko_stock_unit_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.ovoko_stock_groups;
begin
 perform pg_advisory_xact_lock(190019);
 select * into strict g from public.ovoko_stock_groups where id=new.group_id;
 if g.paused and new.state='sending' then raise exception 'stock publication paused'; end if;
 if new.ovoko_account<>g.ovoko_account or new.ordinal>(case when g.mode='shared' then 1 else g.quantity end)
  or new.external_id<>'tymo:'||g.seller_id||':'||g.offer_id||':u:'||new.ordinal then raise exception 'invalid stock unit binding'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.group_id,new.ovoko_account,new.ordinal,new.external_id,new.created_at) is distinct from
   (old.id,old.group_id,old.ovoko_account,old.ordinal,old.external_id,old.created_at) then raise exception 'stock unit identity is immutable'; end if;
  if old.state='created' and (new.state,new.part_id,new.request_hash) is distinct from (old.state,old.part_id,old.request_hash) then
   raise exception 'confirmed stock unit is immutable'; end if;
  new.updated_at:=now();
 end if;
 if new.part_id is not null and exists(select 1 from public.ovoko_single_publications where ovoko_account=new.ovoko_account and part_id=new.part_id) then
  raise exception 'legacy part already linked'; end if;
 return new;
end $$;
drop trigger if exists ovoko_stock_unit_guard on public.ovoko_stock_units;
create trigger ovoko_stock_unit_guard before insert or update on public.ovoko_stock_units for each row execute function public.ovoko_stock_unit_guard();

create or replace function public.prepare_ovoko_stock_group(p_owner uuid,p_account text,p_seller text,p_offer text,p_quantity integer,p_mode text default 'separate')
returns setof public.ovoko_stock_groups language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.ovoko_stock_groups;
begin
 perform pg_advisory_xact_lock(190019);
 select * into g from public.ovoko_stock_groups where ovoko_account=p_account and seller_id=p_seller and offer_id=p_offer for update;
 if found then
  if g.owner_id is distinct from p_owner or g.quantity is distinct from p_quantity or g.mode is distinct from p_mode then raise exception 'stock group replay mismatch'; end if;
 else
  insert into public.ovoko_stock_groups(owner_id,ovoko_account,seller_id,offer_id,quantity,mode)
   values(p_owner,p_account,p_seller,p_offer,p_quantity,p_mode) returning * into g;
  insert into public.ovoko_stock_units(group_id,ovoko_account,ordinal,external_id)
   select g.id,g.ovoko_account,n,'tymo:'||g.seller_id||':'||g.offer_id||':u:'||n
   from generate_series(1,case when g.mode='shared' then 1 else g.quantity end) n;
 end if;
 return next g;
end $$;

-- Validate subscription and physical ownership under the account-handover lock.
create or replace function public.ovoko_stock_binding(p_owner uuid,p_direction text,p_epoch uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s jsonb;
begin
 perform pg_advisory_xact_lock(190019);
 if p_direction='allegro' then
  select to_jsonb(t) into s from public.sales_sync t where owner_id=p_owner for update;
 elsif p_direction='ovoko' then
  select to_jsonb(t) into s from public.sales_sync_reverse t where owner_id=p_owner for update;
 else raise exception 'invalid stock direction'; end if;
 if s is null or not (s->>'enabled')::boolean or (s->>'epoch')::uuid is distinct from p_epoch
  or p_lease is null or (s->>'lease')::uuid is distinct from p_lease or s->>'lease_until' is null
  or (s->>'lease_until')::timestamptz<=now() then raise exception 'stock sync lease changed'; end if;
 if not exists(select 1 from public.sales_sync_accounts where owner_id=p_owner and seller_id=s->>'seller_id' and ovoko_account=s->>'ovoko_account') then
  raise exception 'stock sync ownership changed'; end if;
 return s;
end $$;

create or replace function public.ovoko_stock_action_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare g public.ovoko_stock_groups; e public.ovoko_stock_events; u public.ovoko_stock_units;
begin
 perform pg_advisory_xact_lock(190019);
 select * into strict u from public.ovoko_stock_units where id=new.unit_id;
 select * into strict g from public.ovoko_stock_groups where id=u.group_id;
 select * into strict e from public.ovoko_stock_events where id=new.event_id;
 if e.group_id<>g.id or u.state<>'created' then raise exception 'invalid action binding'; end if;
 if tg_op='INSERT' and new.allocation_released then raise exception 'new allocation cannot be released'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.unit_id,new.event_id,new.end_command_id,new.created_at) is distinct from
   (old.id,old.unit_id,old.event_id,old.end_command_id,old.created_at) then raise exception 'action identity is immutable'; end if;
  if old.quantity_done and not new.quantity_done then raise exception 'quantity phase cannot reset'; end if;
  if old.allocation_released and (not new.allocation_released or new.state<>'review' or new.quantity_done
   or new.end_state<>'pending' or new.relist_state<>'pending'
   or (new.command_kind,new.command_payload) is distinct from (old.command_kind,old.command_payload)) then raise exception 'released allocation cannot execute'; end if;
  if new.allocation_released and not old.allocation_released then raise exception 'allocation release is automatic only'; end if;
  if old.state in ('queued','preflight') and new.state='review' and not old.quantity_done and not new.quantity_done
   and old.end_state='pending' and old.relist_state='pending' and new.end_state='pending' and new.relist_state='pending' then
   new.allocation_released:=true;
  end if;
  if old.state<>'queued' and new.state='queued' then raise exception 'action cannot replay'; end if;
  if old.end_state<>'pending' and new.end_state='pending' or old.relist_state<>'pending' and new.relist_state='pending' then raise exception 'mutation phase cannot reset'; end if;
 end if;
 if g.mode='separate' and not new.allocation_released and exists(select 1 from public.ovoko_stock_actions where unit_id=new.unit_id and id<>new.id and not allocation_released) then
  raise exception 'physical unit already consumed'; end if;
 if (new.state in ('queued','preflight') or (tg_op='UPDATE' and ((new.state='running' and old.state<>'running')
  or (new.relist_state='running' and old.relist_state<>'running') or (new.end_state='running' and old.end_state<>'running'))))
  and e.state<>'queued' then raise exception 'event is not executable'; end if;
 if ((tg_op='INSERT' and new.state in ('preflight','running')) or (tg_op='UPDATE' and (
  (new.state in ('preflight','running') and new.state is distinct from old.state)
  or (new.end_state='running' and old.end_state<>'running') or (new.relist_state='running' and old.relist_state<>'running'))))
  and (g.paused or exists(select 1 from public.inventory_operations i
  where i.ovoko_account=g.ovoko_account and i.seller_id=g.seller_id and i.state='running'
   and (i.offer_id=g.offer_id or i.part_id=u.part_id))) then raise exception 'manual stock operation blocks mutation'; end if;
 if (new.state in ('preflight','running','submitted','uncertain') or new.end_state in ('running','submitted','uncertain')
  or new.relist_state in ('running','submitted','uncertain')) and exists(
  select 1 from public.ovoko_stock_actions a join public.ovoko_stock_units v on v.id=a.unit_id
  where v.group_id=g.id and a.id<>new.id and (a.state in ('preflight','running','submitted','uncertain')
   or a.end_state in ('running','submitted','uncertain') or a.relist_state in ('running','submitted','uncertain'))) then
  raise exception 'stock group action already active'; end if;
 return new;
end $$;
drop trigger if exists ovoko_stock_action_guard on public.ovoko_stock_actions;
create trigger ovoko_stock_action_guard before insert or update on public.ovoko_stock_actions for each row execute function public.ovoko_stock_action_guard();

create or replace function public.ingest_ovoko_stock_forward(p_owner uuid,p_epoch uuid,p_lease uuid,p_evidence jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s jsonb; r jsonb; g public.ovoko_stock_groups; e public.ovoko_stock_events;
 b timestamptz; q integer; needed integer; ids uuid[]; ord text;
begin
 s:=public.ovoko_stock_binding(p_owner,'allegro',p_epoch,p_lease);
 if p_evidence is null or jsonb_typeof(p_evidence)<>'array' then raise exception 'invalid evidence'; end if;
 if jsonb_array_length(p_evidence)>5000 then raise exception 'too much evidence'; end if;
 for r in select value from jsonb_array_elements(p_evidence) loop
  if r->>'kind' not in ('purchase','cancelled') then continue; end if;
  if nullif(r->>'itemId','') is null then raise exception 'missing line item'; end if;
  for g in select * from public.ovoko_stock_groups t where t.owner_id=p_owner and t.ovoko_account=s->>'ovoko_account'
   and t.seller_id=s->>'seller_id' and (t.offer_id=r->>'listingId' or (r->>'kind'='cancelled' and exists(
    select 1 from public.ovoko_stock_events x where x.group_id=t.id and x.direction='allegro' and x.reference=r->>'itemId')))
   order by t.id for update loop
   if r->>'kind'='cancelled' then
    insert into public.ovoko_stock_events(group_id,direction,reference,item_id,quantity,state,diagnostic)
     values(g.id,'allegro',r->>'itemId',r->>'itemId',1,'cancelled','cancelled_no_relist')
     on conflict(group_id,direction,reference) do update set state='cancelled',diagnostic='cancelled_no_relist' returning * into e;
    update public.ovoko_stock_actions set state='review',diagnostic='cancelled_no_relist' where event_id=e.id and state in ('queued','preflight');
    continue;
   end if;
   b:=null;
   begin b:=nullif(r->>'boughtAt','')::timestamptz; exception when invalid_datetime_format or datetime_field_overflow then b:=null; end;
   if b is not null and (b<(s->>'armed_at')::timestamptz or b<g.created_at) then continue; end if;
   if coalesce(r->>'quantity','')!~'^[0-9]{1,5}$' then raise exception 'invalid purchase quantity'; end if;
   q:=(r->>'quantity')::integer;
   if q not between 1 and 10000 then raise exception 'invalid purchase quantity'; end if;
   ord:=nullif(r->>'orderId','');
   insert into public.ovoko_stock_events(group_id,direction,reference,item_id,order_id,quantity,bought_at,state,diagnostic)
    values(g.id,'allegro',r->>'itemId',r->>'itemId',ord,q,b,
     case when b is null then 'review' when ord is null then 'waiting' else 'queued' end,
     case when b is null then 'missing_purchase_time' end)
    on conflict(group_id,direction,reference) do nothing;
   select * into strict e from public.ovoko_stock_events where group_id=g.id and direction='allegro' and reference=r->>'itemId' for update;
   if e.state='cancelled' then continue; end if;
   if g.paused then
    update public.ovoko_stock_events set state='review',diagnostic='manual_stock_pause' where id=e.id;
    update public.ovoko_stock_actions set state='review',diagnostic='manual_stock_pause' where event_id=e.id and state in ('queued','preflight');
    continue;
   end if;
   if e.quantity is distinct from q or e.bought_at is distinct from b or (e.order_id is not null and ord is not null and e.order_id<>ord) then
    update public.ovoko_stock_events set state='review',diagnostic='purchase_evidence_changed' where id=e.id;
    update public.ovoko_stock_actions set state='review',diagnostic='purchase_evidence_changed' where event_id=e.id and state in ('queued','preflight');
    continue;
   end if;
   if e.state='waiting' and ord is not null then
    update public.ovoko_stock_events set order_id=ord,state='queued' where id=e.id returning * into e;
   end if;
   if e.state<>'queued' or exists(select 1 from public.ovoko_stock_actions where event_id=e.id) then continue; end if;
   needed:=case when g.mode='shared' then 1 else q end;
   select array_agg(v.id order by v.ordinal) into ids from (
    select u.id,u.ordinal from public.ovoko_stock_units u where u.group_id=g.id and u.state='created' and u.updated_at<=b
     and (g.mode='shared' or not exists(select 1 from public.ovoko_stock_actions a where a.unit_id=u.id and not a.allocation_released))
     order by u.ordinal limit needed for update
   ) v;
   if coalesce(cardinality(ids),0)<>needed then
    update public.ovoko_stock_events set state='review',diagnostic='insufficient_confirmed_units' where id=e.id;
    continue;
   end if;
   insert into public.ovoko_stock_actions(unit_id,event_id) select unnest(ids),e.id;
  end loop;
 end loop;
end $$;

create or replace function public.ingest_ovoko_stock_reverse(p_owner uuid,p_epoch uuid,p_lease uuid,p_rows jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s jsonb; r jsonb; g public.ovoko_stock_groups; u public.ovoko_stock_units;
 e public.ovoko_stock_events; d date; reason text;
begin
 s:=public.ovoko_stock_binding(p_owner,'ovoko',p_epoch,p_lease);
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'invalid rows'; end if;
 if jsonb_array_length(p_rows)>5000 then raise exception 'too many rows'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if nullif(r->>'orderId','') is null or nullif(r->>'partId','') is null then raise exception 'missing reverse identity'; end if;
  if (s->'baseline') ? (r->>'orderId') then continue; end if;
  select v.* into u from public.ovoko_stock_units v join public.ovoko_stock_groups t on t.id=v.group_id
   where t.owner_id=p_owner and t.seller_id=s->>'seller_id' and t.ovoko_account=s->>'ovoko_account'
    and v.part_id=r->>'partId' and v.state='created' for update of v;
  if not found then continue; end if;
  select * into strict g from public.ovoko_stock_groups where id=u.group_id for update;
  -- Ovoko timestamps are not necessarily zoned or parseable. Baseline is authoritative.
  d:=null;
  if left(coalesce(r->>'date',''),10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   begin d:=left(r->>'date',10)::date; exception when invalid_datetime_format or datetime_field_overflow then d:=null; end;
  end if;
  if d is not null and d<(g.created_at at time zone 'UTC')::date then continue; end if;
  reason:=null;
  if r->>'status' is distinct from 'NEW' then reason:='order_status_not_supported:'||coalesce(r->>'status','missing'); end if;
  if r->>'external' is not null and r->>'external'<>u.external_id then reason:='external_id_mismatch'; end if;
  if g.paused then reason:='manual_stock_pause'; end if;
  insert into public.ovoko_stock_events(group_id,direction,reference,order_id,quantity,state,diagnostic)
   values(g.id,'ovoko',(r->>'orderId')||':'||(r->>'partId'),r->>'orderId',1,case when reason is null then 'queued' else 'review' end,reason)
   on conflict(group_id,direction,reference) do nothing;
  select * into strict e from public.ovoko_stock_events where group_id=g.id and direction='ovoko'
   and reference=(r->>'orderId')||':'||(r->>'partId') for update;
  if reason is not null then
   update public.ovoko_stock_events set state='review',diagnostic=reason where id=e.id;
   update public.ovoko_stock_actions set state='review',diagnostic=reason where event_id=e.id and state in ('queued','preflight');
   continue;
  end if;
  if e.state<>'queued' or exists(select 1 from public.ovoko_stock_actions where event_id=e.id) then continue; end if;
  if g.mode='separate' and exists(select 1 from public.ovoko_stock_actions where unit_id=u.id and not allocation_released) then
   update public.ovoko_stock_events set state='review',diagnostic='physical_unit_already_consumed' where id=e.id;
   continue;
  end if;
  insert into public.ovoko_stock_actions(unit_id,event_id) values(u.id,e.id);
 end loop;
end $$;

create or replace function public.ingest_sales_sync_with_stock(p_owner uuid,p_epoch uuid,p_lease uuid,p_cursor text,p_next text,p_caught_up boolean,p_evidence jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.ingest_ovoko_stock_forward(p_owner,p_epoch,p_lease,p_evidence);
 perform public.ingest_sales_sync(p_owner,p_epoch,p_lease,p_cursor,p_next,p_caught_up,p_evidence);
end $$;
create or replace function public.ingest_reverse_sales_sync_with_stock(p_owner uuid,p_epoch uuid,p_lease uuid,p_rows jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform public.ingest_ovoko_stock_reverse(p_owner,p_epoch,p_lease,p_rows);
 perform public.ingest_reverse_sales_sync(p_owner,p_epoch,p_lease,p_rows);
end $$;

create or replace function public.claim_ovoko_stock_action(p_owner uuid,p_direction text,p_epoch uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s jsonb; a public.ovoko_stock_actions; u public.ovoko_stock_units; g public.ovoko_stock_groups;
 e public.ovoko_stock_events; executable boolean;
begin
 s:=public.ovoko_stock_binding(p_owner,p_direction,p_epoch,p_lease);
 select v.* into a from public.ovoko_stock_actions v join public.ovoko_stock_units t on t.id=v.unit_id
  join public.ovoko_stock_groups x on x.id=t.group_id join public.ovoko_stock_events y on y.id=v.event_id
  where x.owner_id=p_owner and x.ovoko_account=s->>'ovoko_account' and x.seller_id=s->>'seller_id' and y.direction=p_direction
  and (v.state in ('preflight','running','submitted','uncertain') or (v.state='queued' and y.state='queued' and not x.paused
   and not exists(select 1 from public.inventory_operations i where i.ovoko_account=x.ovoko_account and i.seller_id=x.seller_id
    and i.state='running' and (i.offer_id=x.offer_id or i.part_id=t.part_id)) and not exists(
   select 1 from public.ovoko_stock_actions other join public.ovoko_stock_units ou on ou.id=other.unit_id
    where ou.group_id=x.id and other.id<>v.id and (other.state in ('preflight','running','submitted','uncertain')
     or other.end_state in ('running','submitted','uncertain') or other.relist_state in ('running','submitted','uncertain')))))
  order by v.checked_at nulls first,v.created_at,v.id limit 1 for update of v skip locked;
 if not found then return null; end if;
 executable:=a.state='queued';
 update public.ovoko_stock_actions set state=case when executable then 'preflight' else state end,checked_at=clock_timestamp() where id=a.id returning * into a;
 select * into strict u from public.ovoko_stock_units where id=a.unit_id;
 select * into strict g from public.ovoko_stock_groups where id=u.group_id;
 select * into strict e from public.ovoko_stock_events where id=a.event_id;
 return jsonb_build_object('action',to_jsonb(a),'unit',to_jsonb(u),'group',to_jsonb(g),'event',to_jsonb(e),'executable',executable);
end $$;

-- A pending manual operation also prevents a new sync claim (and vice versa).
create or replace function public.ovoko_stock_inventory_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if new.state='running' and exists(select 1 from public.ovoko_stock_units u join public.ovoko_stock_groups g on g.id=u.group_id
  where g.ovoko_account=new.ovoko_account and g.seller_id=new.seller_id
   and (g.offer_id=new.offer_id or exists(select 1 from public.ovoko_stock_units v where v.group_id=g.id and v.part_id=new.part_id))
   and u.state in ('sending','uncertain')) then raise exception 'stock publication unresolved'; end if;
 if new.kind='reserve' and exists(select 1 from public.ovoko_stock_groups g where g.ovoko_account=new.ovoko_account
  and g.seller_id=new.seller_id and (g.offer_id=new.offer_id or exists(select 1 from public.ovoko_stock_units u where u.group_id=g.id and u.part_id=new.part_id))) then
  raise exception 'stock group cannot be manually reserved'; end if;
 if new.kind='withdraw' and new.state='running' then
  update public.ovoko_stock_groups g set paused=true where g.ovoko_account=new.ovoko_account and g.seller_id=new.seller_id
   and (g.offer_id=new.offer_id or exists(select 1 from public.ovoko_stock_units u where u.group_id=g.id and u.part_id=new.part_id));
  update public.ovoko_stock_events e set state='review',diagnostic='manual_stock_pause'
   from public.ovoko_stock_groups g where e.group_id=g.id and g.paused and g.ovoko_account=new.ovoko_account and g.seller_id=new.seller_id
    and (g.offer_id=new.offer_id or exists(select 1 from public.ovoko_stock_units u where u.group_id=g.id and u.part_id=new.part_id)) and e.state in ('queued','waiting');
  update public.ovoko_stock_actions a set state='review',diagnostic='manual_stock_pause'
   from public.ovoko_stock_units u join public.ovoko_stock_groups g on g.id=u.group_id
   where a.unit_id=u.id and g.paused and g.ovoko_account=new.ovoko_account and g.seller_id=new.seller_id
    and (g.offer_id=new.offer_id or exists(select 1 from public.ovoko_stock_units v where v.group_id=g.id and v.part_id=new.part_id)) and a.state in ('queued','preflight');
 end if;
 if new.state='running' and exists(
  select 1 from public.ovoko_stock_actions a join public.ovoko_stock_units u on u.id=a.unit_id join public.ovoko_stock_groups g on g.id=u.group_id
  where g.ovoko_account=new.ovoko_account and g.seller_id=new.seller_id and (u.part_id=new.part_id or g.offer_id=new.offer_id)
   and (a.state in ('preflight','running','submitted','uncertain') or a.end_state in ('running','submitted','uncertain')
    or a.relist_state in ('running','submitted','uncertain'))) then raise exception 'stock sync action unresolved'; end if;
 return new;
end $$;
drop trigger if exists ovoko_stock_inventory_guard on public.inventory_operations;
create trigger ovoko_stock_inventory_guard before insert or update on public.inventory_operations for each row execute function public.ovoko_stock_inventory_guard();

create or replace function public.ovoko_stock_account_release_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if exists(select 1 from public.ovoko_stock_actions a join public.ovoko_stock_units u on u.id=a.unit_id
  join public.ovoko_stock_groups g on g.id=u.group_id where g.owner_id=old.owner_id and g.ovoko_account=old.ovoko_account
   and g.seller_id=old.seller_id and (a.state in ('queued','preflight','running','submitted','uncertain')
    or a.end_state in ('running','submitted','uncertain') or a.relist_state in ('running','submitted','uncertain'))) then
  raise exception 'stock actions prevent account release'; end if;
 return old;
end $$;
drop trigger if exists ovoko_stock_account_release_guard on public.sales_sync_accounts;
create trigger ovoko_stock_account_release_guard before delete on public.sales_sync_accounts for each row execute function public.ovoko_stock_account_release_guard();

create or replace function public.ovoko_stock_transfer_status(p_owner uuid,p_account text,p_seller text,p_offers jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if p_offers is null or jsonb_typeof(p_offers)<>'array' then raise exception 'invalid offers'; end if;
 if jsonb_array_length(p_offers)>200 or exists(select 1 from jsonb_array_elements(p_offers) v where jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^[0-9]{1,30}$') then
  raise exception 'invalid offers'; end if;
 select coalesce(jsonb_object_agg(t.offer_id,t.summary),'{}'::jsonb) into result from (
  select g.offer_id,jsonb_strip_nulls(jsonb_build_object('state',case when count(u.id) filter(where u.state='created')=case when g.mode='shared' then 1 else g.quantity end then 'transferred'
   when bool_or(u.state='uncertain') then 'uncertain' else 'sending' end,
   'partId',(array_agg(u.part_id order by u.ordinal) filter(where u.state='created'))[1],
   'partIds',coalesce(jsonb_agg(u.part_id order by u.ordinal) filter(where u.state='created'),'[]'::jsonb),
   'totalUnits',case when g.mode='shared' then 1 else g.quantity end,'completedUnits',count(u.id) filter(where u.state='created'),'stockMode',g.mode)) summary
  from public.ovoko_stock_groups g left join public.ovoko_stock_units u on u.group_id=g.id
  where g.owner_id=p_owner and g.ovoko_account=p_account and g.seller_id=p_seller and p_offers ? g.offer_id group by g.id
 ) t;
 return result;
end $$;

create or replace function public.ovoko_stock_sync_status(p_owner uuid,p_direction text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare s jsonb; result jsonb;
begin
 if p_direction='allegro' then select to_jsonb(t) into s from public.sales_sync t where owner_id=p_owner;
 elsif p_direction='ovoko' then select to_jsonb(t) into s from public.sales_sync_reverse t where owner_id=p_owner;
 else raise exception 'invalid stock direction'; end if;
 with groups as (select * from public.ovoko_stock_groups where owner_id=p_owner and ovoko_account=s->>'ovoko_account' and seller_id=s->>'seller_id'),
 events as (select e.* from public.ovoko_stock_events e join groups g on g.id=e.group_id where e.direction=p_direction),
 actions as (select a.*,e.group_id from public.ovoko_stock_actions a join events e on e.id=a.event_id),
 recent as (select a.id,g.offer_id,u.part_id,a.state,a.diagnostic,a.created_at from actions a
  join groups g on g.id=a.group_id join public.ovoko_stock_units u on u.id=a.unit_id
  union all select e.id,g.offer_id,null::text,e.state,e.diagnostic,e.created_at from events e join groups g on g.id=e.group_id
   where e.state='review' and not exists(select 1 from actions a where a.event_id=e.id))
 select jsonb_build_object('groups',(select count(*) from groups),'paused',(select count(*) from groups where paused),
  'units',(select count(*) from public.ovoko_stock_units u join groups g on g.id=u.group_id where u.state='created'),
  'pending',(select count(*) from actions where state in ('queued','preflight','running','submitted','uncertain')),
  'review',(select count(*) from actions where state='review')+(select count(*) from events e where state='review' and not exists(select 1 from actions a where a.event_id=e.id)),
  'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (select * from recent order by created_at desc,id limit 10) r),'[]'::jsonb)) into result;
 return result;
end $$;

-- Functions are invoker-only; no browser role may call even a trigger helper.
do $$
declare f regprocedure;
begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'ovoko_stock_%' or p.proname in (
   'prepare_ovoko_stock_group','ingest_ovoko_stock_forward','ingest_ovoko_stock_reverse',
   'ingest_sales_sync_with_stock','ingest_reverse_sales_sync_with_stock','claim_ovoko_stock_action')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
commit;
