# Bossman Queue System — Handover

A simple QR-based queue system for Bossman Gentleman's Club Barbershop.
Customers scan a QR at the counter, pick a worker, and join the queue. Workers
manage their line from their phone. The owner sees everything at a glance.

Everything runs on hosted web services; there is nothing to install on customer devices.

---

## 1. The links

| Who | Link | Notes |
|-----|------|-------|
| **Tablet at counter** | `https://fixitsukil.github.io/bossman-queue/qr-display.html` | Shows the rotating QR. Keep this open fullscreen on the tablet during business hours. |
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
- The queue is designed to snapshot the day's totals and reset automatically at **11 PM Malaysia time** via Supabase Cron.
- The scheduled job should be verified in the live Supabase project after any database rebuild or project restore.

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

- **Rotating QR** — changes every 2 minutes.
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

### Temporarily disable QR-token enforcement for testing
```sql
update app_config set value = 'false' where key = 'require_token';
```

Turn it back on immediately after testing:
```sql
update app_config set value = 'true' where key = 'require_token';
```

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
| QR blank / can't reach server | Check shop Wi-Fi, then refresh the display. Check that the Supabase project is active. |
| Customer is physically inside but location is rejected | Allow location access in the browser and retry. |
| QR expired | Scan the current live QR again. |
| Worker dashboard says invalid PIN/secret | Use that worker's current private dashboard URL. |
| Owner dashboard fails | Confirm the private owner URL contains the current owner secret. |

---

*Production secrets intentionally omitted from this public repository.*
