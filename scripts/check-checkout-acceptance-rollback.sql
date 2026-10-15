-- After migration 007: SQL-only test, no Tpay requests and no real payments.
-- All writes are rolled back inside the DO block, including when run alone.
do $$
declare owner uuid; first_order jsonb; repeated jsonb; saved jsonb; restored jsonb;
  acceptance jsonb := '{"version":"sql-test","termsVersion":"sql-test","environment":"production","acceptTerms":true,"requestEarlyStart":true,"statements":{"terms":"test"}}';
begin
  select a.owner_id into owner from public.account_admins a
  join public.customer_accounts c on c.owner_id=a.owner_id
  where not c.suspended and not exists(select 1 from public.tpay_orders o
    where o.owner_id=a.owner_id and o.environment='production' and o.status in ('creating','pending')) limit 1;
  if owner is null then raise exception 'No suitable admin without an open production order; no changes made'; end if;
  perform 1 from public.customer_accounts where owner_id=owner for update;
  begin
    first_order:=public.claim_tpay_order_with_acceptance(owner,'production',acceptance);
    if not (first_order->>'created')::boolean then raise exception 'Expected a new order'; end if;
    select checkout_acceptance into saved from public.tpay_orders where id=(first_order->>'id')::uuid;
    if saved->>'recordedAt' is null then raise exception 'Missing database timestamp'; end if;
    repeated:=public.claim_tpay_order_with_acceptance(owner,'production',acceptance);
    if repeated->>'id'<>first_order->>'id' or (repeated->>'created')::boolean then raise exception 'Retry created another order'; end if;
    begin
      perform public.claim_tpay_order_with_acceptance(owner,'production',acceptance||'{"version":"changed"}'::jsonb);
      raise exception 'Changed version accepted';
    exception when sqlstate 'P0002' then null;
    end;
    begin
      update public.tpay_orders set checkout_acceptance='{}'::jsonb where id=(first_order->>'id')::uuid;
      raise exception using errcode='Z0002',message='Immutable acceptance overwritten';
    exception when sqlstate 'P0001' then null;
    end;
    select checkout_acceptance into restored from public.tpay_orders where id=(first_order->>'id')::uuid;
    if restored is distinct from saved then raise exception 'Acceptance changed on retry'; end if;
    raise exception using errcode='Z0001',message='Expected rollback';
  exception when sqlstate 'Z0001' then null;
  end;
  if exists(select 1 from public.tpay_orders where id=(first_order->>'id')::uuid) then raise exception 'Temporary order survived'; end if;
end; $$;
select 'OK: zapis oswiadczen, powtorka, blokada zmian i rollback' as wynik;
