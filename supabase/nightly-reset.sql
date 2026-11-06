-- ============================================================
-- BOSSMAN QUEUE — Legacy nightly reset DISABLED (2026-11-06)
--
-- The former 23:00 Malaysia-time job deleted all queue entries,
-- including unresolved customers and individual booking history.
-- Do not reinstate that deletion or schedule this function again.
-- Owner closeout must retain customer records and use explicit
-- completion/cancellation instead of deleting queue history.
--
-- Applied live as migration disable_destructive_bossman_nightly_reset.
-- This script changes no queue rows, daily totals, barber availability,
-- private customer keys, owner audit records, or opening hours.
-- ============================================================

do $disable_job$
declare v_job record;
begin
  if to_regclass('cron.job') is not null then
    for v_job in select jobid from cron.job where jobname = 'bossman-nightly-reset' loop
      perform cron.alter_job(job_id := v_job.jobid, active := false);
    end loop;
  end if;
end;
$disable_job$;

create or replace function public.bossman_nightly_reset()
returns void
language plpgsql
security invoker
set search_path = ''
as $disabled_reset$
begin
  -- Deliberate no-op. Never delete bookings or overwrite saved totals.
  return;
end;
$disabled_reset$;

revoke all on function public.bossman_nightly_reset()
  from public, anon, authenticated, service_role;
comment on function public.bossman_nightly_reset() is
  'Disabled 2026-11-06 after destructive nightly deletion incident. No-op; never deletes queue entries. Closeout must preserve customer history and unresolved bookings.';
