-- Allow the owner of a waiting queue entry to move to another available barber.
-- The same queue entry ID and private cancel token are preserved so the
-- customer's live page, turn alert subscription and recovery flow stay linked.

create or replace function public.switch_queue_barber(
  p_entry_id uuid,
  p_cancel_token uuid,
  p_target_barber_id text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_barber_id text;
  v_source_position integer;
  v_status text;
  v_target_name text;
  v_target_avg integer;
  v_target_position integer;
  v_ahead integer;
  v_today_dow integer;
begin
  if p_entry_id is null or p_cancel_token is null or nullif(btrim(coalesce(p_target_barber_id, '')), '') is null then
    return json_build_object('error', 'The barber change request is incomplete.');
  end if;

  select q.barber_id, q.position, q.status
    into v_source_barber_id, v_source_position, v_status
  from public.queue_entries q
  where q.id = p_entry_id
    and q.cancel_token = p_cancel_token
  for update;

  if v_source_barber_id is null then
    return json_build_object('error', 'This queue session could not be verified. Please use the original registration page or ask staff for help.');
  end if;

  if v_status <> 'waiting' then
    return json_build_object('error', 'You can only change barber while you are still waiting.');
  end if;

  if exists (
    select 1 from public.bookings b where b.queue_entry_id = p_entry_id
  ) then
    return json_build_object('error', 'Appointments must be changed by Bossman staff.');
  end if;

  if v_source_barber_id = p_target_barber_id then
    return json_build_object('error', 'You are already in this barber queue.');
  end if;

  v_today_dow := extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer;

  select b.name, b.avg_minutes
    into v_target_name, v_target_avg
  from public.barbers b
  where b.id = p_target_barber_id
    and b.role = 'barber'
    and b.is_active = true
    and b.is_listed = true
    and b.deleted_at is null
    and not (v_today_dow = any(coalesce(b.off_days, '{}'::integer[])))
  limit 1;

  if v_target_name is null then
    return json_build_object('error', 'That barber is not accepting customers right now.');
  end if;

  if v_source_barber_id < p_target_barber_id then
    perform pg_advisory_xact_lock(hashtextextended(v_source_barber_id || '|queue', 0));
    perform pg_advisory_xact_lock(hashtextextended(p_target_barber_id || '|queue', 0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_target_barber_id || '|queue', 0));
    perform pg_advisory_xact_lock(hashtextextended(v_source_barber_id || '|queue', 0));
  end if;

  select b.name, b.avg_minutes
    into v_target_name, v_target_avg
  from public.barbers b
  where b.id = p_target_barber_id
    and b.role = 'barber'
    and b.is_active = true
    and b.is_listed = true
    and b.deleted_at is null
    and not (v_today_dow = any(coalesce(b.off_days, '{}'::integer[])))
  limit 1;

  if v_target_name is null then
    return json_build_object('error', 'That barber is no longer accepting customers.');
  end if;

  select coalesce(max(q.position), 0) + 1
    into v_target_position
  from public.queue_entries q
  where q.barber_id = p_target_barber_id
    and q.status in ('waiting', 'called');

  update public.queue_entries
  set position = position - 1
  where barber_id = v_source_barber_id
    and status = 'waiting'
    and position > v_source_position;

  update public.queue_entries
  set barber_id = p_target_barber_id,
      barber_name = v_target_name,
      position = v_target_position,
      status = 'waiting',
      called_at = null
  where id = p_entry_id
    and cancel_token = p_cancel_token
    and status = 'waiting';

  if not found then
    return json_build_object('error', 'Your queue status changed before the barber switch completed. Please refresh.');
  end if;

  select count(*)
    into v_ahead
  from public.queue_entries q
  where q.barber_id = p_target_barber_id
    and q.status in ('waiting', 'called')
    and q.id <> p_entry_id
    and q.position < v_target_position;

  return json_build_object(
    'ok', true,
    'entryId', p_entry_id,
    'oldBarberId', v_source_barber_id,
    'barberId', p_target_barber_id,
    'barberName', v_target_name,
    'avgMinutes', coalesce(v_target_avg, 35),
    'position', v_target_position,
    'ahead', v_ahead
  );
end;
$$;

revoke all on function public.switch_queue_barber(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.switch_queue_barber(uuid, uuid, text)
  to anon, authenticated;

do $test$
declare
  v_source_id constant text := '__switch_test_source_20261017__';
  v_target_id constant text := '__switch_test_target_20261017__';
  v_token uuid := gen_random_uuid();
  v_move_id uuid := gen_random_uuid();
  v_result json;
begin
  insert into public.barbers (id, name, pin, is_active, avg_minutes, role, sort, off_days, is_listed)
  values
    (v_source_id, 'Switch Test Source', encode(gen_random_bytes(16), 'hex'), true, 35, 'barber', 9998, '{}'::integer[], true),
    (v_target_id, 'Switch Test Target', encode(gen_random_bytes(16), 'hex'), true, 20, 'barber', 9999, '{}'::integer[], true);

  insert into public.queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes, called_at)
  values
    (v_source_id, 'Switch Test Source', 'Source Serving', '601100000001', 'called', 1, 35, now()),
    (v_source_id, 'Switch Test Source', 'Move Me', '601100000002', 'waiting', 2, 0, null),
    (v_source_id, 'Switch Test Source', 'Source After', '601100000003', 'waiting', 3, 0, null),
    (v_target_id, 'Switch Test Target', 'Target Serving', '601100000004', 'called', 1, 20, now()),
    (v_target_id, 'Switch Test Target', 'Target Waiting', '601100000005', 'waiting', 2, 0, null);

  update public.queue_entries
  set id = v_move_id, cancel_token = v_token
  where barber_id = v_source_id and customer_name = 'Move Me';

  select public.switch_queue_barber(v_move_id, v_token, v_target_id)
    into v_result;

  if coalesce(v_result->>'ok', 'false') <> 'true' then
    raise exception 'switch_queue_barber self-test failed: %', v_result;
  end if;

  if (v_result->>'position')::integer <> 3 or (v_result->>'ahead')::integer <> 2 then
    raise exception 'switch_queue_barber returned the wrong target position: %', v_result;
  end if;

  if not exists (
    select 1 from public.queue_entries
    where id = v_move_id and barber_id = v_target_id and position = 3 and status = 'waiting'
  ) then
    raise exception 'switch_queue_barber did not move the entry correctly';
  end if;

  if not exists (
    select 1 from public.queue_entries
    where barber_id = v_source_id and customer_name = 'Source After' and position = 2
  ) then
    raise exception 'switch_queue_barber did not close the original queue position gap';
  end if;

  delete from public.queue_entries where barber_id in (v_source_id, v_target_id);
  delete from public.barbers where id in (v_source_id, v_target_id);
end;
$test$;
