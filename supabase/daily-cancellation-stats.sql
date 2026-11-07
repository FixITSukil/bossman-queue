-- Applied as Supabase migration: daily_queue_cancellation_counts.
-- Reporting only: no customer records, queue states, cron jobs or tables are changed.
-- Keep the existing public aggregate contract; never return customer names or phones.
create or replace function public.get_daily_stats()
returns json
language sql
stable
security definer
set search_path = ''
as $stats$
  with bounds as (
    select (current_timestamp at time zone 'Asia/Kuala_Lumpur')::date as day
  ), today as materialized (
    select q.barber_id, q.barber_name, q.status
    from public.queue_entries q cross join bounds b
    where q.created_at >= (b.day::timestamp at time zone 'Asia/Kuala_Lumpur')
      and q.created_at < ((b.day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  ), per_worker as (
    select barber_id as id, max(barber_name) as name,
      count(*) filter (where status = 'done') as served,
      count(*) as joined,
      count(*) filter (where status in ('cancelled_by_customer','cancelled_by_barber')) as cancelled,
      count(*) filter (where status = 'cancelled_by_customer') as "cancelledByCustomer",
      count(*) filter (where status = 'cancelled_by_barber') as "cancelledByStaff",
      count(*) filter (where status = 'no_show') as "noShow"
    from today group by barber_id
  )
  select pg_catalog.json_build_object(
    'date', (select pg_catalog.to_char(day,'YYYY-MM-DD') from bounds),
    'timezone', 'Asia/Kuala_Lumpur',
    'countBasis', 'registration_date',
    'generatedAt', current_timestamp,
    'totalJoined', count(*),
    'totalServed', count(*) filter (where status = 'done'),
    'totalCancelled', count(*) filter (where status in ('cancelled_by_customer','cancelled_by_barber')),
    'cancelledByCustomer', count(*) filter (where status = 'cancelled_by_customer'),
    'cancelledByStaff', count(*) filter (where status = 'cancelled_by_barber'),
    'totalNoShow', count(*) filter (where status = 'no_show'),
    'perWorker', (select coalesce(pg_catalog.json_agg(pg_catalog.row_to_json(w) order by w.name,w.id),'[]'::json) from per_worker w)
  ) from today;
$stats$;
revoke all on function public.get_daily_stats() from public;
grant execute on function public.get_daily_stats() to anon, authenticated, service_role;
comment on function public.get_daily_stats() is 'Read-only public aggregates for queue entries registered today in Asia/Kuala_Lumpur. Cancelled means customer plus barber/owner cancellation, excluding no-shows. Counts registrations, not unique people. Returns no customer PII; does not modify queue history.';
