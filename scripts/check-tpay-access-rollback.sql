-- Supabase SQL Editor: run the WHOLE file, not a selected fragment.
-- No HTTP requests, real payments, settings changes or persistent access grants.
-- The inner subtransaction ALWAYS rolls back, even when this DO runs alone.
do $$
declare
  owner uuid;
  original public.customer_accounts;
  restored public.customer_accounts;
  first_order jsonb;
  reused_order jsonb;
  second_order jsonb;
  first_id uuid;
  second_id uuid;
  first_expiry timestamptz;
  second_expiry timestamptz;
  trial_end timestamptz := now()+interval '30 days';
  answer jsonb;
begin
  begin
    select o.owner_id into owner
      from public.tpay_orders o join public.account_admins a on a.owner_id=o.owner_id
      where o.environment='sandbox' and o.status='paid'
      order by o.created_at desc limit 1;
    if owner is null then raise exception 'No administrator with paid sandbox test'; end if;
    select * into original from public.customer_accounts where owner_id=owner for update;
    if original.suspended then raise exception 'Administrator suspended'; end if;
    if exists(select 1 from public.tpay_orders where owner_id=owner and environment='production' and status in ('creating','pending')) then
      raise exception 'Production payment pending: do not run this test yet';
    end if;

    update public.customer_accounts set paid_until=null,trial_until=trial_end,subscription_status='none' where owner_id=owner;
    first_order:=public.claim_tpay_order(owner,'production');
    first_id:=(first_order->>'id')::uuid;
    reused_order:=public.claim_tpay_order(owner,'production');
    if not (first_order->>'created')::boolean or (reused_order->>'created')::boolean or reused_order->>'id'<>first_order->>'id' then
      raise exception 'FAILED: duplicate checkout';
    end if;
    answer:=public.settle_tpay_order(first_id,'production','TR-LOCAL-'||replace(first_id::text,'-',''),false);
    select paid_until into first_expiry from public.customer_accounts where owner_id=owner;
    if first_expiry is distinct from trial_end+interval '1 month' then raise exception 'FAILED: first month or trial preservation'; end if;
    if (select subscription_status from public.customer_accounts where owner_id=owner)<>'active' then raise exception 'FAILED: subscription status'; end if;
    if (select access_until from public.tpay_orders where id=first_id) is distinct from first_expiry then raise exception 'FAILED: access receipt'; end if;

    answer:=public.settle_tpay_order(first_id,'production','TR-LOCAL-'||replace(first_id::text,'-',''),false);
    if not coalesce((answer->>'duplicate')::boolean,false) or first_expiry is distinct from (select paid_until from public.customer_accounts where owner_id=owner) then
      raise exception 'FAILED: duplicate callback credited again';
    end if;
    perform public.attach_tpay_transaction(first_id,'LOCAL-'||first_id::text,'TR-LOCAL-'||replace(first_id::text,'-',''),'https://secure.tpay.com/local-test');
    if (select status from public.tpay_orders where id=first_id)<>'paid' then raise exception 'FAILED: early callback overwritten'; end if;

    second_order:=public.claim_tpay_order(owner,'production');
    second_id:=(second_order->>'id')::uuid;
    perform public.settle_tpay_order(second_id,'production','TR-LOCAL-'||replace(second_id::text,'-',''),false);
    select paid_until into second_expiry from public.customer_accounts where owner_id=owner;
    if second_expiry is distinct from first_expiry+interval '1 month' then raise exception 'FAILED: renewal'; end if;

    raise exception using errcode='Z0001',message='Intentional test rollback';
  exception when sqlstate 'Z0001' then
    null;
  end;
  -- These checks run AFTER the rollback, not before it.
  select * into restored from public.customer_accounts where owner_id=owner;
  if restored is distinct from original then raise exception 'FAILED: account not restored'; end if;
  if exists(select 1 from public.tpay_orders where id in (first_id,second_id)) then raise exception 'FAILED: temporary order survived'; end if;
end; $$;
select 'OK: miesiac, przedluzenie, powtorka i wycofanie zmian' as wynik;
