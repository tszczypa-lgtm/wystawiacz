-- Run after 006, before deploying the checkout acceptance UI.
-- Does not enable production payments or modify existing orders/access.
begin;
alter table public.tpay_orders add column checkout_acceptance jsonb;

create function public.protect_checkout_acceptance() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.checkout_acceptance is not null and new.checkout_acceptance is distinct from old.checkout_acceptance then
    raise exception 'Checkout acceptance is immutable';
  end if;
  return new;
end; $$;
create trigger tpay_acceptance_immutable before update on public.tpay_orders
for each row execute function public.protect_checkout_acceptance();

create function public.claim_tpay_order_with_acceptance(p_owner uuid,p_environment text,p_acceptance jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; previous_acceptance jsonb;
begin
  if p_acceptance is null or jsonb_typeof(p_acceptance)<>'object'
    or not (p_acceptance @> '{"acceptTerms":true,"requestEarlyStart":true}'::jsonb)
    or coalesce(p_acceptance->>'version','')='' or coalesce(p_acceptance->>'termsVersion','')=''
    or p_acceptance->>'environment' is distinct from p_environment
    or jsonb_typeof(p_acceptance->'statements') is distinct from 'object' then
    raise exception 'Invalid checkout acceptance';
  end if;
  -- The original claim serializes creation on the customer row; the lock lasts
  -- through this function, including the acceptance write and retry comparison.
  result:=public.claim_tpay_order(p_owner,p_environment);
  if (result->>'created')::boolean then
    update public.tpay_orders set checkout_acceptance=p_acceptance || jsonb_build_object('recordedAt',now())
      where id=(result->>'id')::uuid;
  else
    select checkout_acceptance into previous_acceptance from public.tpay_orders where id=(result->>'id')::uuid;
    if previous_acceptance is null or (previous_acceptance-'recordedAt') is distinct from p_acceptance then
      raise exception using errcode='P0002',message='Checkout acceptance conflict';
    end if;
  end if;
  return result;
end; $$;
revoke all on function public.protect_checkout_acceptance(),public.claim_tpay_order_with_acceptance(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_tpay_order_with_acceptance(uuid,text,jsonb) to service_role;
commit;
