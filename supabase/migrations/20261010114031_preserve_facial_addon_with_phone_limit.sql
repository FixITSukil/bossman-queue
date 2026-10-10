-- A customer may add one facial therapist queue place alongside an active
-- barber place. This does not permit a second barber or a second therapist.
create or replace function public.join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone text; v_count integer; v_position integer; v_id uuid; v_cancel_token uuid;
  v_barber_name text; v_role text; v_local_time time;
  v_last_status text; v_last_created timestamptz; v_facial_addon boolean;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object('error','The queue is not open right now. Please join from 11:00 AM to 10:45 PM Malaysia time.');
  end if;
  select name, role into v_barber_name, v_role from barbers where id = p_barber_id and is_active;
  if v_barber_name is null then return json_build_object('error','Barber unavailable.'); end if;
  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if left(v_phone,1) = '0' then v_phone := '60' || substring(v_phone from 2); end if;
  if length(btrim(coalesce(p_customer_name,''))) < 2 or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter a name and valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));
  select v_role = 'therapist' and exists (
    select 1 from queue_entries q join barbers b on b.id = q.barber_id
    where b.role = 'barber' and q.status in ('waiting','called')
      and (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
        then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') end) = v_phone
  ) into v_facial_addon;

  if exists (
    select 1 from queue_entries q join barbers b on b.id = q.barber_id
    where q.status in ('waiting','called')
      and (not v_facial_addon or b.role = 'therapist')
      and (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
        then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') end) = v_phone
  ) then return json_build_object('error','This phone number is already in a queue.'); end if;

  select q.status, q.created_at into v_last_status, v_last_created
    from queue_entries q join barbers b on b.id = q.barber_id
    where (not v_facial_addon or b.role = 'therapist')
      and (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
        then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') end) = v_phone
    order by q.created_at desc, q.id desc limit 1;
  if v_last_created > now() - interval '30 minutes'
     and v_last_status not in ('done','cancelled_by_barber') then
    return json_build_object('error','This number joined recently. Please wait 30 minutes from the last join, or ask staff for help.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));
  select count(*), coalesce(max(position),0)+1 into v_count, v_position
    from queue_entries where barber_id = p_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
    values (p_barber_id, v_barber_name, btrim(p_customer_name), v_phone, 'waiting', v_position, 0)
    returning id, cancel_token into v_id, v_cancel_token;
  return json_build_object('id',v_id,'cancelToken',v_cancel_token,'position',v_position,'ahead',v_count);
end; $$;
