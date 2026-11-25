begin;
create table if not exists public.workspace_ovoko_drafts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 product_id uuid not null,
 ovoko_account text not null check(ovoko_account ~ '^[a-f0-9]{64}$'),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'),
 quantity integer not null check(quantity between 1 and 10000),
 completed integer not null default 0,
 part_ids text[] not null default '{}',
 state text not null default 'ready' check(state in ('ready','sending','created','uncertain')),
 attempt_id uuid not null,
 updated_at timestamptz not null default now(),
 primary key(owner_id,product_id,ovoko_account),
 check(completed between 0 and quantity and cardinality(part_ids)=completed),
 check(state<>'created' or completed=quantity)
);
alter table public.workspace_ovoko_drafts enable row level security;
revoke all on public.workspace_ovoko_drafts from anon,authenticated;
grant select on public.workspace_ovoko_drafts to authenticated;
grant all on public.workspace_ovoko_drafts to service_role;
drop policy if exists workspace_ovoko_drafts_read on public.workspace_ovoko_drafts;
create policy workspace_ovoko_drafts_read on public.workspace_ovoko_drafts for select to authenticated using(owner_id=auth.uid());
notify pgrst,'reload schema';
commit;
