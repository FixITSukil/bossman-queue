/** Bound to the private Bossman Permanent Records spreadsheet. No secrets here. */
var BOSSMAN_BACKUP = {
  batchSize: 100,
  maxBatches: 5,
  queue: {name: 'Queue Records', headers: ['Entry ID','Customer Name','Phone','Barber ID','Barber Name','Status','Position','Duration Minutes','Created At UTC','Created At MYT','Called At UTC','Called At MYT','Recorded At UTC','Event ID','Deleted At UTC']},
  appointments: {name: 'Appointments', headers: ['Booking ID','Customer Name','Phone','Barber ID','Service ID','Service Name','Duration Minutes','Starts At UTC','Starts At MYT','Status','Queue Entry ID','Created At UTC','Recorded At UTC','Event ID','Deleted At UTC']},
  history: {name: 'Activity History', headers: ['Event ID','Entity Type','Operation','Record ID','Changed At UTC','Changed At MYT','Customer Name','Phone','Barber Name','Status','Position','Before JSON','After JSON']},
  business: {name: 'Business Records', headers: ['Entity Type','Record ID','Changed At UTC','Event ID','Deleted At UTC','Snapshot JSON']},
  status: {name: 'Sync Status', headers: ['Setting','Value']}
};

function setupBossmanBackup() {
  var properties = PropertiesService.getScriptProperties();
  bossmanBackupConfig_(properties);
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the Bossman Permanent Records spreadsheet.');
  var savedId = properties.getProperty('BOSSMAN_SPREADSHEET_ID');
  if (savedId && savedId !== spreadsheet.getId()) throw new Error('The saved backup spreadsheet does not match this bound spreadsheet.');
  properties.setProperty('BOSSMAN_SPREADSHEET_ID', spreadsheet.getId());
  if (!properties.getProperty('BOSSMAN_BACKUP_STARTED_UTC')) properties.setProperty('BOSSMAN_BACKUP_STARTED_UTC', new Date().toISOString());
  var triggers = ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'syncBossmanRecords'; });
  triggers.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!triggers.length) ScriptApp.newTrigger('syncBossmanRecords').timeBased().everyMinutes(1).create();
  return syncBossmanRecords();
}

function syncBossmanRecords() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {ok: false, skipped: true, reason: 'Another sync is running.'};
  var config, spreadsheet, properties, status, pending = null;
  try {
    properties = PropertiesService.getScriptProperties();
    config = bossmanBackupConfig_(properties);
    var spreadsheetId = properties.getProperty('BOSSMAN_SPREADSHEET_ID');
    if (!spreadsheetId) throw new Error('Run setupBossmanBackup once from the bound spreadsheet.');
    spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    // Bound scripts can refer to their parent from installable triggers. Keep
    // current-document-only permission; never fall back to opening another file.
    if (!spreadsheet) throw new Error('The bound backup spreadsheet is unavailable. Open its Extensions → Apps Script project and run setupBossmanBackup again.');
    if (spreadsheet.getId() !== spreadsheetId) throw new Error('Backup spreadsheet mismatch.');
    status = bossmanStatusStore_(spreadsheet);
    bossmanWriteStatus_(status, {
      'Status': 'Syncing', 'Last Attempt UTC': new Date().toISOString(),
      'Source': config.url, 'Backup Started UTC': properties.getProperty('BOSSMAN_BACKUP_STARTED_UTC') || '',
      'Notes': 'Records are retained. Backups begin when this integration is enabled; deleted earlier records are not recreated.'
    });
    // Idle one-minute checks do not scan retained customer/history data.
    var stores = null;
    var exported = 0;
    for (var batch = 0; batch < BOSSMAN_BACKUP.maxBatches; batch++) {
      var response = bossmanRpc_(config, 'read_backup_events', {p_limit: BOSSMAN_BACKUP.batchSize});
      if (!Array.isArray(response.events)) throw new Error('The backup source returned an invalid event list.');
      pending = bossmanPending_(response.pendingCount);
      if (!response.events.length) {
        if (pending !== 0) throw new Error('The backup source reports pending changes but returned no events.');
        var heartbeat = bossmanRpc_(config, 'acknowledge_backup_events', {p_event_ids: []});
        pending = bossmanPending_(heartbeat.pendingCount);
        if (pending === 0) break;
        continue;
      }
      var events = bossmanPrepareEvents_(response.events);
      // Read each record index once, only when a nonempty batch needs it.
      if (!stores) stores = {
        queue: bossmanRecordStore_(spreadsheet, BOSSMAN_BACKUP.queue, 0, 13),
        appointments: bossmanRecordStore_(spreadsheet, BOSSMAN_BACKUP.appointments, 0, 13),
        history: bossmanRecordStore_(spreadsheet, BOSSMAN_BACKUP.history, 0, 0),
        business: bossmanRecordStore_(spreadsheet, BOSSMAN_BACKUP.business, -1, 3)
      };
      events.forEach(function(event) { bossmanApplyEvent_(stores, event); });
      // Latest records are verified before the immutable event history is saved.
      bossmanFlushStore_(stores.queue);
      bossmanFlushStore_(stores.appointments);
      bossmanFlushStore_(stores.business);
      bossmanFlushStore_(stores.history);
      // Do not acknowledge any event until its actual history ID is verified.
      bossmanVerifyHistory_(stores.history, events);
      var result = bossmanRpc_(config, 'acknowledge_backup_events', {p_event_ids: events.map(function(event) { return event.event_id; })});
      pending = bossmanPending_(result.pendingCount);
      exported += events.length;
      if (pending === 0) break;
    }
    var now = new Date().toISOString();
    bossmanWriteStatus_(status, {
      'Status': pending === 0 ? 'Up to date' : 'Waiting to sync',
      'Last Successful Sync UTC': now, 'Last Successful Sync MYT': bossmanMyt_(now),
      'Last Attempt UTC': now, 'Pending Events': pending, 'Last Error': ''
    });
    return {ok: true, exported: exported, pendingCount: pending};
  } catch (error) {
    var message = bossmanSafeError_(error, config);
    if (status) {
      try { bossmanWriteStatus_(status, {'Status': 'Needs attention', 'Last Attempt UTC': new Date().toISOString(), 'Pending Events': pending === null ? 'Unknown' : pending, 'Last Error': message}); } catch (ignored) {}
    }
    if (config) {
      try { bossmanRpc_(config, 'record_backup_sync_status', {p_error: message}); } catch (ignored) {}
    }
    throw new Error(message);
  } finally {
    lock.releaseLock();
  }
}

function bossmanBackupConfig_(properties) {
  var config = {
    url: String(properties.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''),
    publicKey: properties.getProperty('SUPABASE_PUBLISHABLE_KEY'),
    backupKey: properties.getProperty('BOSSMAN_BACKUP_KEY')
  };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url) || !config.publicKey || !config.backupKey) {
    throw new Error('Set valid SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and BOSSMAN_BACKUP_KEY in Script Properties.');
  }
  return config;
}

function bossmanRpc_(config, name, params) {
  var body = Object.assign({p_backup_key: config.backupKey}, params);
  var response = UrlFetchApp.fetch(config.url + '/rest/v1/rpc/' + name, {
    method: 'post', contentType: 'application/json',
    headers: {apikey: config.publicKey, Authorization: 'Bearer ' + config.publicKey},
    payload: JSON.stringify(body), muteHttpExceptions: true, followRedirects: false
  });
  var code = response.getResponseCode(), data;
  try { data = JSON.parse(response.getContentText()); } catch (error) { throw new Error(name + ' returned an unreadable response (HTTP ' + code + ').'); }
  if (code < 200 || code >= 300 || !data || data.ok !== true) throw new Error(name + ' failed (HTTP ' + code + '): ' + String(data && (data.message || data.error) || 'Request rejected.'));
  return data;
}

function bossmanPending_(value) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0 || Math.floor(value) !== value) throw new Error('The backup source returned an invalid pending count.');
  return value;
}

function bossmanEventId_(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Every event ID must be a decimal string.');
  return value.replace(/^0+(?=\d)/, '');
}

function bossmanCompareEventIds_(a, b) {
  a = bossmanEventId_(a); b = bossmanEventId_(b);
  return a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length < b.length ? -1 : 1;
}

function bossmanPrepareEvents_(input) {
  var seen = {}, events = [];
  input.forEach(function(raw) {
    var event = {
      event_id: bossmanEventId_(raw.event_id), entity_type: String(raw.entity_type || ''),
      operation: String(raw.operation || '').toUpperCase(), record_id: String(raw.record_id || ''),
      changed_at: String(raw.changed_at || ''), before_data: bossmanSanitize_(raw.before_data), after_data: bossmanSanitize_(raw.after_data)
    };
    if (!event.record_id || !event.operation || !event.changed_at || !/^(queue_entries|bookings|barbers|services|daily_totals|owner_queue_audit|app_config)$/.test(event.entity_type)) throw new Error('The backup source returned an unsupported event.');
    bossmanMyt_(event.changed_at);
    if (event.entity_type === 'app_config') {
      var setting = event.after_data || event.before_data || {};
      if (setting.key !== 'require_token') throw new Error('A private application setting was excluded from backup.');
    }
    // Validate both history cells before any batch is written.
    bossmanJson_(event.before_data); bossmanJson_(event.after_data);
    var fingerprint = JSON.stringify(event);
    if (Object.prototype.hasOwnProperty.call(seen, event.event_id)) {
      if (seen[event.event_id] !== fingerprint) throw new Error('Conflicting payloads share the same event ID.');
      return;
    }
    seen[event.event_id] = fingerprint; events.push(event);
  });
  return events.sort(function(a,b) { return bossmanCompareEventIds_(a.event_id, b.event_id); });
}

function bossmanSanitize_(value) {
  if (value === null || typeof value === 'undefined') return null;
  if (Array.isArray(value)) return value.map(bossmanSanitize_);
  if (typeof value !== 'object') return value;
  var clean = {};
  Object.keys(value).forEach(function(key) {
    var normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/^(pin|ownerpin|barberpin|canceltoken|customertoken|token|secret|qrsecret|apikey|publickey|privatekey|backupkey|supabasepublishablekey|supabasesecretkey|servicerole|authorization|password|accesstoken|refreshtoken|auth|p256dh|endpoint|subscription)$/.test(normalized)) return;
    clean[key] = bossmanSanitize_(value[key]);
  });
  return clean;
}

function bossmanText_(value) { return value === null || typeof value === 'undefined' ? '' : String(value); }
function bossmanJson_(value) {
  if (value === null) return '';
  var json = JSON.stringify(value);
  if (json.length > 50000) throw new Error('A backup JSON cell exceeds the Google Sheets 50,000-character limit. The event remains pending.');
  return json;
}
function bossmanMyt_(value) {
  if (!value) return '';
  var date = new Date(value);
  if (!isFinite(date.getTime())) throw new Error('A backup event contains an invalid timestamp.');
  return Utilities.formatDate(date, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm:ss');
}
function bossmanEncodeCell_(value) {
  var text = bossmanText_(value);
  var safe = /^[\s\uFEFF]*[=+\-@']/.test(text) ? "'" + text : text;
  if (safe.length > 50000) throw new Error('A backup cell exceeds the Google Sheets 50,000-character limit. The event remains pending.');
  return safe;
}

function bossmanSheet_(spreadsheet, definition) {
  var sheet = spreadsheet.getSheetByName(definition.name) || spreadsheet.insertSheet(definition.name);
  if (sheet.getLastRow() === 0) bossmanWriteVerified_(sheet, 1, [definition.headers]);
  bossmanEnsureGrid_(sheet, 1, definition.headers.length);
  var header = sheet.getRange(1, 1, 1, definition.headers.length).getValues()[0];
  if (header.map(bossmanText_).join('\u0000') !== definition.headers.join('\u0000')) throw new Error('Unexpected headers in ' + definition.name + '. Existing rows were preserved.');
  return sheet;
}

function bossmanRecordStore_(spreadsheet, definition, keyColumn, eventColumn) {
  var sheet = bossmanSheet_(spreadsheet, definition), rows = sheet.getDataRange().getValues();
  var index = {};
  for (var i = 1; i < rows.length; i++) {
    var key = keyColumn === -1 ? bossmanText_(rows[i][0]) + '\u0000' + bossmanText_(rows[i][1]) : bossmanText_(rows[i][keyColumn]);
    if (!key || key === '\u0000') continue;
    if (Object.prototype.hasOwnProperty.call(index, key)) throw new Error('Duplicate record IDs in ' + definition.name + '. Existing rows were preserved.');
    index[key] = i;
  }
  return {sheet: sheet, rows: rows, index: index, eventColumn: eventColumn, dirty: {}};
}

function bossmanUpsert_(store, key, row, eventId, deleting) {
  var existing = Object.prototype.hasOwnProperty.call(store.index, key) ? store.index[key] : -1;
  if (existing >= 0 && store.rows[existing][store.eventColumn] !== '' && typeof store.rows[existing][store.eventColumn] !== 'undefined') {
    if (bossmanCompareEventIds_(bossmanText_(store.rows[existing][store.eventColumn]), eventId) > 0) return;
  }
  if (deleting && existing >= 0) {
    // A deletion is a retained tombstone, never a removed customer row.
    var retained = store.rows[existing].slice(0, row.length);
    if (store.eventColumn === 13) { retained[12] = row[12]; retained[13] = eventId; retained[14] = row[14]; }
    else { retained[2] = row[2]; retained[3] = eventId; retained[4] = row[4]; if (row[5]) retained[5] = row[5]; }
    row = retained;
  }
  row = row.map(bossmanText_); row.forEach(bossmanEncodeCell_);
  if (existing < 0) { existing = store.rows.length; store.rows.push(row); store.index[key] = existing; }
  else store.rows[existing] = row;
  store.dirty[existing] = true;
}

function bossmanApplyEvent_(stores, event) {
  var after = event.after_data || {}, before = event.before_data || {}, data = event.after_data || event.before_data || {};
  var changed = event.changed_at, deleted = event.operation === 'DELETE' ? changed : '';
  var row;
  if (event.entity_type === 'queue_entries') {
    row = [event.record_id,data.customer_name,data.phone,data.barber_id,data.barber_name,data.status,data.position,data.duration_minutes,data.created_at,bossmanMyt_(data.created_at),data.called_at,bossmanMyt_(data.called_at),changed,event.event_id,deleted];
    bossmanUpsert_(stores.queue, event.record_id, row, event.event_id, !!deleted);
  } else if (event.entity_type === 'bookings') {
    row = [event.record_id,data.customer_name,data.phone,data.barber_id,data.service_id,data.service_name,data.duration_minutes,data.starts_at,bossmanMyt_(data.starts_at),data.status,data.queue_entry_id,data.created_at,changed,event.event_id,deleted];
    bossmanUpsert_(stores.appointments, event.record_id, row, event.event_id, !!deleted);
  } else {
    row = [event.entity_type,event.record_id,changed,event.event_id,deleted,bossmanJson_(data)];
    bossmanUpsert_(stores.business, event.entity_type + '\u0000' + event.record_id, row, event.event_id, !!deleted);
  }
  var history = [event.event_id,event.entity_type,event.operation,event.record_id,changed,bossmanMyt_(changed),after.customer_name || before.customer_name,after.phone || before.phone,after.barber_name || before.barber_name,after.status || before.status,typeof after.position !== 'undefined' ? after.position : before.position,bossmanJson_(event.before_data),bossmanJson_(event.after_data)];
  bossmanUpsert_(stores.history, event.event_id, history, event.event_id, false);
}

function bossmanFlushStore_(store) {
  var rows = Object.keys(store.dirty).map(Number).sort(function(a,b) { return a-b; });
  for (var offset = 0; offset < rows.length;) {
    var start = rows[offset], end = offset + 1;
    while (end < rows.length && rows[end] === rows[end-1] + 1) end++;
    bossmanWriteVerified_(store.sheet, start + 1, rows.slice(offset, end).map(function(index) { return store.rows[index]; }));
    offset = end;
  }
  store.dirty = {};
}

function bossmanWriteVerified_(sheet, firstRow, rows) {
  if (!rows.length) return;
  var expected = rows.map(function(row) { return row.map(bossmanText_); });
  var encoded = expected.map(function(row) { return row.map(bossmanEncodeCell_); });
  bossmanEnsureGrid_(sheet, firstRow + encoded.length - 1, encoded[0].length);
  var range = sheet.getRange(firstRow, 1, encoded.length, encoded[0].length);
  range.setNumberFormat('@'); range.setValues(encoded);
  SpreadsheetApp.flush();
  var actual = range.getValues(), formulas = range.getFormulas();
  expected.forEach(function(row, r) { row.forEach(function(value, c) {
    // Sheets must consume the leading apostrophe as a literal-text marker.
    // Require exact source text, including original leading zeroes/quotes.
    if (formulas[r][c] || bossmanText_(actual[r][c]) !== value) throw new Error('Write verification failed in ' + sheet.getName() + ' row ' + (firstRow+r) + '. No events were acknowledged.');
  }); });
}

function bossmanEnsureGrid_(sheet, requiredRows, requiredColumns) {
  var maximumRows = sheet.getMaxRows();
  if (requiredRows > maximumRows) sheet.insertRowsAfter(maximumRows, requiredRows - maximumRows);
  var maximumColumns = sheet.getMaxColumns();
  if (requiredColumns > maximumColumns) sheet.insertColumnsAfter(maximumColumns, requiredColumns - maximumColumns);
}

function bossmanVerifyHistory_(store, events) {
  var expected = events.map(function(event) {
    var index = store.index[event.event_id];
    if (typeof index !== 'number') throw new Error('A history event ID could not be verified. No events were acknowledged.');
    return {row: index, id: event.event_id};
  }).sort(function(a,b) { return a.row-b.row; });
  for (var offset=0; offset<expected.length;) {
    var end=offset+1;
    while (end<expected.length && expected[end].row===expected[end-1].row+1) end++;
    var actual=store.sheet.getRange(expected[offset].row+1,1,end-offset,1).getValues();
    for (var i=offset;i<end;i++) {
      if (bossmanText_(actual[i-offset][0]) !== expected[i].id) throw new Error('A history event ID could not be verified. No events were acknowledged.');
    }
    offset=end;
  }
}

function bossmanStatusStore_(spreadsheet) {
  var sheet = bossmanSheet_(spreadsheet, BOSSMAN_BACKUP.status);
  return {sheet: sheet, rows: sheet.getDataRange().getValues()};
}
function bossmanWriteStatus_(store, values) {
  var keys = {};
  for (var i=1; i<store.rows.length; i++) keys[bossmanText_(store.rows[i][0])] = i;
  Object.keys(values).forEach(function(key) {
    var index = Object.prototype.hasOwnProperty.call(keys,key) ? keys[key] : store.rows.length;
    store.rows[index] = [key,bossmanText_(values[key])]; keys[key] = index;
  });
  bossmanWriteVerified_(store.sheet, 1, store.rows.map(function(row) { return [bossmanText_(row[0]),bossmanText_(row[1])]; }));
}
function bossmanSafeError_(error, config) {
  var message = String(error && error.message || error || 'Unknown backup error.');
  if (config) [config.publicKey,config.backupKey].forEach(function(secret) { if (secret) message = message.split(secret).join('[redacted]'); });
  return message.slice(0, 1500);
}
