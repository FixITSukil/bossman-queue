-- Phone-only recovery of ACTIVE queue views. A spelling difference in the
-- customer name must not stop someone reopening their queue.
-- Recovery remains read-only: no cancellation token, phone, PIN or other secret
-- is returned. Anonymous customers use this intentional phone-based read API;
-- existing write/cancellation authorization is unchanged.

create function public.recover_queue_by_phone(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_matches jsonb;
begin
  v_phone := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  if left(v_phone,1)='0' then v_phone := '60'||substring(v_phone from 2); end if;
  if length(v_phone) not between 9 and 15 then
    return jsonb_build_object('error','Enter the full phone number used to join.','code','invalid_phone');
  end if;

  with hits as (
    select q.id,q.barber_id,q.barber_name,q.customer_name,q.status,q.position,
      q.duration_minutes,q.called_at,q.created_at,b.role,b.avg_minutes,
      lower(regexp_replace(btrim(coalesce(q.customer_name,'')),'[[:space:]]+',' ','g')) as normalized_name
    from public.queue_entries q
    join public.barbers b on b.id=q.barber_id
    where q.status in ('waiting','called')
      and (case
        when left(regexp_replace(coalesce(q.phone,''),'[^0-9]','','g'),1)='0'
          then '60'||substring(regexp_replace(coalesce(q.phone,''),'[^0-9]','','g') from 2)
        else regexp_replace(coalesce(q.phone,''),'[^0-9]','','g')
      end)=v_phone
  ), facial_pairs as (
    -- The QR flow generates the exact suffix " (facial)" for a parallel add-on.
    -- Pair only a UNIQUE haircut and UNIQUE corresponding therapist entry.
    -- Separate haircuts always remain separate choices, even for identical names.
    select haircut.id as primary_id,facial.id as facial_id
    from hits haircut join hits facial
      on haircut.role<>'therapist' and facial.role='therapist'
      and facial.normalized_name=haircut.normalized_name||' (facial)'
    where haircut.normalized_name<>''
      and not exists(select 1 from hits other where other.role<>'therapist'
        and other.normalized_name=haircut.normalized_name and other.id<>haircut.id)
      and not exists(select 1 from hits other where other.role='therapist'
        and other.normalized_name=facial.normalized_name and other.id<>facial.id)
  ), primaries as (
    select h.* from hits h
    where not exists(select 1 from facial_pairs p where p.facial_id=h.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchId',p.id,'customerName',p.customer_name,
    'entries',(
      select jsonb_agg(jsonb_build_object(
        'id',h.id,'customerName',h.customer_name,
        'barberId',h.barber_id,'barberName',h.barber_name,
        'status',h.status,'position',h.position,
        'durationMinutes',h.duration_minutes,'calledAt',h.called_at,
        'role',h.role,'avgMinutes',h.avg_minutes
      ) order by case when h.role='therapist' then 1 else 0 end,h.created_at,h.id)
      from hits h where h.id=p.id or exists(
        select 1 from facial_pairs pair where pair.primary_id=p.id and pair.facial_id=h.id
      )
    )
  ) order by case when p.role='therapist' then 1 else 0 end,p.created_at,p.id),'[]'::jsonb)
  into v_matches from primaries p;

  if jsonb_array_length(v_matches)=0 then
    return jsonb_build_object('error','No active queue was found for that phone number. Check the number used when joining or ask staff for help.','code','not_found');
  end if;
  return jsonb_build_object('ok',true,'matches',v_matches,
    'requiresSelection',jsonb_array_length(v_matches)>1);
end;
$$;

revoke all on function public.recover_queue_by_phone(text) from public,anon,authenticated,service_role;
grant execute on function public.recover_queue_by_phone(text) to anon,authenticated;
comment on function public.recover_queue_by_phone(text) is
  'Phone-only read-only active queue recovery. No cancellation tokens or staff secrets. Ambiguous customers require explicit selection; only a unique generated facial add-on is grouped.';

-- Keep the exact named-argument signature expected by already-cached clients.
-- Their supplied name is deliberately ignored. They can still reopen a single
-- person/group immediately, but their old UI cannot safely choose among people.
create or replace function public.recover_queue(p_customer_name text,p_phone text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.recover_queue_by_phone(p_phone);
  if v_result->>'ok' is distinct from 'true' then return v_result::json; end if;
  if jsonb_array_length(v_result->'matches')<>1 then
    return json_build_object('error','Several active queue places use this phone number. Refresh this page and choose your queue, or ask staff for help.','code','multiple_active_queues');
  end if;
  return json_build_object('ok',true,'entries',v_result->'matches'->0->'entries');
end;
$$;
revoke all on function public.recover_queue(text,text) from public,anon,authenticated,service_role;
grant execute on function public.recover_queue(text,text) to anon,authenticated;
comment on function public.recover_queue(text,text) is
  'Cached-client compatibility wrapper: name is ignored; phone-only read-only recovery returns one unambiguous customer group. Multiple groups require the refreshed selection UI.';
