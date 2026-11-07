-- Run AFTER the phone-only recovery migration as postgres.
-- Every fixture source row and its backup events are rolled back; no real phone
-- or production credential is returned. Existing customer rows are untouched.
begin;
do $$
declare
  v_barber text := 'phone-recovery-test-hair-'||gen_random_uuid()::text;
  v_therapist text := 'phone-recovery-test-facial-'||gen_random_uuid()::text;
  v_phone text := '609900123456789';
  v_phone_old text := '609900123456788';
  v_first uuid; v_facial uuid; v_second uuid; v_same_name uuid;
  v_history uuid; v_yesterday uuid;
  v_result jsonb; v_legacy jsonb; v_match jsonb; v_entry jsonb;
  v_count bigint; v_after_count bigint; v_event_count bigint;
  v_status text;
begin
  -- Fail rather than touch a coincidentally matching real record.
  assert not exists(select 1 from public.queue_entries where
    regexp_replace(coalesce(phone,''),'[^0-9]','','g') in
      (v_phone,'09900123456789',v_phone_old,'09900123456788')),
    'Reserved verification phone unexpectedly exists';
  insert into public.barbers(id,name,pin,is_active,is_listed,role,sort)
    values(v_barber,'Phone recovery test worker',gen_random_uuid()::text,true,true,'barber',99999),
          (v_therapist,'Phone recovery test therapist',gen_random_uuid()::text,true,true,'therapist',99999);
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
    values(v_barber,'Phone recovery test worker','Kirthikraj',v_phone,'waiting',71)
    returning id into v_first;

  -- Exact name is irrelevant: local 0 / +60 / punctuation all resolve the same
  -- normalized phone, without changing the stored customer identity or order.
  v_result := public.recover_queue_by_phone('09900123456789');
  assert v_result->>'ok'='true';
  assert jsonb_array_length(v_result->'matches')=1;
  assert v_result->'matches'->0->>'customerName'='Kirthikraj';
  assert v_result->'matches'->0->'entries'->0->>'id'=v_first::text;
  assert v_result->'matches'->0->'entries'->0->>'position'='71';
  v_legacy := public.recover_queue('Kirthik','+60 9900-123-456789')::jsonb;
  assert v_legacy->>'ok'='true';
  assert v_legacy->'entries'->0->>'id'=v_first::text;
  v_legacy := public.recover_queue(null,v_phone)::jsonb;
  assert v_legacy->>'ok'='true', 'Cached name must not become a requirement';

  -- A unique QR-generated parallel facial belongs to this same customer group.
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
    values(v_therapist,'Phone recovery test therapist','  Kirthikraj   (facial)  ','09900123456789','waiting',12)
    returning id into v_facial;
  v_result := public.recover_queue_by_phone('+609900123456789');
  assert jsonb_array_length(v_result->'matches')=1;
  assert jsonb_array_length(v_result->'matches'->0->'entries')=2;
  assert v_result->>'requiresSelection'='false';
  v_legacy := public.recover_queue('Wrong spelling',v_phone)::jsonb;
  assert jsonb_array_length(v_legacy->'entries')=2;

  -- Another person sharing a phone is a separate explicit choice.
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
    values(v_barber,'Phone recovery test worker','Different customer',v_phone,'called',72)
    returning id into v_second;
  v_result := public.recover_queue_by_phone(v_phone);
  assert jsonb_array_length(v_result->'matches')=2;
  assert v_result->>'requiresSelection'='true';
  v_legacy := public.recover_queue('Kirthikraj',v_phone)::jsonb;
  assert v_legacy->>'code'='multiple_active_queues';
  assert not(v_legacy ? 'entries'), 'Cached UI must never pick an ambiguous customer';

  -- Even identical names cannot silently combine unrelated haircut records.
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
    values(v_barber,'Phone recovery test worker','Kirthikraj',v_phone,'waiting',73)
    returning id into v_same_name;
  v_result := public.recover_queue_by_phone(v_phone);
  assert jsonb_array_length(v_result->'matches')=4;
  for v_match in select value from jsonb_array_elements(v_result->'matches') loop
    assert jsonb_array_length(v_match->'entries')=1, 'An ambiguous facial pair was grouped';
  end loop;

  -- Completed/no-show/cancelled history is never returned as an active queue.
  foreach v_status in array array['done','no_show','cancelled_by_customer','cancelled_by_barber'] loop
    insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position)
      values(v_barber,'Phone recovery test worker','Historic fixture',v_phone,v_status,99)
      returning id into v_history;
  end loop;
  v_result := public.recover_queue_by_phone(v_phone);
  assert jsonb_array_length(v_result->'matches')=4;
  for v_match in select value from jsonb_array_elements(v_result->'matches') loop
    for v_entry in select value from jsonb_array_elements(v_match->'entries') loop
      assert v_entry->>'status' in ('waiting','called');
      assert not(v_entry ? 'cancelToken') and not(v_entry ? 'cancel_token');
      assert not(v_entry ? 'customerToken') and not(v_entry ? 'customer_token');
      assert not(v_entry ? 'pin') and not(v_entry ? 'phone');
    end loop;
  end loop;

  -- Active customers can legitimately cross midnight. Do not impose today-only.
  insert into public.queue_entries(barber_id,barber_name,customer_name,phone,status,position,created_at)
    values(v_barber,'Phone recovery test worker','Still waiting from yesterday',v_phone_old,'waiting',74,now()-interval '2 days')
    returning id into v_yesterday;
  assert public.recover_queue_by_phone(v_phone_old)->'matches'->0->'entries'->0->>'id'=v_yesterday::text;
  assert public.recover_queue_by_phone('123')->>'code'='invalid_phone';
  assert public.recover_queue_by_phone(null)->>'code'='invalid_phone';
  assert public.recover_queue_by_phone('609900123456787')->>'code'='not_found';

  -- Reading does not mutate original names, positions or permanent history.
  select count(*) into v_count from public.queue_entries;
  select count(*) into v_event_count from bossman_backup.events;
  perform public.recover_queue_by_phone(v_phone);
  perform public.recover_queue('Kirthik',v_phone);
  select count(*) into v_after_count from public.queue_entries;
  assert v_after_count=v_count;
  assert (select customer_name='Kirthikraj' and position=71 from public.queue_entries where id=v_first);
  assert (select count(*) from bossman_backup.events)=v_event_count;
  assert has_function_privilege('anon','public.recover_queue_by_phone(text)','EXECUTE');
  assert has_function_privilege('authenticated','public.recover_queue_by_phone(text)','EXECUTE');
  assert not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where p.oid='public.recover_queue_by_phone(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE');
end;
$$;
rollback;
