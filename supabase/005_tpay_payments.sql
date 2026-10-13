-- Run once after 004. Does not enable payments or change existing access.
begin;
create table public.tpay_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.customer_accounts(owner_id),
  environment text not null check (environment in ('sandbox','production')),
  status text not null default 'creating' check (status in ('creating','pending','paid','failed','refunded')),
  amount_grosz integer not null default 50000 check (amount_grosz=50000),
  currency text not null default 'PLN' check (currency='PLN'),
  transaction_id text, transaction_title text, payment_url text,
  created_at timestamptz not null default now(), paid_at timestamptz, access_until timestamptz,
  unique(environment,transaction_id), unique(environment,transaction_title)
);
create unique index tpay_one_pending on public.tpay_orders(owner_id,environment) where status in ('creating','pending');
alter table public.tpay_orders enable row level security;
revoke all on public.tpay_orders from anon,authenticated;
grant all on public.tpay_orders to service_role;

create function public.claim_tpay_order(p_owner uuid,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing public.tpay_orders;
begin
  if p_environment not in ('sandbox','production') then raise exception 'Invalid environment'; end if;
  perform 1 from public.customer_accounts where owner_id=p_owner and not suspended for update;
  if not found then raise exception 'Forbidden'; end if;
  select * into existing from public.tpay_orders where owner_id=p_owner and environment=p_environment and status in ('creating','pending');
  if found then return jsonb_build_object('id',existing.id,'created',false,'payment_url',existing.payment_url); end if;
  insert into public.tpay_orders(owner_id,environment) values(p_owner,p_environment) returning * into existing;
  return jsonb_build_object('id',existing.id,'created',true);
end; $$;
create function public.fail_tpay_order(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update public.tpay_orders set status='failed' where id=p_id and status='creating' and transaction_id is null;
  return jsonb_build_object('ok',true);
end; $$;
create function public.attach_tpay_transaction(p_id uuid,p_transaction text,p_title text,p_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_order public.tpay_orders;
begin
  select * into current_order from public.tpay_orders where id=p_id for update;
  if not found or (current_order.transaction_title is not null and current_order.transaction_title<>p_title) then raise exception 'Order mismatch'; end if;
  update public.tpay_orders set transaction_id=p_transaction,transaction_title=p_title,payment_url=p_url,
    status=case when status='creating' then 'pending' else status end where id=p_id;
  return jsonb_build_object('ok',true);
end; $$;
create function public.settle_tpay_order(p_id uuid,p_environment text,p_title text,p_refunded boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_order public.tpay_orders; customer public.customer_accounts; expiry timestamptz;
begin
  -- Serialize different paid orders for the same customer, not just duplicate callbacks.
  select c.* into customer from public.customer_accounts c join public.tpay_orders o on o.owner_id=c.owner_id where o.id=p_id for update of c;
  if not found then raise exception 'Unknown order'; end if;
  select * into current_order from public.tpay_orders where id=p_id for update;
  if current_order.environment<>p_environment or current_order.amount_grosz<>50000 or current_order.currency<>'PLN'
    or (current_order.transaction_title is not null and current_order.transaction_title<>p_title) then raise exception 'Order mismatch'; end if;
  if p_refunded then
    update public.tpay_orders set status='refunded',transaction_title=p_title where id=p_id;
    -- Administrator reviews access after a refund; never revoke unrelated payments or free access.
    return jsonb_build_object('refunded',true);
  end if;
  if current_order.status='paid' then return jsonb_build_object('duplicate',true); end if;
  if current_order.status not in ('creating','pending') then raise exception 'Order not payable'; end if;
  if p_environment='production' then
    expiry:=greatest(now(),customer.paid_until,customer.trial_until)+interval '1 month';
    update public.customer_accounts set paid_until=expiry,subscription_status='active',cancel_at_period_end=false,updated_at=now() where owner_id=customer.owner_id;
  end if;
  update public.tpay_orders set status='paid',transaction_title=p_title,paid_at=now(),access_until=expiry where id=p_id;
  return jsonb_build_object('paid',true,'access_until',expiry);
end; $$;
revoke all on function public.claim_tpay_order(uuid,text),public.fail_tpay_order(uuid),public.attach_tpay_transaction(uuid,text,text,text),public.settle_tpay_order(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_tpay_order(uuid,text),public.fail_tpay_order(uuid),public.attach_tpay_transaction(uuid,text,text,text),public.settle_tpay_order(uuid,text,text,boolean) to service_role;
commit;
