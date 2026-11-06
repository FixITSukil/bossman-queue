# Bossman permanent Google Sheets records

Bind `Code.gs` to the private **Bossman Permanent Records** spreadsheet. This script reads the durable Supabase backup event queue every minute. It writes customer records and change history, verifies the written cells and event IDs, and only then acknowledges the exported events. Failed changes remain pending for retry. Each execution handles at most five batches of 100 events; a script lock prevents overlapping exports.

## Setup

1. Open the destination spreadsheet, then **Extensions → Apps Script**. Paste `Code.gs` and set the manifest to `appsscript.json`.
2. Add these **Script Properties** in Project Settings:
   - `SUPABASE_URL`: the production Supabase project URL.
   - `SUPABASE_PUBLISHABLE_KEY`: the public key from `api.js`.
   - `BOSSMAN_BACKUP_KEY`: the private export key provisioned for the database backup RPCs. Never paste this key into code, a cell, a URL, or GitHub.
3. Run `setupBossmanBackup` from the bound script and authorize its spreadsheet, external-request and trigger permissions. Setup records the bound spreadsheet ID and backup start time, creates at most one one-minute trigger, and attempts the first sync.
4. Verify **Sync Status**, including last successful sync, pending events and any error. Confirm a new customer record and a later staff status change appear in both the relevant record tab and **Activity History**. A timer being installed alone does not mean data is backed up.

No web-app deployment, public sharing, service account, or Advanced Sheets service is needed. The old public Apps Script queue endpoint is not used.

The script uses its bound spreadsheet for both manual and timer executions and checks its ID against setup. It never opens a different file by ID, so the manifest keeps `spreadsheets.currentonly` permission. If the bound container is unavailable, execution fails and records an error in the database sync status; reopen the spreadsheet's own script project and rerun setup. Google's [bound-script methods](https://developers.google.com/apps-script/guides/bound#special_methods) are available from installable triggers.

## What is retained

- **Queue Records:** original customer entry ID, name, phone, barber, status, order, duration and timestamps. Phone numbers and IDs stay text; formula-like text is escaped.
- **Appointments:** customer details, service, booking time, status and linked queue ID.
- **Activity History:** each event ID, operation, original before/after data and UTC/Malaysia timestamps.
- **Business Records:** staff business settings, services, daily totals, owner queue actions and the non-secret `require_token` setting.
- **Sync Status:** last attempt/success, pending count and error details.

Cancellation tokens, booking tokens, staff/owner PINs, API keys and push credentials are excluded. Snapshot JSON larger than a Sheets cell is rejected visibly and left pending rather than truncated. Deletion events retain the latest record as a tombstone and keep event history; the script never clears or deletes spreadsheet rows. The newest event ID wins using decimal-string comparison, including IDs larger than JavaScript's safe integer range.

The script inserts additional blank rows or columns before a header or data write exceeds the current sheet grid, including beyond the initial 1,000 rows. Expansion preserves existing records. When there are no pending events, the minute check updates sync health without loading the retained customer/history indexes.

This records data available when backup is enabled and subsequent changes. It does not recreate customer data deleted before the backup began. Keep the legacy destructive nightly reset disabled. Staff should explicitly resolve unfinished queue entries rather than remove their history. Do not sort or edit identifier/event columns while the sync is running; use filter views for inspection. Duplicate identifiers or unexpected headers stop the sync without acknowledging events.

## Recovery and validation

After fixing a permission, network or spreadsheet error, run `syncBossmanRecords` again. Existing history event IDs are reused, so retries do not append duplicate events. Inspect both the Sheet's **Sync Status** and Apps Script execution logs. The database keeps the durable event history independently of delivery acknowledgements.

Run the local mock-based checks with `node integrations/google-sheets/sync.test.cjs`. A real authorized run and spreadsheet readback are also required before considering the integration active.
