begin;
alter table public.ovoko_single_publications add column if not exists origin text not null default 'published' check(origin in ('published','recovered'));
create table if not exists public.inventory_link_recovery (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 seller_id text not null, ovoko_account text not null, fingerprint text not null, client_id text not null,
 offer_id text not null check(offer_id~'^[0-9]{1,30}$'), part_id text not null check(part_id~'^[1-9][0-9]{0,11}$'),
 request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
 state text not null default 'prepared' check(state in ('prepared','applied','cancelled')),
 expires_at timestamptz not null default now()+interval '5 minutes', created_at timestamptz not null default now(), applied_at timestamptz
);
alter table public.inventory_link_recovery enable row level security;
revoke all on public.inventory_link_recovery from public,anon,authenticated;
grant select,insert,update on public.inventory_link_recovery to service_role;
create unique index if not exists recovery_one_pending on public.inventory_link_recovery(owner_id,ovoko_account,seller_id,offer_id) where state='prepared';
create index if not exists recovery_maintenance on public.inventory_link_recovery(owner_id,state,expires_at);
create or replace function public.guard_recovery_sync_enable() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if new.enabled and exists(select 1 from public.inventory_link_recovery where state='prepared' and expires_at>now() and (owner_id=new.owner_id or seller_id=new.seller_id or ovoko_account=new.ovoko_account)) then raise exception 'link recovery pending; cancel or finish it first'; end if;
 return new;
end $$;
drop trigger if exists recovery_sync_enable on public.sales_sync;
create trigger recovery_sync_enable before insert or update on public.sales_sync for each row execute function public.guard_recovery_sync_enable();
drop trigger if exists recovery_sync_enable on public.sales_sync_reverse;
create trigger recovery_sync_enable before insert or update on public.sales_sync_reverse for each row execute function public.guard_recovery_sync_enable();
create or replace function public.guard_recovery_account_release() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(190019);
 if exists(select 1 from public.inventory_link_recovery where owner_id=old.owner_id and state='prepared' and expires_at>now()) then raise exception 'cancel or finish link recovery first'; end if;
 return old;
end $$;
drop trigger if exists recovery_account_release on public.sales_sync_accounts;
create trigger recovery_account_release before delete on public.sales_sync_accounts for each row execute function public.guard_recovery_account_release();
create or replace function public.prepare_inventory_link_recovery(p_owner uuid,p_seller text,p_account text,p_fingerprint text,p_client text,p_offer text,p_part text,p_hash text,p_allegro text,p_ovoko text) returns setof public.inventory_link_recovery
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.inventory_link_recovery;
begin
 perform pg_advisory_xact_lock(190019);
 if not public.sync_account_lock(p_owner,p_seller,p_account,'claim') then raise exception 'physical accounts belong to another owner'; end if;
 if exists(select 1 from public.sales_sync where owner_id=p_owner and (enabled or lease_until>now())) or exists(select 1 from public.sales_sync_reverse where owner_id=p_owner and (enabled or lease_until>now())) or exists(select 1 from public.sales_sync_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) or exists(select 1 from public.sales_sync_reverse_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) then raise exception 'pause synchronization and resolve pending writes first'; end if;
 if not exists(select 1 from public.allegro_connections where owner_id=p_owner and sealed=p_allegro) or not exists(select 1 from public.ovoko_connections where owner_id=p_owner and sealed=p_ovoko) then raise exception 'connection changed'; end if;
 if exists(select 1 from public.ovoko_single_publications where ovoko_account=p_account and (allegro_seller_id=p_seller and allegro_offer_id=p_offer or part_id=p_part)) then raise exception 'publication record already exists; never overwrite a journal'; end if;
 update public.inventory_link_recovery set state='cancelled' where owner_id=p_owner and state='prepared' and expires_at<=now();
 select * into r from public.inventory_link_recovery where owner_id=p_owner and ovoko_account=p_account and seller_id=p_seller and offer_id=p_offer and state='prepared' for update;
 if found then
  if r.part_id<>p_part or r.fingerprint<>p_fingerprint or r.client_id<>p_client then raise exception 'preview changed'; end if;
  return next r; return;
 end if;
 return query insert into public.inventory_link_recovery(owner_id,seller_id,ovoko_account,fingerprint,client_id,offer_id,part_id,request_hash) values(p_owner,p_seller,p_account,p_fingerprint,p_client,p_offer,p_part,p_hash) returning *;
end $$;
create or replace function public.apply_inventory_link_recovery(p_owner uuid,p_id uuid,p_allegro text,p_ovoko text,p_fingerprint text,p_client text) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.inventory_link_recovery;
begin
 perform pg_advisory_xact_lock(190019);
 select * into r from public.inventory_link_recovery where id=p_id and owner_id=p_owner for update;
 if not found then raise exception 'preview not found'; end if;
 if r.state='applied' then return true; end if;
 if r.state<>'prepared' or r.expires_at<=now() or r.fingerprint<>p_fingerprint or r.client_id<>p_client then raise exception 'preview expired or changed'; end if;
 if not public.sync_account_lock(p_owner,r.seller_id,r.ovoko_account,'check') then raise exception 'account ownership changed'; end if;
 if exists(select 1 from public.sales_sync where owner_id=p_owner and (enabled or lease_until>now())) or exists(select 1 from public.sales_sync_reverse where owner_id=p_owner and (enabled or lease_until>now())) or exists(select 1 from public.sales_sync_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) or exists(select 1 from public.sales_sync_reverse_actions where owner_id=p_owner and state in ('preflight','running','submitted','uncertain')) then raise exception 'synchronization not paused'; end if;
 if not exists(select 1 from public.allegro_connections where owner_id=p_owner and sealed=p_allegro) or not exists(select 1 from public.ovoko_connections where owner_id=p_owner and sealed=p_ovoko) then raise exception 'connection changed'; end if;
 if exists(select 1 from public.ovoko_single_publications where ovoko_account=r.ovoko_account and part_id=r.part_id) then raise exception 'part already linked'; end if;
 insert into public.ovoko_single_publications(owner_id,ovoko_account,allegro_seller_id,allegro_offer_id,part_id,request_hash,state,origin) values(p_owner,r.ovoko_account,r.seller_id,r.offer_id,r.part_id,r.request_hash,'created','recovered');
 update public.inventory_link_recovery set state='applied',applied_at=now() where id=p_id and owner_id=p_owner;
 return true;
end $$;
revoke all on function public.guard_recovery_sync_enable(),public.guard_recovery_account_release(),public.prepare_inventory_link_recovery(uuid,text,text,text,text,text,text,text,text,text),public.apply_inventory_link_recovery(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.guard_recovery_sync_enable(),public.guard_recovery_account_release(),public.prepare_inventory_link_recovery(uuid,text,text,text,text,text,text,text,text,text),public.apply_inventory_link_recovery(uuid,uuid,text,text,text,text) to service_role;
commit;
