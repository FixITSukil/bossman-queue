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
  role        text not null default 'barber',
  sort        int  not null default 0
);

create table if not exists queue_entries (
  id               uuid primary key default gen_random_uuid(),
  barber_id        text references barbers(id),
  barber_name      text,
  customer_name    text,
  phone            text,
  status           text not null default 'waiting',
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
  ('qr_secret', encode(gen_random_bytes(32), 'hex')),
  ('require_token', 'false')
on conflict (key) do nothing;

-- ── Seed workers ─────────────────────────────────────────
-- Production dashboard secrets are generated randomly and must never be committed to GitHub.
insert into barbers (id, name, pin, is_active, avg_minutes, role, sort) values
  ('barber1', 'Assaf', encode(gen_random_bytes(16), 'hex'), true, 35, 'barber',    1),
  ('barber2', 'Karam', encode(gen_random_bytes(16), 'hex'), true, 35, 'barber',    2),
  ('barber3', 'Jalal', encode(gen_random_bytes(16), 'hex'), true, 35, 'barber',    3),
  ('barber4', 'Ali',   encode(gen_random_bytes(16), 'hex'), true, 35, 'barber',    4),
  ('jassy',   'Jassy', encode(gen_random_bytes(16), 'hex'), false, 35, 'therapist', 99)
on conflict (id) do nothing;

-- ── Row Level Security ───────────────────────────────────
alter table barbers       enable row level security;
alter table queue_entries enable row level security;
alter table app_config    enable row level security;

drop policy if exists b_sel on barbers;
drop policy if exists b_upd on barbers;
drop policy if exists q_sel on queue_entries;
drop policy if exists q_upd on queue_entries;
create policy b_sel on barbers       for select using (true);
create policy b_upd on barbers       for update using (true);
create policy q_sel on queue_entries for select using (true);
create policy q_upd on queue_entries for update using (true);
-- NOTE: no INSERT policy on queue_entries → joins must go through join_queue().
-- Run hardening.sql immediately after this file for production.

-- ── Legacy token helper (not used by the static shop QR) ───
create or replace function get_qr_token()
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text; v_win bigint; v_tok text; v_secs int;
begin
  select value into v_secret from app_config where key = 'qr_secret';
  v_win  := floor(extract(epoch from now()) / 120)::bigint;
  v_tok  := substring(encode(digest(v_win::text || '|' || v_secret, 'sha256'), 'hex') from 1 for 8);
  v_secs := ((v_win + 1) * 120 - extract(epoch from now()))::int;
  return json_build_object('token', v_tok, 'secondsLeft', v_secs);
end; $$;

-- The counter QR is now a permanent link. Keep the existing five-argument RPC
-- signature so older customer pages can still call it, but ignore p_token.
-- Opening hours, barber availability, phone checks, and queue ordering remain.
create or replace function public.join_queue(
  p_barber_id text, p_barber_name text, p_customer_name text, p_phone text, p_token text
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_phone text; v_count integer; v_position integer; v_id uuid; v_barber_name text;
  v_local_time time;
begin
  v_local_time := (now() at time zone 'Asia/Kuala_Lumpur')::time;
  if v_local_time < time '11:00' or v_local_time >= time '22:46' then
    return json_build_object('error','The queue is not open right now. Please join from 11:00 AM to 10:45 PM Malaysia time.');
  end if;

  select name into v_barber_name from barbers where id = p_barber_id and is_active;
  if v_barber_name is null then return json_build_object('error','Barber unavailable.'); end if;
  v_phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if length(btrim(coalesce(p_customer_name,''))) < 2 or length(v_phone) not between 9 and 15 then
    return json_build_object('error','Enter a name and valid phone number.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_barber_id || '|queue', 0));
  if exists (select 1 from queue_entries where barber_id = p_barber_id and status in ('waiting','called')
    and regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = v_phone) then
    return json_build_object('error','You''re already in this queue.');
  end if;
  select count(*), coalesce(max(position),0)+1 into v_count, v_position
  from queue_entries where barber_id = p_barber_id and status in ('waiting','called');
  insert into queue_entries (barber_id, barber_name, customer_name, phone, status, position, duration_minutes)
  values (p_barber_id, v_barber_name, btrim(p_customer_name), v_phone, 'waiting', v_position, 0)
  returning id into v_id;
  return json_build_object('id',v_id,'position',v_position,'ahead',v_count);
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
