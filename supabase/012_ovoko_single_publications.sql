-- Durable single-publication lock. Never clear an uncertain attempt without checking Ovoko.
create table if not exists public.ovoko_single_publications (
  ovoko_account text not null check (ovoko_account ~ '^[a-f0-9]{64}$'),
  allegro_seller_id text not null check (allegro_seller_id ~ '^[0-9]{1,30}$'),
  allegro_offer_id text not null check (allegro_offer_id ~ '^[0-9]{1,30}$'),
  owner_id uuid not null references auth.users(id),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'sending' check (state in ('sending', 'created', 'uncertain')),
  part_id text check (part_id ~ '^[0-9]{1,12}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ovoko_account, allegro_seller_id, allegro_offer_id)
);
alter table public.ovoko_single_publications enable row level security;
revoke all on public.ovoko_single_publications from public, anon, authenticated;
grant select, insert, update on public.ovoko_single_publications to service_role;
