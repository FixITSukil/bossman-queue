-- Serialize call-next for each barber and reject a second call while someone
-- is being served. Report a real error when a status update changed no row.
create or replace function public.call_next(p_pin text, p_duration int)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_next uuid;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id || '|queue', 0));
  if exists (select 1 from queue_entries where barber_id = v_id and status = 'called') then
    return json_build_object('error','Finish the current customer before calling another.');
  end if;
  select id into v_next from queue_entries
    where barber_id = v_id and status = 'waiting' order by position limit 1;
  if v_next is null then return json_build_object('error','No one waiting.'); end if;
  update queue_entries set status = 'called', called_at = now(),
    duration_minutes = greatest(5, least(120, coalesce(p_duration,35)))
    where id = v_next and status = 'waiting' returning id into v_next;
  if v_next is null then return json_build_object('error','Queue changed. Please refresh.'); end if;
  return json_build_object('ok',true,'entryId',v_next);
end; $$;

create or replace function public.set_status(p_pin text, p_entry_id uuid, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_updated uuid;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  if p_status not in ('done','no_show','called','waiting') then
    return json_build_object('error','bad_status');
  end if;
  update queue_entries set status = p_status
    where id = p_entry_id and barber_id = v_id
      and status in ('waiting','called')
      and (p_status <> 'done' or status = 'called')
    returning id into v_updated;
  if v_updated is null then
    return json_build_object('error','Customer status changed. Refresh the queue.');
  end if;
  return json_build_object('ok',true,'entryId',v_updated);
end; $$;
