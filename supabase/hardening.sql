-- ============================================================
-- BOSSMAN QUEUE — Production security hardening
-- Run after schema.sql. Safe to re-run.
-- ============================================================

-- Private dashboard and kiosk secrets are generated on first setup.
-- Never commit production values to GitHub.
insert into app_config (key, value)
values ('owner_pin', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

insert into app_config (key, value)
values ('kiosk_secret', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

-- ── Remove broad table access ─────────────────────────────
drop policy if exists b_sel on barbers;
drop policy if exists b_upd on barbers;
drop policy if exists q_sel on queue_entries;
drop policy if exists q_upd on queue_entries;
revoke all on barbers       from anon, authenticated;
revoke all on queue_entries from anon, authenticated;

-- ── Public read model: safe columns only ──────────────────
drop policy if exists b_public_read on barbers;
create policy b_public_read on barbers for select to anon, authenticated using (true);
drop policy if exists q_public_read on queue_entries;
create policy q_public_read on queue_entries for select to anon, authenticated using (true);

grant select (id, name, is_active, avg_minutes, role, sort)
  on barbers to anon, authenticated;
grant select (id, barber_id, status, position, duration_minutes, called_at, created_at)
  on queue_entries to anon, authenticated;

create or replace view barbers_public with (security_invoker = true) as
  select id, name, is_active, avg_minutes, role, sort from barbers;

create or replace view queue_public with (security_invoker = true) as
  select id, barber_id, status, position, duration_minutes, called_at, created_at
  from queue_entries;

grant select on barbers_public, queue_public to anon, authenticated;

-- ── Private kiosk QR token endpoint (2-minute window) ────
-- The public no-argument token endpoint from schema.sql is disabled.
create or replace function get_qr_token(p_kiosk_secret text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_kiosk text; v_win bigint; v_tok text; v_secs int;
begin
  select value into v_kiosk from app_config where key = 'kiosk_secret';
  if p_kiosk_secret is null or p_kiosk_secret <> v_kiosk then
    return json_build_object('error','bad_kiosk_secret');
  end if;

  select value into v_secret from app_config where key = 'qr_secret';
  v_win  := floor(extract(epoch from now()) / 120)::bigint;
  v_tok  := substring(encode(digest(v_win::text || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
  v_secs := ((v_win + 1) * 120 - extract(epoch from now()))::int;
  return json_build_object('token', v_tok, 'secondsLeft', v_secs);
end; $$;

revoke execute on function get_qr_token() from public, anon, authenticated;
grant execute on function get_qr_token(text) to anon, authenticated;

-- ── Helper: resolve a worker by private secret ────────────
create or replace function get_barber_by_pin(p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare b barbers%rowtype;
begin
  select * into b from barbers where pin = p_pin limit 1;
  if not found then return null; end if;
  return json_build_object('id', b.id, 'name', b.name, 'isActive', b.is_active,
                           'avgMinutes', b.avg_minutes, 'role', b.role);
end; $$;

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

create or replace function leave_queue(p_entry_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  update queue_entries set status = 'no_show'
    where id = p_entry_id and status in ('waiting','called');
  return json_build_object('ok', true);
end; $$;

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

grant execute on function get_barber_by_pin(text)     to anon, authenticated;
grant execute on function get_queue_for_barber(text)  to anon, authenticated;
grant execute on function call_next(text,int)         to anon, authenticated;
grant execute on function set_status(text,uuid,text)  to anon, authenticated;
grant execute on function toggle_active(text)         to anon, authenticated;
grant execute on function leave_queue(uuid)           to anon, authenticated;
grant execute on function get_owner_view(text)        to anon, authenticated;
