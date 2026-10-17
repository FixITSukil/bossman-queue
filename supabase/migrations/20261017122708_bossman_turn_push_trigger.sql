create extension if not exists pg_net with schema extensions;

create or replace function public.bossman_notify_customer_called()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  perform net.http_post(
    url := 'https://ksgkzeiaxwzgufilqbso.supabase.co/functions/v1/bossman-turn-alert',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('entryId', new.id)
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.bossman_notify_customer_called() from public, anon, authenticated;

drop trigger if exists bossman_queue_called_push on public.queue_entries;
create trigger bossman_queue_called_push
after update of status on public.queue_entries
for each row
when (old.status is distinct from new.status and new.status = 'called')
execute function public.bossman_notify_customer_called();