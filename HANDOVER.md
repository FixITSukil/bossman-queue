# Bossman Queue System — Handover

A simple QR-based queue system for Bossman Gentleman's Club Barbershop.
Customers scan a QR at the counter, pick a worker, and join the queue. Workers
manage their line from their phone. The owner sees everything at a glance.

Everything runs on hosted web services; there is nothing to install on customer devices.

---

## 1. The links

| Who | Link | Notes |
|-----|------|-------|
| **Tablet at counter** | `https://fixitsukil.github.io/bossman-queue/qr-display.html` | Shows the permanent QR. Keep this open fullscreen on the tablet during business hours. |
| **Customer** | `https://fixitsukil.github.io/bossman-queue/` | Opens when a customer scans the QR. |
| **Owner** | `https://fixitsukil.github.io/bossman-queue/owner.html?pin=<OWNER_SECRET>` | Live view of all queues + today's totals. |
| **Website / menu** | `https://fixitsukil.github.io/bossman-queue/website.html` | Premium price-list page. |
| **Worker dashboard** | `https://fixitsukil.github.io/bossman-queue/barber.html?pin=<WORKER_SECRET>` | Each worker has their own private secret link. |

**Do not commit production owner/worker secrets to this repository.** Store each private link only on the relevant staff device or in a secure password manager.

---

## 2. Daily use

### Opening
1. Turn on/unlock the counter iPad and open the **Bossman Queue** Home Screen icon.
2. Keep the QR display open for the whole business day.
3. Each worker opens their own private dashboard link on their phone.
4. In the owner dashboard, check **Google Sheets records**. Review the last confirmed copy time and changes waiting to copy. Open **permanent records** to see the private workbook.

### A customer arrives
1. They scan the QR on the iPad.
2. They pick a barber or therapist.
3. They enter their name + WhatsApp number and tap **Join Queue**.
4. They see their live queue position and estimated wait.

### A worker serving customers
- The worker dashboard shows who's waiting.
- Tap **Call Next**, set the service duration, then **Call & Start**.
- Use the call/WhatsApp buttons if the customer has stepped away.
- Tap done when finished, or no-show when appropriate.

### Closing
- Staff must explicitly complete, cancel, or mark a no-show for each customer. Keep unresolved customers in their existing queue until staff resolve them.
- The former **11 PM Malaysia time** cron reset was disabled on **6 November 2026** after it deleted customer records. Do not re-enable it. Queue history and customer records must be retained; `supabase/nightly-reset.sql` now disables the legacy job and makes its function a no-op.
- After a database rebuild or restore, verify the legacy cron job remains disabled before reopening the queue.

### Permanent customer records
- Customer names, phone numbers, assigned workers, queue positions, status and service timestamps are recorded in a private database journal whenever a record is created, changed or deleted.
- The Google recorder copies saved changes every minute. **Queue Records** and **Appointments** retain each entry; **Activity History** retains every recorded change; **Business Records** keeps staff/service settings, daily totals and owner activity. Completed and cancelled entries remain available.
- **Sync Status** and the owner dashboard show the last confirmed copy, pending changes and failures. If copying fails, the changes remain in the private database journal for retry. Have the administrator check an overdue or failed copy promptly.
- The Google recorder needs its one-time Google authorization and an enabled time-driven trigger. It runs in Google and does not require the counter tablet or this computer to stay open.
- Keep the workbook private. Store its backup-only connection key in Apps Script properties, never in a Sheet cell or the public website. Customer cancellation tokens and staff authentication secrets are not exported.
- The recording system preserves surviving records and new activity. It does not recreate the individual records deleted on 6 November 2026.

---

## 3. Owner view

The private owner URL provides:
- Today's joined and served totals.
- Each worker's live queue.
- Current customer being served.
- Estimated waits.
- Automatic refreshes.

Never publish the production owner URL because the query-string secret authorizes access to customer details.

---

## 4. Fairness & anti-abuse

- **Permanent QR** — the same code can stay on the tablet or be printed from `shop-qr.png`.
- **Location check** — customers must be physically near Bossman to join.
- **Phone/device safeguards** — reduce duplicate queue joins.

---

## 5. Common admin tasks

Database administration is performed in the Bossman Supabase project.

### Change owner secret
```sql
update app_config set value = '<NEW_RANDOM_SECRET>' where key = 'owner_pin';
```

### Change a worker secret
Update the relevant `barbers.pin` value. Use a long random secret rather than a short 4-digit PIN for production.

### Add a new worker
```sql
insert into barbers (id, name, pin, is_active, avg_minutes, role, sort)
values ('barber4', 'New Name', '<LONG_RANDOM_SECRET>', true, 35, 'barber', 5);
```

Use `role = 'therapist'` for a therapist.

The shop QR no longer needs a kiosk secret or token refresh. The QR join page still checks location and the database enforces joining hours and barber availability.

---

## 6. Where things live

- **Code:** GitHub — `FixITSukil/bossman-queue`
- **Database:** Supabase — Bossman project
- **Hosting:** GitHub Pages

Changes committed to the configured GitHub Pages branch are published automatically.

---

## 7. iPad counter setup

For reliable kiosk use:
- Add the QR display page to the iPad Home Screen.
- Keep the iPad connected to power during business hours.
- Set **Settings → Display & Brightness → Auto-Lock → Never**.
- Use **Guided Access** to lock the iPad into the Bossman display when required.
- Keep the iPad on the shop Wi-Fi.

The QR page also requests a browser screen wake lock when supported, with iPad Auto-Lock settings as the fallback.

---

## 8. Troubleshooting

| Problem | Fix |
|---------|-----|
| QR image blank | Check the tablet's connection and refresh the display. The printable image is also at `shop-qr.png`. |
| Customer is physically inside but location is rejected | Allow location access in the browser and retry. |
| Worker dashboard says invalid PIN/secret | Use that worker's current private dashboard URL. |
| Owner dashboard fails | Confirm the private owner URL contains the current owner secret. |

### Recovering customers after a missing-queue incident

If customer records were deleted, **Find My Queue cannot recreate them**. Ask the waiting customers and staff to confirm the original order before adding anyone again. Each worker can use **+ Quick Service** on their private dashboard, enter the customer's actual name and phone number and the expected service duration, then choose **End of queue**. Add customers in the confirmed order. This creates replacement queue records; it does not restore the deleted records or prove their original positions. Customers can then use **Find My Queue** with the same phone number to reopen their replacement entry. No name is needed for recovery. If the number is shared by several customers, select the matching customer and barber from the choices.

---

*Production secrets intentionally omitted from this public repository.*
