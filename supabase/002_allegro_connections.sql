-- Only the server service-role key may access encrypted Allegro connections.
create table if not exists public.allegro_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  sealed text not null,
  updated_at timestamptz not null default now()
);
alter table public.allegro_connections enable row level security;
revoke all on public.allegro_connections from anon, authenticated;
grant select, insert, update, delete on public.allegro_connections to service_role;
