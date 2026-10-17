create table if not exists public.queue_push_subscriptions (
  entry_id uuid primary key references public.queue_entries(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.queue_push_subscriptions enable row level security;
revoke all on public.queue_push_subscriptions from public, anon, authenticated;

create or replace function public.save_queue_push_subscription(
  p_entry_id uuid,
  p_cancel_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_entry_id is null or p_cancel_token is null then
    return json_build_object('error', 'The original secure queue session is required to enable alerts.');
  end if;
  if length(coalesce(p_endpoint, '')) < 20
     or length(coalesce(p_p256dh, '')) < 20
     or length(coalesce(p_auth, '')) < 8 then
    return json_build_object('error', 'Invalid notification subscription.');
  end if;

  select status into v_status
  from public.queue_entries
  where id = p_entry_id and cancel_token = p_cancel_token;

  if v_status is null or v_status not in ('waiting', 'called') then
    return json_build_object('error', 'This queue place is no longer active.');
  end if;

  delete from public.queue_push_subscriptions
  where endpoint = p_endpoint and entry_id <> p_entry_id;

  insert into public.queue_push_subscriptions(entry_id, endpoint, p256dh, auth, notified_at)
  values (p_entry_id, p_endpoint, p_p256dh, p_auth, null)
  on conflict (entry_id) do update set
    endpoint = excluded.endpoint,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    notified_at = null,
    updated_at = now();

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.save_queue_push_subscription(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_queue_push_subscription(uuid, uuid, text, text, text)
  to anon, authenticated;

create or replace function public.remove_queue_push_subscription(
  p_entry_id uuid,
  p_cancel_token uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.queue_entries
    where id = p_entry_id and cancel_token = p_cancel_token
  ) then
    return json_build_object('error', 'Invalid queue session.');
  end if;

  delete from public.queue_push_subscriptions where entry_id = p_entry_id;
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.remove_queue_push_subscription(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_queue_push_subscription(uuid, uuid)
  to anon, authenticated;

create or replace function public.bossman_cleanup_push_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.queue_push_subscriptions where entry_id = new.id;
  return new;
end;
$$;

revoke all on function public.bossman_cleanup_push_subscription() from public, anon, authenticated;

drop trigger if exists bossman_queue_push_cleanup on public.queue_entries;
create trigger bossman_queue_push_cleanup
after update of status on public.queue_entries
for each row
when (
  old.status is distinct from new.status
  and new.status in ('done', 'no_show', 'cancelled_by_customer', 'cancelled_by_barber')
)
execute function public.bossman_cleanup_push_subscription();