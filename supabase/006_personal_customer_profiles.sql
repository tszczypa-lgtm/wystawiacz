-- Run once after 005, BEFORE enabling registration of private customers.
-- Existing accounts, seller bindings, payments and roles are unchanged.
begin;
create or replace function public.create_customer_account() returns trigger
language plpgsql security definer set search_path = '' as $$
declare details jsonb := new.raw_user_meta_data -> 'billing_company';
begin
  insert into public.customer_accounts(owner_id,email,company)
  values(new.id,coalesce(new.email,''),case when jsonb_typeof(details)='object' then
    jsonb_build_object('name',left(details->>'name',200),
      'nip',case when details->>'customerType'='person' then '' else left(details->>'nip',20) end,
      'street',left(details->>'street',200),'postcode',left(details->>'postcode',6),
      'city',left(details->>'city',100),'country','PL')
    || case when details->>'customerType'='person' then jsonb_build_object('customerType','person') else '{}'::jsonb end
    else '{}'::jsonb end);
  return new;
end; $$;
revoke all on function public.create_customer_account() from public,anon,authenticated;
commit;
