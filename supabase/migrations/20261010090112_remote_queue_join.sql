-- Public remote joins use the same live queue as the in-shop QR, but have their
-- own opening-hours gate. The QR join function and its token check stay intact.
create or replace function public.join_queue_remote(
  p_barber_id text, p_customer_name text, p_phone text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_local_time time;
  v_barber_name text;
  v_phone text;
  v_count integer;
  v_position integer;
  v_id uuid;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object('error','Online queue opens at 11:00 AM and closes at 10:45 PM Malaysia time.');
  end if;

  select name into v_barber_name from barbers
    where id = p_barber_id and is_active and role = 'barber';
  if v_barber_name is null then return json_build_object('error','This barber is unavailable.'); end if;

  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if length(btrim(coalesce(p_customer_name,''))) not between 2 and 80
     or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter your name and a valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));
  if exists (select 1 from queue_entries where barber_id = p_barber_id
     and status in ('waiting','called')
     and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = v_phone) then
    return json_build_object('error','You are already in this barber''s queue.');
  end if;

  select count(*), coalesce(max(position),0)+1 into v_count, v_position
    from queue_entries where barber_id = p_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
    values (p_barber_id, v_barber_name, btrim(p_customer_name), v_phone, 'waiting', v_position, 0)
    returning id into v_id;
  return json_build_object('id',v_id,'position',v_position,'ahead',v_count);
end; $$;

revoke all on function public.join_queue_remote(text,text,text) from public;
grant execute on function public.join_queue_remote(text,text,text) to anon, authenticated;
