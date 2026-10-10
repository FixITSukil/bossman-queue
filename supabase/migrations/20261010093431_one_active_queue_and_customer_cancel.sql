-- Remote customers may hold only one active queue place across all barbers.
-- A per-phone advisory lock serializes simultaneous joins from separate tabs.
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
  if left(v_phone,1) = '0' then v_phone := '60' || substring(v_phone from 2); end if;
  if length(btrim(coalesce(p_customer_name,''))) not between 2 and 80
     or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter your name and a valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));
  if exists (
    select 1 from queue_entries q
    where q.status in ('waiting','called')
      and (case
        when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
          then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g')
      end) = v_phone
  ) then
    return json_build_object('error','This phone number is already in a queue. Open your existing queue page or cancel that place first.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));
  select count(*), coalesce(max(position),0)+1 into v_count, v_position
    from queue_entries where barber_id = p_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
    values (p_barber_id, v_barber_name, btrim(p_customer_name), v_phone, 'waiting', v_position, 0)
    returning id into v_id;
  return json_build_object('id',v_id,'position',v_position,'ahead',v_count);
end; $$;

-- Customer cancellation has its own state instead of being counted as a no-show.
create or replace function public.leave_queue(p_entry_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update queue_entries set status = 'cancelled_by_customer'
    where id = p_entry_id and status in ('waiting','called')
    returning id into v_id;
  if v_id is null then return json_build_object('error','This queue place can no longer be cancelled.'); end if;
  return json_build_object('ok',true);
end; $$;
