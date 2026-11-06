-- Durable Google Sheets backup: transactional business-data journal + polling RPCs.
-- Google credentials and raw backup key never live in this migration or public JS.
-- Root configures ONLY a SHA-256 key hash and the private workbook URL separately.
-- No network requests occur inside customer transactions. No journal cleanup job.

create schema bossman_backup;
revoke all on schema bossman_backup from public, anon, authenticated, service_role;

create table bossman_backup.config (
  singleton boolean primary key default true check (singleton),
  key_hash text check (key_hash is null or key_hash ~ '^[0-9a-f]{64}$'),
  spreadsheet_url text,
  last_synced_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);
insert into bossman_backup.config(singleton) values (true);

create table bossman_backup.events (
  event_id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in
    ('queue_entries','bookings','barbers','services','daily_totals','owner_queue_audit','app_config')),
  operation text not null check (operation in ('INSERT','UPDATE','DELETE','SNAPSHOT')),
  record_id text not null,
  changed_at timestamptz not null default clock_timestamp(),
  before_data jsonb,
  after_data jsonb,
  exported_at timestamptz,
  check (before_data is not null or after_data is not null)
);
create index bossman_backup_pending_events on bossman_backup.events(event_id)
  where exported_at is null;
create index bossman_backup_entity_history on bossman_backup.events(entity_type,record_id,event_id);
alter table bossman_backup.config enable row level security;
alter table bossman_backup.events enable row level security;
revoke all on all tables in schema bossman_backup from public, anon, authenticated, service_role;
revoke all on all sequences in schema bossman_backup from public, anon, authenticated, service_role;

-- Explicit field allowlists keep new/unknown credential columns out of exports.
-- Names, phone TEXT, exact position, status, UUIDs and timestamps are retained.
-- Customer cancellation/booking tokens, staff PINs, QR/kiosk/VAPID keys are omitted.
create function bossman_backup.business_record(p_entity text,p_row jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_fields text[];
begin
  if p_row is null then return null; end if;
  case p_entity
    when 'queue_entries' then v_fields := array['id','barber_id','barber_name','customer_name','phone','status','position','duration_minutes','called_at','created_at'];
    when 'bookings' then v_fields := array['id','barber_id','service_id','service_name','duration_minutes','customer_name','phone','starts_at','status','queue_entry_id','created_at'];
    when 'barbers' then v_fields := array['id','name','is_active','avg_minutes','role','sort','off_days','is_listed','deleted_at'];
    when 'services' then v_fields := array['id','name','duration_minutes','is_active','sort','created_at'];
    when 'daily_totals' then v_fields := array['day','total_joined','total_served','per_worker','recorded_at'];
    when 'owner_queue_audit' then v_fields := array['id','operation_id','action','entry_id','customer_name','previous_state','next_state','reason','created_at'];
    when 'app_config' then
      if p_row->>'key' is distinct from 'require_token' then return null; end if;
      v_fields := array['key','value'];
    else raise exception 'Unsupported Bossman backup entity';
  end case;
  -- Keep explicit JSON nulls: clearing a time/status field is a meaningful change.
  return (select coalesce(jsonb_object_agg(j.key,j.value),'{}'::jsonb)
          from jsonb_each(p_row) j where j.key=any(v_fields));
end;
$$;
revoke all on function bossman_backup.business_record(text,jsonb) from public, anon, authenticated, service_role;

-- Internal trigger needs privileged access solely to append private history.
-- Base-table authorization continues to be enforced by the existing application.
create function bossman_backup.capture_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_record_id text;
begin
  if tg_table_schema <> 'public' or tg_table_name <> all(array[
    'queue_entries','bookings','barbers','services','daily_totals','owner_queue_audit','app_config'
  ]) then raise exception 'Unsupported Bossman backup source'; end if;
  if tg_op in ('UPDATE','DELETE') then
    v_before := bossman_backup.business_record(tg_table_name,to_jsonb(old));
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_after := bossman_backup.business_record(tg_table_name,to_jsonb(new));
  end if;
  if v_before is null and v_after is null then
    if tg_op='DELETE' then return old; end if;
    return null;
  end if;
  if tg_op='UPDATE' and v_before is not distinct from v_after then return null; end if;
  v_record_id := coalesce(v_after->>'id',v_after->>'day',v_after->>'key',
                          v_before->>'id',v_before->>'day',v_before->>'key');
  insert into bossman_backup.events(entity_type,operation,record_id,before_data,after_data)
    values(tg_table_name,tg_op,v_record_id,v_before,v_after);
  if tg_op='DELETE' then return old; end if;
  return null;
end;
$$;
revoke all on function bossman_backup.capture_change() from public, anon, authenticated, service_role;

-- History may be acknowledged, but neither rewritten nor deleted by a worker.
create function bossman_backup.protect_event_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Bossman backup history is append-only; deletion is disabled';
  end if;
  if (to_jsonb(new)-'exported_at') is distinct from (to_jsonb(old)-'exported_at') then
    raise exception 'Bossman backup history cannot be rewritten';
  end if;
  if old.exported_at is not null and new.exported_at is distinct from old.exported_at then
    raise exception 'Bossman backup acknowledgments cannot be cleared or rewritten';
  end if;
  return new;
end;
$$;
revoke all on function bossman_backup.protect_event_history() from public, anon, authenticated, service_role;
create trigger protect_backup_event_history before update or delete on bossman_backup.events
  for each row execute function bossman_backup.protect_event_history();

create function bossman_backup.reject_truncate()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'TRUNCATE is disabled for Bossman backup sources/history; use audited row operations to preserve customer records';
end;
$$;
revoke all on function bossman_backup.reject_truncate() from public, anon, authenticated, service_role;
create trigger protect_backup_event_truncate before truncate on bossman_backup.events
  for each statement execute function bossman_backup.reject_truncate();

-- Every exposed backup RPC validates a high-entropy backup-only key.
-- Blank, NULL, short and unconfigured keys all fail closed. No service-role key
-- or staff/owner credential is needed in Apps Script or in the workbook.
create function bossman_backup.require_key(p_backup_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  select key_hash into v_hash from bossman_backup.config where singleton;
  if p_backup_key is null or length(p_backup_key)<32 or v_hash is null
     or encode(extensions.digest(p_backup_key,'sha256'),'hex') <> v_hash then
    raise exception using errcode='28000',message='Invalid backup key';
  end if;
end;
$$;
revoke all on function bossman_backup.require_key(text) from public, anon, authenticated, service_role;

create function public.read_backup_events(p_backup_key text,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_events jsonb; v_pending bigint;
begin
  perform bossman_backup.require_key(p_backup_key);
  select count(*) into v_pending from bossman_backup.events where exported_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',e.event_id::text,'entity_type',e.entity_type,'operation',e.operation,
    'record_id',e.record_id,'changed_at',e.changed_at,
    'before_data',e.before_data,'after_data',e.after_data
  ) order by e.event_id),'[]'::jsonb) into v_events
  from (select * from bossman_backup.events where exported_at is null
        order by event_id limit greatest(1,least(coalesce(p_limit,100),500))) e;
  return jsonb_build_object('ok',true,'events',v_events,'pendingCount',v_pending);
end;
$$;
revoke all on function public.read_backup_events(text,integer) from public;
grant execute on function public.read_backup_events(text,integer) to anon,authenticated,service_role;

create function public.acknowledge_backup_events(p_backup_key text,p_event_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_pending bigint; v_synced timestamptz := clock_timestamp();
begin
  perform bossman_backup.require_key(p_backup_key);
  if coalesce(cardinality(p_event_ids),0)>500 then
    raise exception 'Acknowledge at most 500 backup events per request';
  end if;
  update bossman_backup.events set exported_at=v_synced
    where exported_at is null and event_id::text=any(coalesce(p_event_ids,'{}'::text[]));
  get diagnostics v_count=row_count;
  update bossman_backup.config set last_synced_at=v_synced,last_attempt_at=v_synced,last_error=null
    where singleton;
  select count(*) into v_pending from bossman_backup.events where exported_at is null;
  return jsonb_build_object('ok',true,'acknowledged',v_count,'pendingCount',v_pending,'lastSyncedAt',v_synced);
end;
$$;
revoke all on function public.acknowledge_backup_events(text,text[]) from public;
grant execute on function public.acknowledge_backup_events(text,text[]) to anon,authenticated,service_role;

create function public.record_backup_sync_status(p_backup_key text,p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform bossman_backup.require_key(p_backup_key);
  update bossman_backup.config set last_attempt_at=clock_timestamp(),last_error=left(p_error,2000)
    where singleton;
  return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.record_backup_sync_status(text,text) from public;
grant execute on function public.record_backup_sync_status(text,text) to anon,authenticated,service_role;

create function public.get_google_sheet_sync_status(p_owner_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner_pin text; v_config bossman_backup.config%rowtype; v_pending bigint;
begin
  select value into v_owner_pin from public.app_config where key='owner_pin';
  if p_owner_pin is null or v_owner_pin is null or p_owner_pin='' or v_owner_pin='' or p_owner_pin<>v_owner_pin then
    return jsonb_build_object('error','bad_pin');
  end if;
  select * into v_config from bossman_backup.config where singleton;
  select count(*) into v_pending from bossman_backup.events where exported_at is null;
  return jsonb_build_object('ok',true,
    'configured',v_config.key_hash is not null and v_config.spreadsheet_url is not null,
    'spreadsheetUrl',v_config.spreadsheet_url,'lastSyncedAt',v_config.last_synced_at,
    'lastAttemptAt',v_config.last_attempt_at,'pendingCount',v_pending,'failedCount',0,
    'lastError',v_config.last_error);
end;
$$;
revoke all on function public.get_google_sheet_sync_status(text) from public;
grant execute on function public.get_google_sheet_sync_status(text) to anon,authenticated,service_role;

-- Lock all sources before installing triggers/snapshotting. The one migration
-- transaction makes the baseline and subsequent change capture gap-free.
lock table public.queue_entries,public.bookings,public.barbers,public.services,
  public.daily_totals,public.owner_queue_audit,public.app_config in share row exclusive mode;
do $$
declare v_entity text;
begin
  foreach v_entity in array array['queue_entries','bookings','barbers','services','daily_totals','owner_queue_audit','app_config'] loop
    execute format('create trigger bossman_backup_row after insert or update on public.%I for each row execute function bossman_backup.capture_change()',v_entity);
    execute format('create trigger bossman_backup_delete before delete on public.%I for each row execute function bossman_backup.capture_change()',v_entity);
    execute format('create trigger bossman_backup_no_truncate before truncate on public.%I for each statement execute function bossman_backup.reject_truncate()',v_entity);
    execute format('insert into bossman_backup.events(entity_type,operation,record_id,after_data) select %L,''SNAPSHOT'',coalesce(d->>''id'',d->>''day'',d->>''key''),d from (select bossman_backup.business_record(%L,to_jsonb(t)) as d from public.%I t) s where d is not null',v_entity,v_entity,v_entity);
  end loop;
end;
$$;

comment on table bossman_backup.events is 'Append-only Bossman business-data recovery journal. Completion/cancellation/deletion retains prior customer details. Tokens/credentials excluded. exported_at is delivery acknowledgment only.';
comment on schema bossman_backup is 'Private backup journal and hashed-key configuration. Never expose this schema or grant API roles direct table access.';
comment on function public.read_backup_events(text,integer) is 'Server-side backup-only key required. Never call from customer JS or put the key in a Sheet cell. ScriptLock and event_id deduplication required on the Sheets writer.';
