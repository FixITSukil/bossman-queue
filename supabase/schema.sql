-- ============================================================
-- BOSSMAN QUEUE — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to re-run.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ── Tables ───────────────────────────────────────────────
create table if not exists barbers (
  id          text primary key,
  name        text not null,
  pin         text not null,
  is_active   boolean not null default true,
  avg_minutes int not null default 35,
  role        text not null default 'barber',   -- 'barber' | 'therapist'
  sort        int  not null default 0
);

create table if not exists queue_entries (
  id               uuid primary key default gen_random_uuid(),
  barber_id        text references barbers(id),
  barber_name      text,
  customer_name    text,
  phone            text,
  status           text not null default 'waiting', -- waiting|called|done|no_show
  position         int,
  duration_minutes int default 0,
  called_at        timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_queue_barber_status on queue_entries (barber_id, status);

create table if not exists app_config (
  key   text primary key,
  value text
);
insert into app_config (key, value) values
  ('qr_secret', 'Boss$man-2024-stag-r0t'),
  ('require_token', 'true')
on conflict (key) do nothing;

-- ── Seed workers (edit names / pins here if needed) ──────
insert into barbers (id, name, pin, is_active, avg_minutes, role, sort) values
  ('barber1', 'Assaf', '1111', true, 35, 'barber',    1),
  ('barber2', 'Karam', '2222', true, 35, 'barber',    2),
  ('barber3', 'Jalal', '3333', true, 35, 'barber',    3),
  ('jassy',   'Jassy', '4444', true, 35, 'therapist', 4)
on conflict (id) do nothing;

-- ── Row Level Security ───────────────────────────────────
alter table barbers       enable row level security;
alter table queue_entries enable row level security;
alter table app_config    enable row level security;   -- no policies = secret stays hidden

drop policy if exists b_sel on barbers;
drop policy if exists b_upd on barbers;
drop policy if exists q_sel on queue_entries;
drop policy if exists q_upd on queue_entries;
create policy b_sel on barbers       for select using (true);
create policy b_upd on barbers       for update using (true);
create policy q_sel on queue_entries for select using (true);
create policy q_upd on queue_entries for update using (true);
-- NOTE: no INSERT policy on queue_entries → joins must go through join_queue()

-- ── Rotating QR token ────────────────────────────────────
create or replace function get_qr_token()
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_win bigint; v_tok text; v_secs int;
begin
  select value into v_secret from app_config where key = 'qr_secret';
  v_win  := floor(extract(epoch from now()) / 1800)::bigint;
  v_tok  := substring(encode(digest(v_win::text || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
  v_secs := ((v_win + 1) * 1800 - extract(epoch from now()))::int;
  return json_build_object('token', v_tok, 'secondsLeft', v_secs);
end; $$;

-- ── Join queue (token check + phone dedupe + position) ───
create or replace function join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text; v_require text; v_win bigint;
  v_tok_now text; v_tok_prev text; v_phone text; v_count int; v_id uuid;
begin
  select value into v_secret  from app_config where key = 'qr_secret';
  select value into v_require from app_config where key = 'require_token';

  if coalesce(v_require, 'true') = 'true' then
    v_win := floor(extract(epoch from now()) / 1800)::bigint;
    v_tok_now  := substring(encode(digest(v_win::text       || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
    v_tok_prev := substring(encode(digest((v_win-1)::text   || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
    if p_token is null or (p_token <> v_tok_now and p_token <> v_tok_prev) then
      return json_build_object('error', 'expired_qr');
    end if;
  end if;

  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  select count(*) into v_count from queue_entries
    where barber_id = p_barber_id and status in ('waiting','called')
      and regexp_replace(phone, '\D', '', 'g') = v_phone;
  if v_count > 0 then
    return json_build_object('error', 'You''re already in this queue.');
  end if;

  select count(*) into v_count from queue_entries
    where barber_id = p_barber_id and status in ('waiting','called');

  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
    values (p_barber_id, p_barber_name, p_customer_name, p_phone, 'waiting', v_count + 1, 0)
    returning id into v_id;

  return json_build_object('id', v_id, 'position', v_count + 1, 'ahead', v_count);
end; $$;

-- ── End-of-day stats (Malaysia time) ─────────────────────
create or replace function get_daily_stats()
returns json language plpgsql security definer set search_path = public as $$
declare v_total int; v_served int; v_per json; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  select count(*) into v_total  from queue_entries where (created_at at time zone 'Asia/Kuala_Lumpur')::date = v_today;
  select count(*) into v_served from queue_entries where status = 'done' and (created_at at time zone 'Asia/Kuala_Lumpur')::date = v_today;
  select coalesce(json_agg(row_to_json(t)), '[]'::json) into v_per from (
    select barber_id as id, max(barber_name) as name,
           count(*) filter (where status = 'done') as served,
           count(*) as joined
    from queue_entries
    where (created_at at time zone 'Asia/Kuala_Lumpur')::date = v_today
    group by barber_id
  ) t;
  return json_build_object('date', to_char(v_today, 'YYYY-MM-DD'),
                           'totalJoined', v_total, 'totalServed', v_served, 'perWorker', v_per);
end; $$;

grant execute on function get_qr_token()                                   to anon, authenticated;
grant execute on function join_queue(text,text,text,text,text)             to anon, authenticated;
grant execute on function get_daily_stats()                                to anon, authenticated;
