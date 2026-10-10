-- Keep barber cancellations distinct from no-shows and customer self-removal.
-- The public queue view already exposes status, so the customer page can react
-- without exposing names, phone numbers, or barber credentials.
create or replace function public.cancel_queue_entry(p_pin text, p_entry_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_barber_id text; v_entry_id uuid;
begin
  select id into v_barber_id from barbers where pin = p_pin limit 1;
  if v_barber_id is null then return json_build_object('error','bad_pin'); end if;

  update queue_entries set status = 'cancelled_by_barber'
    where id = p_entry_id and barber_id = v_barber_id
      and status in ('waiting','called')
    returning id into v_entry_id;
  if v_entry_id is null then return json_build_object('error','This customer is no longer in your queue.'); end if;
  return json_build_object('ok',true);
end; $$;

revoke all on function public.cancel_queue_entry(text,uuid) from public;
grant execute on function public.cancel_queue_entry(text,uuid) to anon, authenticated;
