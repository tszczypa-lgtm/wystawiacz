create table if not exists public.ovoko_vehicle_creations (
  ovoko_account text not null check (ovoko_account ~ '^[a-f0-9]{64}$'),
  model_id text not null check (model_id ~ '^[1-9][0-9]{0,11}$'),
  vehicle_year text not null check (vehicle_year ~ '^[12][0-9]{3}$'),
  owner_id uuid not null references auth.users(id),
  state text not null default 'sending' check (state in ('sending', 'created', 'uncertain')),
  car_id text check (car_id ~ '^[1-9][0-9]{0,11}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ovoko_account, model_id, vehicle_year)
);
alter table public.ovoko_vehicle_creations enable row level security;
revoke all on public.ovoko_vehicle_creations from public, anon, authenticated;
grant select, insert, update on public.ovoko_vehicle_creations to service_role;
