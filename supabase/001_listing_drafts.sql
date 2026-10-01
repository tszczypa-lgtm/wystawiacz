-- Run once in Supabase SQL Editor. Users can access only their own drafts.
create table if not exists public.listing_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  part_number text not null default '',
  manufacturer text not null default '',
  description text not null default '',
  price_cents integer check (price_cents > 0),
  stock integer not null default 1 check (stock > 0),
  created_at timestamptz not null default now()
);
create index if not exists listing_drafts_owner_idx on public.listing_drafts(owner_id);
alter table public.listing_drafts enable row level security;
revoke all on public.listing_drafts from anon;
grant select, insert, update, delete on public.listing_drafts to authenticated;
create policy "Read own drafts" on public.listing_drafts for select to authenticated using (owner_id = (select auth.uid()));
create policy "Create own drafts" on public.listing_drafts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Edit own drafts" on public.listing_drafts for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Delete own drafts" on public.listing_drafts for delete to authenticated using (owner_id = (select auth.uid()));
