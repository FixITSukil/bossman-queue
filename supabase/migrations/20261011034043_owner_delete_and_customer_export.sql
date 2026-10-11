-- Owner deletion archives staff so historical customer records remain intact.
alter table public.barbers add column deleted_at timestamptz;
grant select (deleted_at) on public.barbers to anon, authenticated;

-- Serialize new queue entries with deletion, including a join already in flight.
create function public.prevent_archived_barber_queue_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_deleted_at timestamptz;
begin
  select deleted_at into v_deleted_at from barbers where id=new.barber_id for share;
  if v_deleted_at is not null then
    raise exception 'This barber is unavailable.';
  end if;
  return new;
end; $$;
revoke all on function public.prevent_archived_barber_queue_insert() from public, anon, authenticated;
create trigger prevent_archived_barber_queue_insert
  before insert on public.queue_entries
  for each row execute function public.prevent_archived_barber_queue_insert();

create or replace view public.barbers_public with (security_invoker = true) as
  select id, name, is_active, avg_minutes, role, sort,
    (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days)) as off_today,
    (is_active and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(off_days))) as is_available
  from public.barbers where is_listed and deleted_at is null;

create or replace function public.get_owner_view(p_owner_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v_ok text; v_rows json;
begin
  select value into v_ok from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_ok then return json_build_object('error','bad_pin'); end if;
  select coalesce(json_agg(w), '[]'::json) into v_rows from (
    select b.id, b.name, b.pin, b.is_active as "isActive", b.is_listed as "isListed",
      b.avg_minutes as "avgMinutes", b.role, b.sort, b.off_days as "offDays",
      (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days)) as "offToday",
      (b.is_active and b.is_listed and not (extract(dow from (now() at time zone 'Asia/Kuala_Lumpur'))::integer = any(b.off_days))) as "isAvailable",
      (select coalesce(json_agg(row_to_json(q)), '[]'::json) from (
        select id, customer_name as "customerName", phone, status, position,
          duration_minutes as "durationMinutes", called_at as "calledAt"
        from queue_entries where barber_id = b.id and status in ('waiting','called')
        order by position
      ) q) as queue
    from barbers b where b.deleted_at is null order by b.sort, b.name
  ) w;
  return json_build_object('ok',true,'workers',v_rows);
end; $$;

create or replace function public.save_barber(
  p_owner_pin text, p_id text, p_name text, p_role text, p_avg_minutes integer,
  p_sort integer, p_is_active boolean, p_is_listed boolean, p_off_days integer[]
) returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_id text; v_pin text; v_days integer[];
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 80 then
    return json_build_object('error','Enter a worker name between 2 and 80 characters.');
  end if;
  if p_role not in ('barber','therapist') or p_role is null then
    return json_build_object('error','Choose barber or facial therapist.');
  end if;
  if p_avg_minutes is null or p_avg_minutes not between 5 and 240 then
    return json_build_object('error','Average time must be 5 to 240 minutes.');
  end if;
  if p_sort is null or p_sort not between 0 and 9999 then
    return json_build_object('error','Display order must be 0 to 9999.');
  end if;
  select coalesce(array_agg(distinct d order by d), '{}'::integer[])
    into v_days from unnest(coalesce(p_off_days,'{}'::integer[])) as d;
  if not (v_days <@ array[0,1,2,3,4,5,6]::integer[]) then
    return json_build_object('error','Choose valid days of the week.');
  end if;
  if p_id is null or btrim(p_id) = '' then
    v_id := gen_random_uuid()::text;
    v_pin := replace(gen_random_uuid()::text,'-','');
    insert into barbers(id,name,pin,is_active,is_listed,avg_minutes,role,sort,off_days)
      values(v_id,btrim(p_name),v_pin,coalesce(p_is_active,true),coalesce(p_is_listed,true),
        p_avg_minutes,p_role,p_sort,v_days);
  else
    update barbers set name=btrim(p_name), role=p_role, avg_minutes=p_avg_minutes,
      sort=p_sort, is_active=coalesce(p_is_active,false),
      is_listed=coalesce(p_is_listed,false), off_days=v_days
      where id=p_id and deleted_at is null returning id,pin into v_id,v_pin;
    if v_id is null then return json_build_object('error','Worker not found. Refresh the page.'); end if;
  end if;
  return json_build_object('ok',true,'id',v_id,'pin',v_pin);
end; $$;

create or replace function public.rotate_barber_pin(p_owner_pin text, p_barber_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_new_pin text;
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  update barbers set pin=replace(gen_random_uuid()::text,'-','')
    where id=p_barber_id and deleted_at is null returning pin into v_new_pin;
  if v_new_pin is null then return json_build_object('error','Worker not found.'); end if;
  return json_build_object('ok',true,'pin',v_new_pin);
end; $$;

create function public.delete_barber(p_owner_pin text, p_barber_id text)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_name text;
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  select name into v_name from barbers where id=p_barber_id and deleted_at is null for update;
  if v_name is null then return json_build_object('error','Worker not found. Refresh the page.'); end if;
  if exists (select 1 from queue_entries where barber_id=p_barber_id and status in ('waiting','called')) then
    return json_build_object('error','Finish or cancel this worker''s current queue before deleting.');
  end if;
  if exists (select 1 from bookings where barber_id=p_barber_id and status='booked' and starts_at >= now()) then
    return json_build_object('error','Resolve this worker''s future appointments before deleting.');
  end if;
  update barbers set is_active=false, is_listed=false, deleted_at=now(),
    pin=replace(gen_random_uuid()::text,'-','') where id=p_barber_id;
  return json_build_object('ok',true,'name',v_name);
end; $$;
revoke all on function public.delete_barber(text,text) from public, anon, authenticated;
grant execute on function public.delete_barber(text,text) to anon, authenticated;

-- Return customer activity in bounded pages. Only the owner PIN may read names/phones.
create function public.get_owner_customer_records(p_owner_pin text, p_offset integer, p_limit integer)
returns json language plpgsql security definer set search_path = public as $$
declare v_owner_pin text; v_rows json; v_limit integer; v_offset integer;
begin
  select value into v_owner_pin from app_config where key = 'owner_pin';
  if p_owner_pin is null or p_owner_pin <> v_owner_pin then return json_build_object('error','bad_pin'); end if;
  v_limit := greatest(1, least(500, coalesce(p_limit,500)));
  v_offset := greatest(0, coalesce(p_offset,0));
  select coalesce(json_agg(row_to_json(r)), '[]'::json) into v_rows from (
    select * from (
      select 'queue'::text as source, q.id::text as "recordId", q.customer_name as "customerName",
        q.phone, coalesce(q.barber_name,b.name,'') as "barberName", q.created_at as "eventAt",
        q.status, null::text as "serviceName"
      from queue_entries q left join barbers b on b.id=q.barber_id
      union all
      select 'appointment'::text, a.id::text, a.customer_name, a.phone,
        coalesce(b.name,''), a.starts_at, a.status, a.service_name
      from bookings a left join barbers b on b.id=a.barber_id
    ) all_records
    order by "eventAt" desc, "recordId" desc
    limit v_limit offset v_offset
  ) r;
  return json_build_object('ok',true,'records',v_rows);
end; $$;
revoke all on function public.get_owner_customer_records(text,integer,integer) from public, anon, authenticated;
grant execute on function public.get_owner_customer_records(text,integer,integer) to anon, authenticated;
