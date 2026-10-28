-- Run after 007. No payments or external mail delivery are enabled by this migration.
begin;
create table public.order_confirmation_mail (
  order_id uuid primary key references public.tpay_orders(id),
  recipient text not null,
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending','sending','accepted','review')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  retry_at timestamptz not null default now(),
  lease uuid,
  provider_id text,
  accepted_at timestamptz
);
alter table public.order_confirmation_mail enable row level security;
revoke all on public.order_confirmation_mail from public,anon,authenticated;
grant all on public.order_confirmation_mail to service_role;

create function public.protect_order_mail_snapshot() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.order_id is distinct from old.order_id or new.recipient is distinct from old.recipient
    or new.payload is distinct from old.payload then raise exception 'Immutable confirmation snapshot'; end if;
  return new;
end; $$;
create trigger protect_order_mail_snapshot before update on public.order_confirmation_mail
for each row execute function public.protect_order_mail_snapshot();

create function public.queue_order_confirmation() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient_email text;
begin
  if new.status='paid' and old.status is distinct from 'paid'
    and new.checkout_acceptance->'documents'->'terms'->>'text' is not null then
    select email into recipient_email from public.customer_accounts where owner_id=new.owner_id;
    insert into public.order_confirmation_mail(order_id,recipient,payload)
    values(new.id,recipient_email,to_jsonb(new)) on conflict(order_id) do nothing;
  end if;
  return new;
end; $$;
create trigger queue_order_confirmation after update of status on public.tpay_orders
for each row execute function public.queue_order_confirmation();

create function public.claim_order_mail() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  -- Provider keys expire after 24h. Ambiguous old sends need manual reconciliation, not a blind resend.
  update public.order_confirmation_mail set state='review'
  where state in ('pending','sending') and first_attempt_at < now()-interval '23 hours';
  with candidates as (
    select order_id from public.order_confirmation_mail
    where state in ('pending','sending') and retry_at<=now()
    order by retry_at for update skip locked limit 5
  ), claimed as (
    update public.order_confirmation_mail m set state='sending',attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,now()), retry_at=now()+interval '5 minutes',lease=gen_random_uuid()
    from candidates c where c.order_id=m.order_id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into result from claimed;
  return result;
end; $$;

create function public.finish_order_mail(p_id uuid,p_lease uuid,p_provider_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update public.order_confirmation_mail set
    state=case when nullif(p_provider_id,'') is null then 'pending' else 'accepted' end,
    provider_id=nullif(p_provider_id,''),accepted_at=case when nullif(p_provider_id,'') is not null then now() end
  where order_id=p_id and lease=p_lease and state='sending';
  return jsonb_build_object('ok',found);
end; $$;
revoke all on function public.protect_order_mail_snapshot(),public.queue_order_confirmation(),public.claim_order_mail(),public.finish_order_mail(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_order_mail(),public.finish_order_mail(uuid,uuid,text) to service_role;
-- No backfill: historical payments are not silently mailed and their accepted documents are not altered.
commit;
