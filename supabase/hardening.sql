-- ============================================================
-- BOSSMAN QUEUE — Security hardening
-- Locks down the public key: no PINs / phone numbers readable,
-- all writes go through validated functions.
-- Paste + run in Supabase SQL Editor (after schema.sql). Safe to re-run.
-- ============================================================

-- Owner dashboard PIN (change '8888' to your own)
insert into app_config (key, value) values ('owner_pin', '8888')
on conflict (key) do nothing;

-- ── Remove direct table access from the public key ───────
drop policy if exists b_sel on barbers;
drop policy if exists b_upd on barbers;
drop policy if exists q_sel on queue_entries;
drop policy if exists q_upd on queue_entries;
revoke all on barbers       from anon, authenticated;
revoke all on queue_entries from anon, authenticated;

-- ── Public views (NO pin, NO phone, NO names) ────────────
create or replace view barbers_public as
  select id, name, is_active, avg_minutes, role, sort from barbers;

create or replace view queue_public as
  select id, barber_id, status, position, duration_minutes, called_at, created_at
  from queue_entries;

grant select on barbers_public, queue_public to anon, authenticated;

-- ── Helper: resolve a barber by PIN ──────────────────────
create or replace function get_barber_by_pin(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare b barbers%rowtype;
begin
  select * into b from barbers where pin = p_pin limit 1;
  if not found then return null; end if;
  return json_build_object('id', b.id, 'name', b.name, 'isActive', b.is_active,
                           'avgMinutes', b.avg_minutes, 'role', b.role);
end; $$;

-- ── Barber's own queue (full detail incl. phone) — needs PIN ──
create or replace function get_queue_for_barber(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_rows json;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return '[]'::json; end if;
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_rows from (
    select id, barber_id as "barberId", barber_name as "barberName",
           customer_name as "customerName", phone, status, position,
           duration_minutes as "durationMinutes", called_at as "calledAt"
    from queue_entries
    where barber_id = v_id and status in ('waiting','called')
    order by position
  ) t;
  return v_rows;
end; $$;

-- ── Barber actions (all require PIN) ─────────────────────
create or replace function call_next(p_pin text, p_duration int)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_next uuid; v_name text;
begin
  select id, name into v_id, v_name from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  select id into v_next from queue_entries
    where barber_id = v_id and status = 'waiting' order by position limit 1;
  if v_next is null then return json_build_object('error','No one waiting'); end if;
  update queue_entries set status='called', called_at=now(), duration_minutes=coalesce(p_duration,35)
    where id = v_next;
  return json_build_object('ok', true);
end; $$;

create or replace function set_status(p_pin text, p_entry_id uuid, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  if p_status not in ('done','no_show','called','waiting') then
    return json_build_object('error','bad_status');
  end if;
  update queue_entries set status = p_status
    where id = p_entry_id and barber_id = v_id;
  return json_build_object('ok', true);
end; $$;

create or replace function toggle_active(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id text; v_new boolean;
begin
  select id into v_id from barbers where pin = p_pin limit 1;
  if v_id is null then return json_build_object('error','bad_pin'); end if;
  update barbers set is_active = not is_active where id = v_id returning is_active into v_new;
  return json_build_object('ok', true, 'isActive', v_new);
end; $$;

-- ── Customer self-cancel (the entry UUID is the authorisation) ──
create or replace function leave_queue(p_entry_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  update queue_entries set status = 'no_show'
    where id = p_entry_id and status in ('waiting','called');
  return json_build_object('ok', true);
end; $$;

-- ── Owner view (all workers + queues) — needs owner PIN ──
create or replace function get_owner_view(p_owner_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ok text; v_rows json;
begin
  select value into v_ok from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_ok then
    return json_build_object('error','bad_pin');
  end if;
  select coalesce(json_agg(w), '[]'::json) into v_rows from (
    select b.id, b.name, b.is_active as "isActive", b.avg_minutes as "avgMinutes", b.role,
      ( select coalesce(json_agg(row_to_json(q)), '[]'::json) from (
          select id, customer_name as "customerName", phone, status, position,
                 duration_minutes as "durationMinutes", called_at as "calledAt"
          from queue_entries
          where barber_id = b.id and status in ('waiting','called')
          order by position
        ) q
      ) as queue
    from barbers b order by b.sort, b.name
  ) w;
  return json_build_object('ok', true, 'workers', v_rows);
end; $$;

grant execute on function get_barber_by_pin(text)               to anon, authenticated;
grant execute on function get_queue_for_barber(text)            to anon, authenticated;
grant execute on function call_next(text,int)                   to anon, authenticated;
grant execute on function set_status(text,uuid,text)            to anon, authenticated;
grant execute on function toggle_active(text)                   to anon, authenticated;
grant execute on function leave_queue(uuid)                     to anon, authenticated;
grant execute on function get_owner_view(text)                  to anon, authenticated;
