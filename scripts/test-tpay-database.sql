-- LOCAL TEST DATABASE ONLY. Never run this fixture against Supabase.
create role anon;
create role authenticated;
create role service_role;
create table public.customer_accounts (
  owner_id uuid primary key, suspended boolean not null default false,
  paid_until timestamptz, trial_until timestamptz, subscription_status text default 'none',
  cancel_at_period_end boolean default false, updated_at timestamptz default now()
);
\ir ../supabase/005_tpay_payments.sql
insert into public.customer_accounts(owner_id,trial_until) values
 ('00000000-0000-0000-0000-000000000001',now()+interval '30 days');
do $$
declare first_order jsonb; duplicate_order jsonb; live_order jsonb; second_order jsonb;
  initial_expiry timestamptz; final_expiry timestamptz;
begin
  first_order:=public.claim_tpay_order('00000000-0000-0000-0000-000000000001','sandbox');
  duplicate_order:=public.claim_tpay_order('00000000-0000-0000-0000-000000000001','sandbox');
  if (duplicate_order->>'created')::boolean or duplicate_order->>'id'<>first_order->>'id' then raise exception 'Checkout duplicate'; end if;
  perform public.settle_tpay_order((first_order->>'id')::uuid,'sandbox','TR-TEST-1',false);
  if exists(select 1 from public.customer_accounts where paid_until is not null or subscription_status='active') then raise exception 'Sandbox granted live access'; end if;
  live_order:=public.claim_tpay_order('00000000-0000-0000-0000-000000000001','production');
  perform public.settle_tpay_order((live_order->>'id')::uuid,'production','TR-LIVE-1',false);
  select paid_until into initial_expiry from public.customer_accounts;
  if initial_expiry<>(select trial_until+interval '1 month' from public.customer_accounts) then raise exception 'Trial shortened'; end if;
  perform public.settle_tpay_order((live_order->>'id')::uuid,'production','TR-LIVE-1',false);
  if initial_expiry<>(select paid_until from public.customer_accounts) then raise exception 'Duplicate credited'; end if;
  -- Callback may arrive before the create-transaction response is persisted.
  perform public.attach_tpay_transaction((live_order->>'id')::uuid,'transaction1','TR-LIVE-1','https://secure.tpay.com/test');
  if (select status from public.tpay_orders where id=(live_order->>'id')::uuid)<>'paid' then raise exception 'Early webhook overwritten'; end if;
  second_order:=public.claim_tpay_order('00000000-0000-0000-0000-000000000001','production');
  perform public.settle_tpay_order((second_order->>'id')::uuid,'production','TR-LIVE-2',false);
  select paid_until into final_expiry from public.customer_accounts;
  if final_expiry<>initial_expiry+interval '1 month' then raise exception 'Renewal not credited'; end if;
  perform public.settle_tpay_order((second_order->>'id')::uuid,'production','TR-LIVE-2',true);
  if final_expiry<>(select paid_until from public.customer_accounts) then raise exception 'Refund removed unrelated access'; end if;
  begin
    perform public.settle_tpay_order((second_order->>'id')::uuid,'production','TR-LIVE-2',false);
    raise exception 'Refund unexpectedly payable';
  exception when raise_exception then
    if SQLERRM<>'Order not payable' then raise; end if;
  end;
  if not (select relrowsecurity from pg_class where oid='public.tpay_orders'::regclass) then raise exception 'RLS missing'; end if;
  if has_table_privilege('authenticated','public.tpay_orders','SELECT') then raise exception 'Customer can read payment registry'; end if;
  if has_function_privilege('anon','public.settle_tpay_order(uuid,text,text,boolean)','EXECUTE') then raise exception 'Anonymous settlement'; end if;
end; $$;
select 'TPAY DATABASE TESTS PASSED' as result;
