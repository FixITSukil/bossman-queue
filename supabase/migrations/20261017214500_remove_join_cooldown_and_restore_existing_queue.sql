-- Remove the obsolete 30-minute rejoin cooldown.
-- Active duplicate queue places remain blocked, but the client receives a
-- structured hint to reopen the existing queue instead of creating another.

create or replace function public.join_queue(
  p_barber_id text,
  p_barber_name text,
  p_customer_name text,
  p_phone text,
  p_token text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_count integer;
  v_position integer;
  v_id uuid;
  v_cancel_token uuid;
  v_barber_name text;
  v_role text;
  v_local_time time;
  v_facial_addon boolean;
  v_existing_id uuid;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object(
      'error', 'The queue is not open right now. Please join from 11:00 AM to 10:45 PM Malaysia time.'
    );
  end if;

  select b.name, b.role
    into v_barber_name, v_role
  from public.barbers b
  where b.id = p_barber_id
    and b.is_active = true
    and b.is_listed = true
    and b.deleted_at is null
    and not (
      extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer
      = any(coalesce(b.off_days, '{}'::integer[]))
    )
  limit 1;

  if v_barber_name is null then
    return json_build_object('error', 'Barber unavailable.');
  end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if left(v_phone, 1) = '0' then
    v_phone := '60' || substring(v_phone from 2);
  end if;

  if length(btrim(coalesce(p_customer_name, ''))) < 2
     or length(v_phone) not between 9 and 15 then
    return json_build_object('error', 'Enter a name and valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));

  select v_role = 'therapist' and exists (
    select 1
    from public.queue_entries q
    join public.barbers b on b.id = q.barber_id
    where b.role = 'barber'
      and q.status in ('waiting', 'called')
      and (
        case
          when left(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), 1) = '0'
            then '60' || substring(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g') from 2)
          else regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
        end
      ) = v_phone
  ) into v_facial_addon;

  select q.id
    into v_existing_id
  from public.queue_entries q
  join public.barbers b on b.id = q.barber_id
  where q.status in ('waiting', 'called')
    and (not v_facial_addon or b.role = 'therapist')
    and (
      case
        when left(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), 1) = '0'
          then '60' || substring(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
      end
    ) = v_phone
  order by q.created_at desc, q.id desc
  limit 1;

  if v_existing_id is not null then
    return json_build_object(
      'error', 'This number is already in a queue. Use Find My Queue below to reopen your live queue.',
      'code', 'already_in_queue',
      'activeQueue', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));

  select count(*), coalesce(max(q.position), 0) + 1
    into v_count, v_position
  from public.queue_entries q
  where q.barber_id = p_barber_id
    and q.status in ('waiting', 'called');

  insert into public.queue_entries (
    barber_id, barber_name, customer_name, phone,
    status, position, duration_minutes
  )
  values (
    p_barber_id, v_barber_name, btrim(p_customer_name), v_phone,
    'waiting', v_position, 0
  )
  returning id, cancel_token into v_id, v_cancel_token;

  return json_build_object(
    'id', v_id,
    'cancelToken', v_cancel_token,
    'position', v_position,
    'ahead', v_count
  );
end;
$$;

revoke all on function public.join_queue(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_queue(text, text, text, text, text)
  to anon, authenticated;

create or replace function public.join_queue_remote(
  p_barber_id text,
  p_customer_name text,
  p_phone text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_time time;
  v_barber_name text;
  v_phone text;
  v_count integer;
  v_position integer;
  v_id uuid;
  v_cancel_token uuid;
  v_existing_id uuid;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object(
      'error', 'Online queue opens at 11:00 AM and closes at 10:45 PM Malaysia time.'
    );
  end if;

  select b.name
    into v_barber_name
  from public.barbers b
  where b.id = p_barber_id
    and b.is_active = true
    and b.is_listed = true
    and b.role = 'barber'
    and b.deleted_at is null
    and not (
      extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer
      = any(coalesce(b.off_days, '{}'::integer[]))
    )
  limit 1;

  if v_barber_name is null then
    return json_build_object('error', 'This barber is unavailable.');
  end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if left(v_phone, 1) = '0' then
    v_phone := '60' || substring(v_phone from 2);
  end if;

  if length(btrim(coalesce(p_customer_name, ''))) not between 2 and 80
     or length(v_phone) not between 9 and 15 then
    return json_build_object('error', 'Enter your name and a valid phone number.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer|' || v_phone, 0));

  select q.id
    into v_existing_id
  from public.queue_entries q
  where q.status in ('waiting', 'called')
    and (
      case
        when left(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), 1) = '0'
          then '60' || substring(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
      end
    ) = v_phone
  order by q.created_at desc, q.id desc
  limit 1;

  if v_existing_id is not null then
    return json_build_object(
      'error', 'This number is already in a queue. Use Find My Queue to reopen your live queue.',
      'code', 'already_in_queue',
      'activeQueue', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));

  select count(*), coalesce(max(q.position), 0) + 1
    into v_count, v_position
  from public.queue_entries q
  where q.barber_id = p_barber_id
    and q.status in ('waiting', 'called');

  insert into public.queue_entries (
    barber_id, barber_name, customer_name, phone,
    status, position, duration_minutes
  )
  values (
    p_barber_id, v_barber_name, btrim(p_customer_name), v_phone,
    'waiting', v_position, 0
  )
  returning id, cancel_token into v_id, v_cancel_token;

  return json_build_object(
    'id', v_id,
    'cancelToken', v_cancel_token,
    'position', v_position,
    'ahead', v_count
  );
end;
$$;

revoke all on function public.join_queue_remote(text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_queue_remote(text, text, text)
  to anon, authenticated;
