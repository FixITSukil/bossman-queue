-- The counter QR is now a permanent link. Keep the existing five-argument RPC
-- signature so older customer pages can still call it, but ignore p_token.
-- Opening hours, barber availability, phone checks, and queue ordering remain.
update public.app_config set value = 'false' where key = 'require_token';

create or replace function public.join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone text; v_count integer; v_position integer; v_id uuid; v_barber_name text;
  v_local_time time;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object('error','The queue is not open right now. Please join from 11:00 AM to 10:45 PM Malaysia time.');
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
