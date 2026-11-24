begin;
create table if not exists public.sales_sync_accounts (
 seller_id text primary key, ovoko_account text not null unique,
 owner_id uuid not null unique references auth.users(id), created_at timestamptz not null default now()
);
alter table public.sales_sync_accounts enable row level security;
revoke all on public.sales_sync_accounts from public,anon,authenticated;
grant select,insert,delete on public.sales_sync_accounts to service_role;
create or replace function public.sync_account_lock(p_owner uuid,p_seller text,p_ovoko text,p_mode text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if p_mode='release' then
  if exists(select 1 from public.sales_sync where owner_id=p_owner and (enabled or lease_until>now())) or exists(select 1 from public.sales_sync_reverse where owner_id=p_owner and (enabled or lease_until>now()))
   or exists(select 1 from public.sales_sync_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) or exists(select 1 from public.sales_sync_reverse_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) then return false; end if;
  delete from public.sales_sync_accounts where owner_id=p_owner; return true;
 end if;
 if p_mode='check' then return exists(select 1 from public.sales_sync_accounts where owner_id=p_owner and seller_id=p_seller and ovoko_account=p_ovoko); end if;
 if p_mode<>'claim' or p_seller is null or p_ovoko is null or p_seller!~'^[0-9]{1,30}$' or p_ovoko!~'^[a-f0-9]{64}$' then return false; end if;
 if exists(select 1 from public.sales_sync_accounts where (seller_id=p_seller or ovoko_account=p_ovoko or owner_id=p_owner) and not(owner_id=p_owner and seller_id=p_seller and ovoko_account=p_ovoko)) then return false; end if;
 if exists(select 1 from public.sales_sync s where s.owner_id<>p_owner and (s.seller_id=p_seller or s.ovoko_account=p_ovoko) and (s.enabled or s.lease_until>now() or exists(select 1 from public.sales_sync_actions a where a.owner_id=s.owner_id and a.state in ('preflight','running','submitted','uncertain'))))
 or exists(select 1 from public.sales_sync_reverse s where s.owner_id<>p_owner and (s.seller_id=p_seller or s.ovoko_account=p_ovoko) and (s.enabled or s.lease_until>now() or exists(select 1 from public.sales_sync_reverse_actions a where a.owner_id=s.owner_id and a.state in ('preflight','running','submitted','uncertain')))) then return false; end if;
 insert into public.sales_sync_accounts(seller_id,ovoko_account,owner_id) values(p_seller,p_ovoko,p_owner) on conflict do nothing;
 return exists(select 1 from public.sales_sync_accounts where owner_id=p_owner and seller_id=p_seller and ovoko_account=p_ovoko);
end $$;
revoke all on function public.sync_account_lock(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.sync_account_lock(uuid,text,text,text) to service_role;

-- Serialize archival with creation of a restore plan. Never hide a live restore.
create or replace function public.inventory_restore_parent_guard() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.inventory_operations;
begin
 if new.kind='restore' then
  select * into p from public.inventory_operations where id=new.parent_id for update;
  if not found or p.owner_id<>new.owner_id or p.kind<>'reserve' or p.closed then raise exception 'reservation not open'; end if;
 end if;
 return new;
end $$;
drop trigger if exists inventory_restore_parent_guard on public.inventory_operations;
create trigger inventory_restore_parent_guard before insert on public.inventory_operations for each row execute function public.inventory_restore_parent_guard();
revoke all on function public.inventory_restore_parent_guard() from public,anon,authenticated;
grant execute on function public.inventory_restore_parent_guard() to service_role;
create or replace function public.archive_inventory_reservation(p_owner uuid,p_id uuid) returns setof public.inventory_operations
language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.inventory_operations; r public.inventory_operations;
begin
 select * into p from public.inventory_operations where id=p_id and owner_id=p_owner for update;
 if not found or p.kind<>'reserve' or p.state<>'settled' or p.allegro_state not in ('done','not_requested') or p.ovoko_state not in ('done','not_requested') then raise exception 'reservation unresolved'; end if;
 select * into r from public.inventory_operations where parent_id=p_id and kind='restore' for update;
 if found then
  if r.state<>'prepared' then raise exception 'restore already started'; end if;
  update public.inventory_operations set state='settled',allegro_state='not_requested',ovoko_state='not_requested',diagnostic='Cancelled before archive',updated_at=now() where id=r.id and state='prepared';
 end if;
 return query update public.inventory_operations set closed=true,updated_at=now() where id=p_id and owner_id=p_owner returning *;
end $$;
revoke all on function public.archive_inventory_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.archive_inventory_reservation(uuid,uuid) to service_role;
commit;
