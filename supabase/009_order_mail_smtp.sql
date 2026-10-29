-- Run after 008. Keeps existing queue and documents. Does not enable sending.
begin;
create function public.claim_order_smtp_mail() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  -- SMTP cannot deduplicate a resend after an ambiguous disconnect or lost DB acknowledgement.
  update public.order_confirmation_mail set state='review'
  where (state='sending' and retry_at<=now()) or (state='pending' and attempts>=5);
  with candidate as (
    select order_id from public.order_confirmation_mail
    where state='pending' and retry_at<=now() and attempts<5
    order by retry_at for update skip locked limit 1
  ), claimed as (
    update public.order_confirmation_mail m set state='sending', attempts=attempts+1,
      first_attempt_at=coalesce(first_attempt_at,now()),retry_at=now()+interval '5 minutes',lease=gen_random_uuid()
    from candidate c where c.order_id=m.order_id returning m.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into result from claimed;
  return result;
end; $$;

create function public.fail_order_smtp_mail(p_id uuid,p_lease uuid,p_retryable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  update public.order_confirmation_mail
  set state=case when p_retryable and attempts<5 then 'pending' else 'review' end
  where order_id=p_id and lease=p_lease and state='sending';
  return jsonb_build_object('ok',found);
end; $$;

-- Disable the API-style retry path, including for an accidentally stale worker deployment.
create or replace function public.claim_order_mail() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  return '[]'::jsonb;
end; $$;

revoke all on function public.claim_order_smtp_mail(),public.fail_order_smtp_mail(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_order_smtp_mail(),public.fail_order_smtp_mail(uuid,uuid,boolean) to service_role;
commit;
