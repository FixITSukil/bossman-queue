-- A public queue ID is not proof that the caller owns the place.
-- Keep this token private: queue_public and barber/owner views never expose it.
alter table public.queue_entries
  add column cancel_token uuid not null default gen_random_uuid();

-- Remove the old ID-only cancellation endpoint before exposing the replacement.
drop function public.leave_queue(uuid);

create function public.leave_queue(p_entry_id uuid, p_cancel_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_entry_id is null or p_cancel_token is null then
    return json_build_object('error','This booking needs its private cancellation key. Please ask staff for help.');
  end if;
  update queue_entries set status = 'cancelled_by_customer'
    where id = p_entry_id and cancel_token = p_cancel_token
      and status in ('waiting','called')
    returning id into v_id;
  if v_id is null then
    return json_build_object('error','Could not cancel this booking. Please ask staff for help.');
  end if;
  return json_build_object('ok',true);
end; $$;
revoke all on function public.leave_queue(uuid,uuid) from public, anon, authenticated;
grant execute on function public.leave_queue(uuid,uuid) to anon, authenticated;

-- The counter QR is a permanent link. Both join routes must enforce the
-- same server-side one-place and 30-minute rules, regardless of browser.
create or replace function public.join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone text; v_count integer; v_position integer; v_id uuid; v_cancel_token uuid;
  v_barber_name text; v_local_time time; v_last_status text; v_last_created timestamptz;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object('error','The queue is not open right now. Please join from 11:00 AM to 10:45 PM Malaysia time.');
  end if;
  select name into v_barber_name from barbers where id = p_barber_id and is_active;
  if v_barber_name is null then return json_build_object('error','Barber unavailable.'); end if;
  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if left(v_phone,1) = '0' then v_phone := '60' || substring(v_phone from 2); end if;
  if length(btrim(coalesce(p_customer_name,''))) < 2 or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter a name and valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));
  if exists (
    select 1 from queue_entries q where q.status in ('waiting','called')
      and (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
        then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') end) = v_phone
  ) then return json_build_object('error','This phone number is already in a queue.'); end if;
  select q.status, q.created_at into v_last_status, v_last_created
    from queue_entries q
    where (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
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

create or replace function public.join_queue_remote(
  p_barber_id text, p_customer_name text, p_phone text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_local_time time; v_barber_name text; v_phone text; v_count integer;
  v_position integer; v_id uuid; v_cancel_token uuid;
  v_last_status text; v_last_created timestamptz;
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
    select 1 from queue_entries q where q.status in ('waiting','called')
      and (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
        then '60' || substring(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g') end) = v_phone
  ) then return json_build_object('error','This phone number is already in a queue. Open your existing queue page or cancel that place first.'); end if;
  select q.status, q.created_at into v_last_status, v_last_created
    from queue_entries q
    where (case when left(regexp_replace(coalesce(q.phone,''), '[^0-9]', '', 'g'),1) = '0'
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
