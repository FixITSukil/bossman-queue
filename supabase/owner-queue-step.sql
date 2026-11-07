-- Applied as migration owner_adjacent_queue_step.
-- Adds an owner-only adjacent swap; does not reset, delete, or recreate bookings.
-- Existing retention, backups, availability and opening hours are unchanged.
create schema if not exists bossman_admin;
revoke all on schema bossman_admin from public;
grant usage on schema bossman_admin to anon, authenticated;
create or replace function bossman_admin.queue_step(
 p_owner_pin text, p_barber_id text, p_entry_id uuid, p_neighbor_id uuid,
 p_direction text, p_expected_position integer, p_expected_neighbor_position integer
) returns jsonb language plpgsql security definer set search_path = '' as $step$
declare
 v_secret text; v_q public.queue_entries%rowtype; v_n public.queue_entries%rowtype;
 v_neighbor uuid; v_before jsonb; v_neighbor_before jsonb;
 v_operation uuid := pg_catalog.gen_random_uuid(); v_updated integer;
begin
 select value into v_secret from public.app_config where key='owner_pin';
 if nullif(p_owner_pin,'') is null or nullif(v_secret,'') is null or p_owner_pin is distinct from v_secret then
  return jsonb_build_object('error','Invalid owner link.','code','forbidden');
 end if;
 if p_direction is null or p_direction not in ('up','down') or nullif(p_barber_id,'') is null
   or p_entry_id is null or p_neighbor_id is null or p_entry_id=p_neighbor_id
   or p_expected_position is null or p_expected_neighbor_position is null then
  return jsonb_build_object('error','Invalid move request. Refresh and try again.','code','invalid_request');
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_barber_id || '|queue',0)) then
  return jsonb_build_object('error','This queue is changing. Refresh and try again.','code','queue_busy');
 end if;
 perform id from public.barbers where id=p_barber_id and deleted_at is null for share nowait;
 if not found then return jsonb_build_object('error','Barber not found.','code','queue_changed'); end if;
 perform q.id from public.queue_entries q where q.barber_id=p_barber_id and q.status in ('waiting','called') order by q.id for update nowait;
 select * into v_q from public.queue_entries where id=p_entry_id and barber_id=p_barber_id and status='waiting';
 if not found then return jsonb_build_object('error','This customer is no longer waiting here. Refresh the queue.','code','queue_changed'); end if;
 select * into v_n from public.queue_entries where id=p_neighbor_id and barber_id=p_barber_id and status='waiting';
 if not found then return jsonb_build_object('error','The neighbouring customer changed. Refresh the queue.','code','queue_changed'); end if;
 if v_q.position is distinct from p_expected_position or v_n.position is distinct from p_expected_neighbor_position
   or v_q.position is null or v_n.position is null or v_q.position=v_n.position then
  return jsonb_build_object('error','Queue positions changed. Review the refreshed queue before moving again.','code','queue_changed');
 end if;
 with ordered as (
  select id,lag(id) over(order by position,created_at,id) as previous_id,lead(id) over(order by position,created_at,id) as next_id
  from public.queue_entries where barber_id=p_barber_id and status='waiting'
 ) select case when p_direction='up' then previous_id else next_id end into v_neighbor from ordered where id=p_entry_id;
 if v_neighbor is distinct from p_neighbor_id then
  return jsonb_build_object('error','The neighbouring place changed. Refresh and try again.','code','queue_changed');
 end if;
 if exists(select 1 from public.queue_entries where barber_id=p_barber_id and status='waiting' group by position having count(*)>1) then
  return jsonb_build_object('error','Queue positions need review. Use Manage to correct the order first.','code','queue_changed');
 end if;
 v_before := jsonb_build_object('barberId',v_q.barber_id,'barberName',v_q.barber_name,'status',v_q.status,'position',v_q.position,'durationMinutes',coalesce(v_q.duration_minutes,0),'calledAt',v_q.called_at);
 v_neighbor_before := jsonb_build_object('barberId',v_n.barber_id,'barberName',v_n.barber_name,'status',v_n.status,'position',v_n.position,'durationMinutes',coalesce(v_n.duration_minutes,0),'calledAt',v_n.called_at);
 update public.queue_entries set position=case when id=v_q.id then v_n.position else v_q.position end
  where id in (v_q.id,v_n.id) and barber_id=p_barber_id and status='waiting';
 get diagnostics v_updated = row_count;
 if v_updated<>2 then raise exception 'Queue swap could not be completed safely'; end if;
 insert into public.owner_queue_audit(operation_id,action,entry_id,customer_name,previous_state,next_state,reason)
 values
  (v_operation,'move',v_q.id,v_q.customer_name,v_before,v_before || jsonb_build_object('position',v_n.position),
   'Owner moved customer ' || p_direction || ' one place using queue arrow'),
  (v_operation,'move',v_n.id,v_n.customer_name,v_neighbor_before,v_neighbor_before || jsonb_build_object('position',v_q.position),
   'Adjacent queue swap: moved ' || case when p_direction='up' then 'down' else 'up' end || ' one place');
 return jsonb_build_object('ok',true,'affected',2,'entryId',v_q.id,'neighborId',v_n.id,'direction',p_direction,'position',v_n.position,'operationId',v_operation);
exception when lock_not_available or deadlock_detected then
 return jsonb_build_object('error','Another queue action is in progress. Nothing was moved. Refresh and try again.','code','queue_busy');
end;
$step$;
revoke all on function bossman_admin.queue_step(text,text,uuid,uuid,text,integer,integer) from public;
grant execute on function bossman_admin.queue_step(text,text,uuid,uuid,text,integer,integer) to anon, authenticated;
create or replace function public.owner_queue_step(
 p_owner_pin text, p_barber_id text, p_entry_id uuid, p_neighbor_id uuid,
 p_direction text, p_expected_position integer, p_expected_neighbor_position integer
) returns jsonb language sql security invoker set search_path = '' as $rpc$
 select bossman_admin.queue_step(p_owner_pin,p_barber_id,p_entry_id,p_neighbor_id,p_direction,p_expected_position,p_expected_neighbor_position);
$rpc$;
revoke all on function public.owner_queue_step(text,text,uuid,uuid,text,integer,integer) from public;
grant execute on function public.owner_queue_step(text,text,uuid,uuid,text,integer,integer) to anon, authenticated;
comment on function public.owner_queue_step(text,text,uuid,uuid,text,integer,integer) is 'Owner-secret authorized atomic swap of adjacent waiting customers. Preserves current service and customer records; audited and backed up.';
