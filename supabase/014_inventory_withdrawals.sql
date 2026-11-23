-- Manual non-destructive withdrawal journal. No direct browser access.
create table if not exists public.inventory_withdrawals (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  seller_id text not null check (seller_id ~ '^[0-9]{1,30}$'),
  offer_id text not null check (offer_id ~ '^[0-9]{1,30}$'),
  part_id text check (part_id ~ '^[1-9][0-9]{0,11}$'),
  fingerprint text not null,
  publication_hash text,
  scope text not null check (scope in ('allegro', 'ovoko', 'both')),
  state text not null check (state in ('prepared', 'running', 'settled')),
  allegro_state text not null check (allegro_state in ('pending', 'submitted', 'done', 'uncertain', 'not_requested')),
  ovoko_state text not null check (ovoko_state in ('pending', 'submitted', 'done', 'uncertain', 'not_requested')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'allegro' and part_id is null and publication_hash is null and fingerprint = 'allegro-only') or (scope <> 'allegro' and part_id is not null and publication_hash is not null and publication_hash ~ '^[a-f0-9]{64}$' and fingerprint ~ '^[a-f0-9]{64}$'))
);
alter table public.inventory_withdrawals enable row level security;
revoke all on public.inventory_withdrawals from public, anon, authenticated;
grant select, insert, update on public.inventory_withdrawals to service_role;
create index if not exists inventory_withdrawals_owner_created on public.inventory_withdrawals(owner_id, created_at desc);
