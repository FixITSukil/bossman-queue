-- Remote appointments remain separate from the walk-in queue until staff check in a customer.
-- All appointment times are interpreted in Malaysia time.
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  duration_minutes integer not null check (duration_minutes between 5 and 240),
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.services enable row level security;
revoke all on public.services from anon, authenticated;
grant select (id, name, duration_minutes, is_active, sort) on public.services to anon, authenticated;
drop policy if exists services_active_read on public.services;
create policy services_active_read on public.services for select to anon, authenticated using (is_active);
create or replace view public.services_public with (security_invoker = true) as
  select id, name, duration_minutes, sort from public.services where is_active;
grant select on public.services_public to anon, authenticated;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  barber_id text not null references public.barbers(id),
  service_id uuid not null references public.services(id),
  service_name text not null,
  duration_minutes integer not null check (duration_minutes between 5 and 240),
  customer_name text not null,
  phone text not null,
  starts_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','checked_in','cancelled','no_show')),
  customer_token uuid not null default gen_random_uuid(),
  queue_entry_id uuid references public.queue_entries(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bookings_barber_start_idx on public.bookings (barber_id, starts_at) where status in ('booked','checked_in');
alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;

create or replace function public.booking_slots(p_barber_id text, p_service_id uuid, p_day date)
returns json language plpgsql security definer set search_path = public as $$
declare v_duration integer; v_today date; v_slots json;
begin
  v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if p_day is null or p_day < v_today or p_day > v_today + 14 then return '[]'::json; end if;
  if not exists (select 1 from barbers where id = p_barber_id and is_active and role = 'barber') then return '[]'::json; end if;
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
  select name into v_barber from barbers where id = p_barber_id and is_active and role = 'barber';
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

create or replace function public.get_booking(p_booking_id uuid, p_customer_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_result json;
begin
  select json_build_object('id',b.id,'barberId',b.barber_id,'barber',r.name,'service',b.service_name,
    'durationMinutes',b.duration_minutes,'startsAt',b.starts_at,'status',b.status,
    'queueEntryId',b.queue_entry_id) into v_result
  from bookings b join barbers r on r.id = b.barber_id
  where b.id = p_booking_id and b.customer_token = p_customer_token;
  return v_result;
end; $$;

create or replace function public.get_owner_bookings(p_owner_pin text, p_day date)
returns json language plpgsql security definer set search_path = public as $$
declare v_pin text; v_rows json;
begin
  select value into v_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_pin then return json_build_object('error','bad_pin'); end if;
  select coalesce(json_agg(row_to_json(t) order by t."startsAt"), '[]'::json) into v_rows from (
    select b.id, r.name as "barberName", b.customer_name as "customerName", b.phone,
      b.service_name as "serviceName", b.duration_minutes as "durationMinutes",
      b.starts_at as "startsAt", b.status
    from bookings b join barbers r on r.id = b.barber_id
    where (b.starts_at at time zone 'Asia/Kuala_Lumpur')::date = p_day
  ) t;
  return v_rows;
end; $$;

create or replace function public.cancel_booking(p_booking_id uuid, p_customer_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  update bookings set status = 'cancelled' where id = p_booking_id and customer_token = p_customer_token and status = 'booked';
  if not found then return json_build_object('error','This booking cannot be cancelled.'); end if;
  return json_build_object('ok',true);
end; $$;

create or replace function public.get_bookings_for_barber(p_pin text, p_day date)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_rows json;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  select coalesce(json_agg(row_to_json(t) order by t."startsAt"), '[]'::json) into v_rows from (
    select id, customer_name as "customerName", phone, service_name as "serviceName",
      duration_minutes as "durationMinutes", starts_at as "startsAt", status
    from bookings where barber_id = v_id and (starts_at at time zone 'Asia/Kuala_Lumpur')::date = p_day
      and status in ('booked','checked_in','no_show')
  ) t;
  return v_rows;
end; $$;

create or replace function public.check_in_booking(p_pin text, p_booking_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_barber_id text; v_booking bookings%rowtype; v_position integer; v_entry uuid;
begin
  select id into v_barber_id from barbers where pin = p_pin limit 1;
  if v_barber_id is null then return json_build_object('error','bad_pin'); end if;
  select * into v_booking from bookings where id = p_booking_id and barber_id = v_barber_id for update;
  if not found or v_booking.status <> 'booked' then return json_build_object('error','Booking is no longer available.'); end if;
  if (v_booking.starts_at at time zone 'Asia/Kuala_Lumpur')::date <> (now() at time zone 'Asia/Kuala_Lumpur')::date then
    return json_build_object('error','Check-in is only available on the booking day.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_barber_id || '|queue', 0));
  select coalesce(max(position),0) + 1 into v_position from queue_entries
    where barber_id = v_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
  values (v_barber_id, (select name from barbers where id = v_barber_id), v_booking.customer_name,
    v_booking.phone, 'waiting', v_position, v_booking.duration_minutes)
  returning id into v_entry;
  update bookings set status = 'checked_in', queue_entry_id = v_entry where id = p_booking_id;
  return json_build_object('ok',true,'queueEntryId',v_entry);
end; $$;

create or replace function public.booking_no_show(p_pin text, p_booking_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  update bookings set status = 'no_show' where id = p_booking_id and barber_id = v_id and status = 'booked';
  if not found then return json_build_object('error','Booking is no longer available.'); end if;
  return json_build_object('ok',true);
end; $$;

create or replace function public.get_owner_services(p_owner_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_pin text; v_rows json;
begin
  select value into v_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_pin then return json_build_object('error','bad_pin'); end if;
  select coalesce(json_agg(row_to_json(t) order by t.sort,t.name), '[]'::json) into v_rows from (
    select id,name,duration_minutes as "durationMinutes",is_active as "isActive",sort from services
  ) t;
  return v_rows;
end; $$;

create or replace function public.save_service(p_owner_pin text, p_service_id uuid, p_name text, p_duration_minutes integer, p_is_active boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_pin text; v_id uuid;
begin
  select value into v_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_pin then return json_build_object('error','bad_pin'); end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 80 or coalesce(p_duration_minutes,0) not between 5 and 240 then
    return json_build_object('error','Use a service name and a duration from 5 to 240 minutes.');
  end if;
  if p_service_id is null then
    insert into services(name,duration_minutes,is_active,sort)
    values (btrim(p_name),p_duration_minutes,coalesce(p_is_active,true),coalesce((select max(sort)+1 from services),1))
    returning id into v_id;
  else
    update services set name=btrim(p_name),duration_minutes=p_duration_minutes,is_active=coalesce(p_is_active,true)
    where id=p_service_id returning id into v_id;
    if v_id is null then return json_build_object('error','Service not found.'); end if;
  end if;
  return json_build_object('ok',true,'id',v_id);
exception when unique_violation then
  return json_build_object('error','A service with that name already exists.');
end; $$;

revoke all on function public.booking_slots(text,uuid,date) from public;
revoke all on function public.book_appointment(text,uuid,date,text,text,text) from public;
revoke all on function public.get_booking(uuid,uuid) from public;
revoke all on function public.cancel_booking(uuid,uuid) from public;
revoke all on function public.get_bookings_for_barber(text,date) from public;
revoke all on function public.check_in_booking(text,uuid) from public;
revoke all on function public.booking_no_show(text,uuid) from public;
revoke all on function public.get_owner_services(text) from public;
revoke all on function public.get_owner_bookings(text,date) from public;
revoke all on function public.save_service(text,uuid,text,integer,boolean) from public;
grant execute on function public.booking_slots(text,uuid,date) to anon,authenticated;
grant execute on function public.book_appointment(text,uuid,date,text,text,text) to anon,authenticated;
grant execute on function public.get_booking(uuid,uuid) to anon,authenticated;
grant execute on function public.cancel_booking(uuid,uuid) to anon,authenticated;
grant execute on function public.get_bookings_for_barber(text,date) to anon,authenticated;
grant execute on function public.check_in_booking(text,uuid) to anon,authenticated;
grant execute on function public.booking_no_show(text,uuid) to anon,authenticated;
grant execute on function public.get_owner_services(text) to anon,authenticated;
grant execute on function public.get_owner_bookings(text,date) to anon,authenticated;
grant execute on function public.save_service(text,uuid,text,integer,boolean) to anon,authenticated;
