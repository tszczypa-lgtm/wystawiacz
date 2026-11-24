-- Non-destructive operations and private customer reservation notes.
create table if not exists public.inventory_operations (
  id uuid primary key, owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('withdraw','reserve','restore')), request_hash text not null,
  parent_id uuid references public.inventory_operations(id), target_key text not null,
  seller_id text not null, ovoko_account text not null, fingerprint text not null,
  offer_id text, part_id text, publication_hash text, external_id text,
  name text not null, a_initial text, a_stock integer, a_sold integer, o_initial text,
  targets jsonb not null, reservation jsonb, closed boolean not null default true,
  state text not null check(state in ('prepared','running','settled')),
  allegro_state text not null, ovoko_state text not null, diagnostic text,
  expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.inventory_operations enable row level security;
revoke all on public.inventory_operations from public,anon,authenticated;
grant select,insert,update on public.inventory_operations to service_role;
create unique index if not exists inventory_reservation_open on public.inventory_operations(owner_id,seller_id,target_key) where kind='reserve' and not closed;
create unique index if not exists inventory_restore_once on public.inventory_operations(parent_id) where kind='restore';
create index if not exists inventory_operations_owner on public.inventory_operations(owner_id,created_at desc);
