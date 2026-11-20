-- Server-only access. Credentials are AES-GCM ciphertext, never plaintext.
create table if not exists public.ovoko_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  sealed text not null,
  verified_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.ovoko_connections enable row level security;
revoke all on public.ovoko_connections from public, anon, authenticated;
grant select, insert, update, delete on public.ovoko_connections to service_role;
