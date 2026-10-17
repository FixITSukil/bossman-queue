-- Allow a customer who lost their queue tab to recover the active queue view.
-- Recovery requires the exact customer name and full phone number used to join.
-- The private cancellation token is intentionally not returned; a recovered
-- session is view-only unless the customer still has the original browser state.

create or replace function public.recover_queue(
  p_customer_name text,
  p_phone text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
  v_entries json;
begin
  v_name := lower(regexp_replace(btrim(coalesce(p_customer_name, '')), '[[:space:]]+', ' ', 'g'));
  v_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');

  if left(v_phone, 1) = '0' then
    v_phone := '60' || substring(v_phone from 2);
  end if;

  if length(v_name) < 2 or length(v_phone) not between 9 and 15 then
    return json_build_object(
      'error',
      'Enter the same name and valid phone number used to join.'
    );
  end if;

  select coalesce(
    json_agg(
      json_build_object(
        'id', q.id,
        'barberId', q.barber_id,
        'barberName', q.barber_name,
        'status', q.status,
        'position', q.position,
        'durationMinutes', q.duration_minutes,
        'calledAt', q.called_at,
        'role', b.role,
        'avgMinutes', b.avg_minutes
      )
      order by case when b.role = 'therapist' then 1 else 0 end,
               q.created_at,
               q.id
    ),
    '[]'::json
  )
  into v_entries
  from public.queue_entries q
  join public.barbers b on b.id = q.barber_id
  where q.status in ('waiting', 'called')
    and lower(regexp_replace(btrim(coalesce(q.customer_name, '')), '[[:space:]]+', ' ', 'g')) = v_name
    and (
      case
        when left(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g'), 1) = '0'
          then '60' || substring(regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g') from 2)
        else regexp_replace(coalesce(q.phone, ''), '[^0-9]', '', 'g')
      end
    ) = v_phone;

  if json_array_length(v_entries) = 0 then
    return json_build_object(
      'error',
      'No active queue was found with those details. Check the name and phone number used when joining.'
    );
  end if;

  return json_build_object('ok', true, 'entries', v_entries);
end;
$$;

revoke all on function public.recover_queue(text, text)
  from public, anon, authenticated;
grant execute on function public.recover_queue(text, text)
  to anon, authenticated;
