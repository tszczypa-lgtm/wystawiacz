-- Run WHOLE file in Supabase after 009. No HTTP, no persistent orders or outgoing email.
do $$
declare
  owner uuid;
  test_id uuid := gen_random_uuid();
  mail public.order_confirmation_mail;
begin
  begin
    select owner_id into owner from public.customer_accounts
      where owner_id='411f7894-1275-4ca7-9227-b79f12b1812e' and not suspended;
    if owner is null then raise exception 'Reviewer account missing or suspended'; end if;
    insert into public.tpay_orders(id,owner_id,environment,status,checkout_acceptance)
    values(test_id,owner,'sandbox','pending',jsonb_build_object(
      'version','local-test','documents',jsonb_build_object('terms',jsonb_build_object('text','Historical test terms'))));
    perform public.settle_tpay_order(test_id,'sandbox','TR-LOCAL-'||replace(test_id::text,'-',''),false);
    select * into mail from public.order_confirmation_mail where order_id=test_id;
    if mail.order_id is null or mail.payload->>'status'<>'paid' or mail.state<>'pending' then
      raise exception 'FAILED: confirmation not queued with settlement'; end if;
    if mail.recipient is distinct from (select email from public.customer_accounts where owner_id=owner) then
      raise exception 'FAILED: recipient mismatch'; end if;
    perform public.settle_tpay_order(test_id,'sandbox','TR-LOCAL-'||replace(test_id::text,'-',''),false);
    if (select count(*) from public.order_confirmation_mail where order_id=test_id)<>1 then
      raise exception 'FAILED: duplicate mail'; end if;
    update public.order_confirmation_mail set state='sending',attempts=1,lease=test_id where order_id=test_id;
    perform public.fail_order_smtp_mail(test_id,test_id,true);
    if (select state from public.order_confirmation_mail where order_id=test_id)<>'pending' then
      raise exception 'FAILED: safe rejection not retryable'; end if;
    update public.order_confirmation_mail set state='sending' where order_id=test_id;
    perform public.fail_order_smtp_mail(test_id,test_id,false);
    if (select state from public.order_confirmation_mail where order_id=test_id)<>'review' then
      raise exception 'FAILED: ambiguous send retried'; end if;
    if public.claim_order_mail()<>'[]'::jsonb then raise exception 'FAILED: old API retry path enabled'; end if;
    begin
      update public.order_confirmation_mail set recipient='forged@example.test' where order_id=test_id;
      raise exception using errcode='Z0002',message='FAILED: snapshot mutable';
    exception when raise_exception then null;
    end;
    raise exception using errcode='Z0001',message='Intentional rollback';
  exception when sqlstate 'Z0001' then null;
  end;
  if exists(select 1 from public.order_confirmation_mail where order_id=test_id)
    or exists(select 1 from public.tpay_orders where id=test_id) then raise exception 'FAILED: rollback'; end if;
end; $$;
select 'OK: kolejka, snapshot, powtorka i rollback' as wynik;
