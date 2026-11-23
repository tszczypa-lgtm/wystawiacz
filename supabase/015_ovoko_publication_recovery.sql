create table if not exists public.ovoko_publication_recoveries (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  ovoko_account text not null,
  allegro_seller_id text not null,
  allegro_offer_id text not null,
  previous_hash text not null,
  found_part_id text,
  scanned integer not null,
  created_at timestamptz not null default now()
);
alter table public.ovoko_publication_recoveries enable row level security;
revoke all on public.ovoko_publication_recoveries from public, anon, authenticated;
grant select, insert on public.ovoko_publication_recoveries to service_role;
grant usage on sequence public.ovoko_publication_recoveries_id_seq to service_role;
create or replace function public.resolve_ovoko_publication(
  p_owner uuid, p_account text, p_seller text, p_offer text, p_hash text,
  p_updated timestamptz, p_found text, p_scanned integer
) returns boolean language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if p_scanned < 0 or p_scanned > 2000 or (p_found is not null and p_found !~ '^[1-9][0-9]{0,11}$') then
    raise exception 'Invalid recovery proof';
  end if;
  if p_found is null then
    delete from public.ovoko_single_publications
      where owner_id=p_owner and ovoko_account=p_account and allegro_seller_id=p_seller
      and allegro_offer_id=p_offer and request_hash=p_hash and updated_at=p_updated
      and state in ('sending','uncertain') and updated_at < now()-interval '30 minutes';
  else
    update public.ovoko_single_publications set state='created', part_id=p_found, updated_at=now()
      where owner_id=p_owner and ovoko_account=p_account and allegro_seller_id=p_seller
      and allegro_offer_id=p_offer and request_hash=p_hash and updated_at=p_updated
      and (part_id is null or part_id=p_found)
      and state in ('sending','uncertain') and updated_at < now()-interval '30 minutes';
  end if;
  get diagnostics n = row_count;
  if n <> 1 then return false; end if;
  insert into public.ovoko_publication_recoveries(owner_id,ovoko_account,allegro_seller_id,allegro_offer_id,previous_hash,found_part_id,scanned)
    values(p_owner,p_account,p_seller,p_offer,p_hash,p_found,p_scanned);
  return true;
end; $$;
revoke all on function public.resolve_ovoko_publication(uuid,text,text,text,text,timestamptz,text,integer) from public, anon, authenticated;
grant execute on function public.resolve_ovoko_publication(uuid,text,text,text,text,timestamptz,text,integer) to service_role;
grant delete on public.ovoko_single_publications to service_role;
