-- Reject blank owner credentials as well as NULL before returning sync status.
create or replace function public.get_google_sheet_sync_status(p_owner_pin text)
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
