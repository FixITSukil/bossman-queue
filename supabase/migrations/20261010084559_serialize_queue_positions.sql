-- Walk-ins and appointment check-ins must allocate queue positions under the same lock.
create or replace function public.join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text; v_require text; v_win bigint; v_tok_now text; v_tok_prev text;
  v_phone text; v_count integer; v_position integer; v_id uuid; v_barber_name text;
begin
  select value into v_secret from app_config where key = 'qr_secret';
  select value into v_require from app_config where key = 'require_token';
  if coalesce(v_require, 'true') = 'true' then
    v_win := floor(extract(epoch from now()) / 120)::bigint;
    v_tok_now := substring(encode(digest(v_win::text || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
    v_tok_prev := substring(encode(digest((v_win - 1)::text || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
    if p_token is null or (p_token <> v_tok_now and p_token <> v_tok_prev) then
      return json_build_object('error','expired_qr');
    end if;
  end if;
  select name into v_barber_name from barbers where id = p_barber_id and is_active;
  if v_barber_name is null then return json_build_object('error','Barber unavailable.'); end if;
  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if length(btrim(coalesce(p_customer_name,''))) < 2 or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter a name and valid phone number.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));
  if exists (select 1 from queue_entries where barber_id = p_barber_id and status in ('waiting','called')
    and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = v_phone) then
    return json_build_object('error','You''re already in this queue.');
  end if;
  select count(*), coalesce(max(position),0)+1 into v_count, v_position
  from queue_entries where barber_id = p_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
  values (p_barber_id, v_barber_name, btrim(p_customer_name), v_phone, 'waiting', v_position, 0)
  returning id into v_id;
  return json_build_object('id',v_id,'position',v_position,'ahead',v_count);
end; $$;
