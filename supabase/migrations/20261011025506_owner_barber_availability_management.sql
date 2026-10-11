-- Manual availability, recurring Malaysia-time off days, and owner management.
alter table public.barbers
  add column off_days integer[] not null default '{}'::integer[],
  add column is_listed boolean not null default true;
alter table public.barbers
  add constraint barbers_off_days_valid check (off_days <@ array[0,1,2,3,4,5,6]::integer[]);

-- Customers can see unavailable workers without being able to select them.
-- Keep the original view columns in order for existing clients.
grant select (off_days, is_listed) on public.barbers to anon, authenticated;
create or replace view public.barbers_public with (security_invoker = true) as
  select id, name, is_active, avg_minutes, role, sort,
    (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days)) as off_today,
    (is_active and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days))) as is_available
  from public.barbers where is_listed;

create or replace function public.get_barber_by_pin(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare b barbers%rowtype; v_off_today boolean;
begin
  select * into b from barbers where pin = p_pin limit 1;
  if not found then return null; end if;
  v_off_today := extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days);
  return json_build_object('id', b.id, 'name', b.name, 'isActive', b.is_active,
    'isAvailable', b.is_active and b.is_listed and not v_off_today,
    'offToday', v_off_today, 'isListed', b.is_listed,
    'avgMinutes', b.avg_minutes, 'role', b.role);
end; $$;

create or replace function public.toggle_active(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare b barbers%rowtype; v_off_today boolean;
begin
  update barbers set is_active = not is_active where pin = p_pin returning * into b;
  if not found then return json_build_object('error','bad_pin'); end if;
  v_off_today := extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days);
  return json_build_object('ok',true,'isActive',b.is_active,
    'isAvailable',b.is_active and b.is_listed and not v_off_today,
    'offToday',v_off_today,'isListed',b.is_listed);
end; $$;

create or replace function public.get_owner_view(p_owner_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ok text; v_rows json;
begin
  select value into v_ok from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_ok then return json_build_object('error','bad_pin'); end if;
  select coalesce(json_agg(w), '[]'::json) into v_rows from (
    select b.id, b.name, b.pin, b.is_active as "isActive", b.is_listed as "isListed",
      b.avg_minutes as "avgMinutes", b.role, b.sort, b.off_days as "offDays",
      (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days)) as "offToday",
      (b.is_active and b.is_listed and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days))) as "isAvailable",
      (select coalesce(json_agg(row_to_json(q)), '[]'::json) from (
        select id, customer_name as "customerName", phone, status, position,
          duration_minutes as "durationMinutes", called_at as "calledAt"
        from queue_entries where barber_id = b.id and status in ('waiting','called')
        order by position
      ) q) as queue
    from barbers b order by b.sort, b.name
  ) w;
  return json_build_object('ok',true,'workers',v_rows);
end; $$;

create function public.save_barber(
  p_owner_pin text, p_id text, p_name text, p_role text, p_avg_minutes integer,
  p_sort integer, p_is_active boolean, p_is_listed boolean, p_off_days integer[]
) returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_id text; v_pin text; v_days integer[];
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 80 then
    return json_build_object('error','Enter a worker name between 2 and 80 characters.');
  end if;
  if p_role not in ('barber','therapist') or p_role is null then
    return json_build_object('error','Choose barber or facial therapist.');
  end if;
  if p_avg_minutes is null or p_avg_minutes not between 5 and 240 then
    return json_build_object('error','Average time must be 5 to 240 minutes.');
  end if;
  if p_sort is null or p_sort not between 0 and 9999 then
    return json_build_object('error','Display order must be 0 to 9999.');
  end if;
  select coalesce(array_agg(distinct d order by d), '{}'::integer[])
    into v_days from unnest(coalesce(p_off_days,'{}'::integer[])) as d;
  if not (v_days <@ array[0,1,2,3,4,5,6]::integer[]) then
    return json_build_object('error','Choose valid days of the week.');
  end if;
  if p_id is null or btrim(p_id) = '' then
    v_id := gen_random_uuid()::text;
    v_pin := replace(gen_random_uuid()::text,'-','');
    insert into barbers(id,name,pin,is_active,is_listed,avg_minutes,role,sort,off_days)
      values(v_id,btrim(p_name),v_pin,coalesce(p_is_active,true),coalesce(p_is_listed,true),
        p_avg_minutes,p_role,p_sort,v_days);
  else
    update barbers set name=btrim(p_name), role=p_role, avg_minutes=p_avg_minutes,
      sort=p_sort, is_active=coalesce(p_is_active,false),
      is_listed=coalesce(p_is_listed,false), off_days=v_days
      where id=p_id returning id,pin into v_id,v_pin;
    if v_id is null then return json_build_object('error','Worker not found. Refresh the page.'); end if;
  end if;
  return json_build_object('ok',true,'id',v_id,'pin',v_pin);
end; $$;
revoke all on function public.save_barber(text,text,text,text,integer,integer,boolean,boolean,integer[]) from public, anon, authenticated;
grant execute on function public.save_barber(text,text,text,text,integer,integer,boolean,boolean,integer[]) to anon, authenticated;

create function public.rotate_barber_pin(p_owner_pin text, p_barber_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_new_pin text;
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  update barbers set pin=replace(gen_random_uuid()::text,'-','')
    where id=p_barber_id returning pin into v_new_pin;
  if v_new_pin is null then return json_build_object('error','Worker not found.'); end if;
  return json_build_object('ok',true,'pin',v_new_pin);
end; $$;
revoke all on function public.rotate_barber_pin(text,text) from public, anon, authenticated;
grant execute on function public.rotate_barber_pin(text,text) to anon, authenticated;

-- Enforce availability again inside both public join RPCs.
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
  select name, role into v_barber_name, v_role from barbers where id = p_barber_id and is_active and is_listed and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days));
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
    where id = p_barber_id and is_active and is_listed and role = 'barber' and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days));
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

-- Keep older appointment RPCs consistent with owner off-day settings.
create or replace function public.booking_slots(p_barber_id text, p_service_id uuid, p_day date)
returns json language plpgsql security definer set search_path = public as $$
declare v_duration integer; v_today date; v_slots json;
begin
  v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if p_day is null or p_day < v_today or p_day > v_today + 14 then return '[]'::json; end if;
  if not exists (select 1 from barbers where id = p_barber_id and is_active and is_listed and role = 'barber' and not (extract(dow from p_day)::integer = any(off_days))) then return '[]'::json; end if;
  select duration_minutes into v_duration from services where id = p_service_id and is_active;
  if v_duration is null then return '[]'::json; end if;
  select coalesce(json_agg(to_char(p_day + make_interval(mins => minute_of_day), 'HH24:MI') order by minute_of_day), '[]'::json)
  into v_slots
  from generate_series(660, 1365, 15) as minute_of_day
  where (p_day + make_interval(mins => minute_of_day)) at time zone 'Asia/Kuala_Lumpur' > now()
    and not exists (
      select 1 from bookings b
      where b.barber_id = p_barber_id and b.status in ('booked','checked_in')
        and b.starts_at < ((p_day + make_interval(mins => minute_of_day + v_duration)) at time zone 'Asia/Kuala_Lumpur')
        and b.starts_at + make_interval(mins => b.duration_minutes) > ((p_day + make_interval(mins => minute_of_day)) at time zone 'Asia/Kuala_Lumpur')
    );
  return v_slots;
end; $$;

create or replace function public.book_appointment(
  p_barber_id text, p_service_id uuid, p_day date, p_time text, p_customer_name text, p_phone text
) returns json language plpgsql security definer set search_path = public as $$
declare v_barber text; v_service services%rowtype; v_time time; v_start timestamptz; v_phone text; v_id uuid; v_token uuid; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if p_day is null or p_day < v_today or p_day > v_today + 14 then return json_build_object('error','Choose a date within the next 14 days.'); end if;
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return json_build_object('error','Choose a valid time.'); end if;
  v_time := p_time::time;
  if v_time < time '11:00' or v_time > time '22:45' or extract(minute from v_time)::int % 15 <> 0 then
    return json_build_object('error','Bookings start at 11:00 AM; the last start time is 10:45 PM.');
  end if;
  v_start := (p_day + v_time) at time zone 'Asia/Kuala_Lumpur';
  if v_start <= now() then return json_build_object('error','That time has passed.'); end if;
  if length(btrim(coalesce(p_customer_name,''))) not between 2 and 80 then return json_build_object('error','Enter your name.'); end if;
  v_phone := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  if length(v_phone) not between 9 and 15 then return json_build_object('error','Enter a valid phone number.'); end if;
  select name into v_barber from barbers where id = p_barber_id and is_active and is_listed and role = 'barber' and not (extract(dow from p_day)::integer = any(off_days));
  if v_barber is null then return json_build_object('error','This barber is unavailable.'); end if;
  select * into v_service from services where id = p_service_id and is_active;
  if not found then return json_build_object('error','This service is unavailable.'); end if;
  -- Serialize bookings for the same barber and day, then check overlaps inside the lock.
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|' || p_day::text, 0));
  if exists (
    select 1 from bookings b where b.barber_id = p_barber_id and b.status in ('booked','checked_in')
      and b.starts_at < v_start + make_interval(mins => v_service.duration_minutes)
      and b.starts_at + make_interval(mins => b.duration_minutes) > v_start
  ) then return json_build_object('error','That time was just taken. Choose another.'); end if;
  if (select count(*) from bookings b where b.phone = v_phone and b.status = 'booked'
      and (b.starts_at at time zone 'Asia/Kuala_Lumpur')::date = p_day) >= 2 then
    return json_build_object('error','This number already has two bookings for that day.');
  end if;
  insert into bookings (barber_id, service_id, service_name, duration_minutes, customer_name, phone, starts_at)
  values (p_barber_id, p_service_id, v_service.name, v_service.duration_minutes, btrim(p_customer_name), v_phone, v_start)
  returning id, customer_token into v_id, v_token;
  return json_build_object('id',v_id,'token',v_token,'barber',v_barber,'service',v_service.name,
    'durationMinutes',v_service.duration_minutes,'startsAt',v_start);
end; $$;
