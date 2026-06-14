-- ============================================================
-- BOSSMAN QUEUE — Nightly auto-reset (11 PM Malaysia time)
-- Logs the day's totals to history, then clears the queue to 0.
--
-- SETUP (one time):
-- 1. Supabase → Database → Extensions → search "pg_cron" → enable it.
-- 2. Then paste + run this whole file in the SQL Editor.
-- ============================================================

-- History of daily totals (kept forever, survives the nightly wipe)
create table if not exists daily_totals (
  day          date primary key,
  total_joined int,
  total_served int,
  per_worker   json,
  recorded_at  timestamptz default now()
);
alter table daily_totals enable row level security;
drop policy if exists dt_sel on daily_totals;
create policy dt_sel on daily_totals for select using (true);

-- The nightly job: snapshot today's stats, then reset the live queue
create or replace function bossman_nightly_reset()
returns void language plpgsql security definer set search_path = public as $$
declare s json;
begin
  s := get_daily_stats();
  insert into daily_totals (day, total_joined, total_served, per_worker)
  values ((s->>'date')::date, (s->>'totalJoined')::int, (s->>'totalServed')::int, s->'perWorker')
  on conflict (day) do update
    set total_joined = excluded.total_joined,
        total_served = excluded.total_served,
        per_worker   = excluded.per_worker,
        recorded_at  = now();

  delete from queue_entries;  -- reset the live queue to 0
end; $$;

-- Schedule it for 23:00 Malaysia time (= 15:00 UTC) every day.
-- Re-running is safe: unschedule the old one first if it exists.
select cron.unschedule('bossman-nightly-reset')
  where exists (select 1 from cron.job where jobname = 'bossman-nightly-reset');

select cron.schedule('bossman-nightly-reset', '0 15 * * *', 'select bossman_nightly_reset();');
