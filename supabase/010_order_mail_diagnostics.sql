-- Optional diagnostics after 009. Does not retry, send, or reset any mail.
begin;
alter table public.order_confirmation_mail
  add column last_error_code text,
  add column last_smtp_status integer,
  add column last_error_stage text,
  add column last_error_at timestamptz;

create function public.record_order_mail_failure(
  p_id uuid,p_lease uuid,p_retryable boolean,p_code text,p_status integer,p_stage text
) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_code !~ '^[A-Z_]{2,50}$' or p_stage not in ('AUTH','CONN','EHLO','HELO','STARTTLS','MAIL FROM','RCPT TO','DATA','UNKNOWN','DATABASE')
    or (p_status is not null and p_status not between 400 and 599) then raise exception 'Invalid diagnostic'; end if;
  update public.order_confirmation_mail
  set state=case when p_retryable and attempts<5 then 'pending' else 'review' end,
    last_error_code=p_code,last_smtp_status=p_status,last_error_stage=p_stage,last_error_at=now()
  where order_id=p_id and lease=p_lease and state='sending';
  return jsonb_build_object('ok',found);
end; $$;
revoke all on function public.record_order_mail_failure(uuid,uuid,boolean,text,integer,text) from public,anon,authenticated;
grant execute on function public.record_order_mail_failure(uuid,uuid,boolean,text,integer,text) to service_role;
commit;
