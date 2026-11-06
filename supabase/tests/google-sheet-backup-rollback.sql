-- Meaningful smoke/regression checks. Run AFTER migration as postgres.
-- All fixture rows/configuration/capture events are rolled back at the end.
-- Does not send network requests or reveal production staff/owner secrets.
begin;
do $$
declare
  v_key text := 'bossman-isolated-backup-verification-key-00000001';
  v_id uuid;
  v_barber text;
  v_barber_name text;
  v_event_ids text[];
  v_record jsonb;
  v_result jsonb;
  v_count integer;
  v_expected integer;
  v_denied boolean;
begin
  -- Both unconfigured and incorrect backup keys fail closed.
  update bossman_backup.config set key_hash=null where singleton;
  v_denied:=false;
  begin perform public.read_backup_events(v_key,1);
  exception when invalid_authorization_specification then v_denied:=true; end;
  assert v_denied, 'Unconfigured backup key was accepted';
  update bossman_backup.config set
    key_hash=encode(extensions.digest(v_key,'sha256'),'hex'),
    spreadsheet_url='https://docs.google.com/spreadsheets/d/isolated-verification'
  where singleton;
  v_denied:=false;
  begin perform public.read_backup_events(null,1);
  exception when invalid_authorization_specification then v_denied:=true; end;
  assert v_denied, 'NULL backup key was accepted';
  v_denied:=false;
  begin perform public.read_backup_events('wrong-key',1);
  exception when invalid_authorization_specification then v_denied:=true; end;
  assert v_denied, 'Wrong backup key was accepted';
  v_denied:=false;
  begin perform public.acknowledge_backup_events('wrong-key','{}'::text[]);
  exception when invalid_authorization_specification then v_denied:=true; end;
  assert v_denied, 'Wrong key acknowledged backup history';
  v_denied:=false;
  begin perform public.record_backup_sync_status('wrong-key','bad');
  exception when invalid_authorization_specification then v_denied:=true; end;
  assert v_denied, 'Wrong key changed backup sync status';
  assert public.get_google_sheet_sync_status(null)->>'error'='bad_pin', 'NULL owner PIN accepted';

  -- Explicit allowlists retain business data, nulls and leading-zero phone TEXT.
  v_record:=bossman_backup.business_record('queue_entries',jsonb_build_object(
    'id','fixture','customer_name','Fixture Customer','phone','01100112233',
    'status','waiting','position',4,'called_at',null,'cancel_token','secret',
    'future_private_key','secret'));
  assert v_record->>'phone'='01100112233';
  assert v_record ? 'called_at' and v_record->'called_at'='null'::jsonb;
  assert not (v_record ? 'cancel_token');
  assert not (v_record ? 'future_private_key');
  assert not (bossman_backup.business_record('barbers','{"id":"fixture","pin":"secret"}'::jsonb) ? 'pin');
  assert not (bossman_backup.business_record('bookings','{"id":"fixture","customer_token":"secret"}'::jsonb) ? 'customer_token');
  assert bossman_backup.business_record('app_config','{"key":"owner_pin","value":"secret"}'::jsonb) is null;
  assert bossman_backup.business_record('app_config','{"key":"require_token","value":"true"}'::jsonb)->>'value'='true';

  -- Actual queue INSERT / UPDATE / DELETE retains every customer business state.
  select id,name into v_barber,v_barber_name from public.barbers where deleted_at is null limit 1;
  assert v_barber is not null, 'A non-archived worker is required for rollback verification';
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
    values(v_barber,v_barber_name,'Backup rollback fixture','01100112233','waiting',99999)
    returning id into v_id;
  update public.queue_entries set customer_name='Backup rollback fixture updated',position=99998 where id=v_id;
  -- No-op update should not produce another event.
  update public.queue_entries set position=position where id=v_id;
  delete from public.queue_entries where id=v_id;
  select count(*),array_agg(event_id::text order by event_id) into v_count,v_event_ids
    from bossman_backup.events where entity_type='queue_entries' and record_id=v_id::text;
  assert v_count=3, 'Expected exactly INSERT / UPDATE / DELETE events';
  assert exists(select 1 from bossman_backup.events where record_id=v_id::text and operation='DELETE'
    and before_data->>'phone'='01100112233' and before_data->>'position'='99998' and after_data is null);
  assert not exists(select 1 from bossman_backup.events where record_id=v_id::text
    and ((before_data ? 'cancel_token') or (after_data ? 'cancel_token')));

  -- Ack is authenticated, idempotent and does not delete history.
  v_result:=public.acknowledge_backup_events(v_key,v_event_ids);
  assert (v_result->>'acknowledged')::integer=3;
  v_result:=public.acknowledge_backup_events(v_key,v_event_ids);
  assert (v_result->>'acknowledged')::integer=0;
  select count(*) into v_count from bossman_backup.events where record_id=v_id::text;
  assert v_count=3, 'Acknowledgment deleted history';
  v_result:=public.read_backup_events(v_key,2);
  assert v_result->>'ok'='true';
  assert jsonb_array_length(v_result->'events')<=2;
  if jsonb_array_length(v_result->'events')>0 then
    assert jsonb_typeof(v_result->'events'->0->'event_id')='string';
  end if;
  perform public.record_backup_sync_status(v_key,'Isolated fixture failure');
  assert (select last_error='Isolated fixture failure' from bossman_backup.config where singleton);

  -- Direct clients cannot access the journal; TRUNCATE cannot bypass capture.
  assert not has_schema_privilege('anon','bossman_backup','USAGE');
  assert not has_schema_privilege('authenticated','bossman_backup','USAGE');
  assert not has_schema_privilege('service_role','bossman_backup','USAGE');
  v_denied:=false;
  begin execute 'truncate public.queue_entries cascade';
  exception when raise_exception then v_denied:=true; end;
  assert v_denied, 'TRUNCATE bypassed customer history capture';
  v_denied:=false;
  begin execute 'truncate bossman_backup.events';
  exception when raise_exception then v_denied:=true; end;
  assert v_denied, 'TRUNCATE deleted backup history';
  v_denied:=false;
  begin delete from bossman_backup.events where record_id=v_id::text;
  exception when raise_exception then v_denied:=true; end;
  assert v_denied, 'Backup history DELETE was allowed';
  v_denied:=false;
  begin update bossman_backup.events set before_data='{}'::jsonb where record_id=v_id::text;
  exception when raise_exception then v_denied:=true; end;
  assert v_denied, 'Backup history rewrite was allowed';
end;
$$;
rollback;
