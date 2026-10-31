-- Deployed with Supabase migration database_clock_for_queue_countdown.
-- Read-only public clock: no customer data or secrets are read or changed.
create or replace function public.bossman_clock(p_nonce text default '')
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform pg_catalog.set_config('response.headers', '[{"Cache-Control":"no-store, max-age=0"}]', true);
  return pg_catalog.jsonb_build_object(
    'serverEpochMs', floor(extract(epoch from v_now) * 1000)::bigint,
    'timezone', 'Asia/Kuala_Lumpur',
    'utcOffsetMinutes', 480,
    'openMinute', 660,
    'closeMinuteExclusive', 1366,
    'nonce', left(coalesce(p_nonce, ''), 100)
  );
end;
$$;
revoke all on function public.bossman_clock(text) from public;
grant execute on function public.bossman_clock(text) to anon, authenticated;
comment on function public.bossman_clock(text) is 'Public read-only clock for aligned Malaysia time and queue countdowns; does not read or change bookings.';
