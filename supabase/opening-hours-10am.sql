-- Deployment record: bossman_open_queue_at_10am (20261105105324).
-- Open Bossman from 10:00 AM MYT; retain the existing 10:45 PM last join.
-- This is the one-time SQL applied to the live database, not an extra migration.
-- Change only opening-hour literals in the existing functions. Preserve
-- authorization, availability checks, queue locking, recovery and history.
do $hours$
declare
  r record;
  old_def text;
  new_def text;
  changed_count integer := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('join_queue', 'join_queue_remote', 'booking_slots', 'book_appointment', 'bossman_clock')
  loop
    old_def := pg_get_functiondef(r.oid);
    new_def := replace(old_def, '11:00', '10:00');
    new_def := replace(new_def, 'generate_series(660, 1365, 15)', 'generate_series(600, 1365, 15)');
    new_def := replace(new_def, '''openMinute'', 660', '''openMinute'', 600');
    if new_def = old_def then
      raise exception 'Opening-hour pattern not found in %, aborting unchanged.', r.proname;
    end if;
    execute new_def;
    changed_count := changed_count + 1;
  end loop;
  if changed_count <> 5 then
    raise exception 'Expected exactly five opening-hour functions, found %.', changed_count;
  end if;
  if (public.bossman_clock('opening-hours-check')->>'openMinute')::integer <> 600
    or (public.bossman_clock('opening-hours-check')->>'closeMinuteExclusive')::integer <> 1366 then
    raise exception 'Clock hours verification failed.';
  end if;
end;
$hours$;
