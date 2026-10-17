-- Allow a barber to add a short walk-in service at a selected place in their own queue.
-- The selected position is represented by the waiting entry that the new customer
-- should be inserted before. Passing NULL appends the customer to the end.

create or replace function public.insert_quick_service_customer(
  p_pin text,
  p_customer_name text,
  p_phone text,
  p_duration_minutes integer,
  p_before_entry_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barber_id text;
  v_barber_name text;
  v_customer_name text;
  v_phone text;
  v_target_position integer;
  v_id uuid;
  v_cancel_token uuid;
  v_ahead integer;
begin
  select b.id, b.name
    into v_barber_id, v_barber_name
  from public.barbers b
  where b.pin = p_pin
    and b.deleted_at is null
  limit 1;

  if v_barber_id is null then
    return json_build_object('error', 'Invalid barber link.');
  end if;

  v_customer_name := btrim(coalesce(p_customer_name, ''));
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if left(v_phone, 1) = '0' then
    v_phone := '60' || substring(v_phone from 2);
  end if;

  if length(v_customer_name) not between 2 and 80 then
    return json_build_object('error', 'Enter the customer name.');
  end if;
  if length(v_phone) not between 9 and 15 then
    return json_build_object('error', 'Enter a valid customer phone number.');
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 120 then
    return json_build_object('error', 'Service time must be between 5 and 120 minutes.');
  end if;

  -- Prevent the same phone number from occupying two active queue places.
  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));
  if exists (
    select 1
    from public.queue_entries q
    where q.status in ('waiting', 'called')
      and (
        case
          when left(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), 1) = '0'
            then '60' || substring(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g') from 2)
          else regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
        end
      ) = v_phone
  ) then
    return json_build_object('error', 'This phone number is already in an active queue.');
  end if;

  -- Serialize all position changes for this barber.
  perform pg_advisory_xact_lock(hashtextextended(v_barber_id || '|queue', 0));

  if p_before_entry_id is not null then
    select q.position
      into v_target_position
    from public.queue_entries q
    where q.id = p_before_entry_id
      and q.barber_id = v_barber_id
      and q.status = 'waiting'
    limit 1;

    if v_target_position is null then
      return json_build_object(
        'error',
        'That queue position has changed. Refresh the queue and try again.'
      );
    end if;
  else
    select coalesce(max(q.position), 0) + 1
      into v_target_position
    from public.queue_entries q
    where q.barber_id = v_barber_id
      and q.status in ('waiting', 'called');
  end if;

  update public.queue_entries
  set position = position + 1
  where barber_id = v_barber_id
    and status = 'waiting'
    and position >= v_target_position;

  insert into public.queue_entries (
    barber_id,
    barber_name,
    customer_name,
    phone,
    status,
    position,
    duration_minutes
  )
  values (
    v_barber_id,
    v_barber_name,
    v_customer_name,
    v_phone,
    'waiting',
    v_target_position,
    p_duration_minutes
  )
  returning id, cancel_token into v_id, v_cancel_token;

  select count(*)
    into v_ahead
  from public.queue_entries q
  where q.barber_id = v_barber_id
    and q.status in ('waiting', 'called')
    and q.id <> v_id
    and q.position < v_target_position;

  return json_build_object(
    'ok', true,
    'id', v_id,
    'cancelToken', v_cancel_token,
    'customerName', v_customer_name,
    'position', v_target_position,
    'ahead', v_ahead,
    'durationMinutes', p_duration_minutes
  );
end;
$$;

revoke all on function public.insert_quick_service_customer(text, text, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_quick_service_customer(text, text, text, integer, uuid)
  to anon, authenticated;
