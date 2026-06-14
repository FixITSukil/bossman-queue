# Bossman Queue System — Handover

A simple QR-based queue system for Bossman Gentleman's Club Barbershop.
Customers scan a QR at the counter, pick a worker, and join the queue. Workers
manage their line from their phone. The owner sees everything at a glance.

Everything runs on free services. There is nothing to install and nothing to pay.

---

## 1. The links

| Who | Link | Notes |
|-----|------|-------|
| **Tablet at counter** | `https://fixitsukil.github.io/bossman-queue/qr-display.html` | Shows the rotating QR. Keep this open fullscreen on the tablet, all day. |
| **Customer** | `https://fixitsukil.github.io/bossman-queue/` | What opens when a customer scans the QR. (No need to share directly.) |
| **Owner (you)** | `https://fixitsukil.github.io/bossman-queue/owner.html?pin=8888` | Live view of all queues + today's totals. |
| **Website / menu** | `https://fixitsukil.github.io/bossman-queue/website.html` | Premium price-list page you can share on social media. |
| **Assaf** | `https://fixitsukil.github.io/bossman-queue/barber.html?pin=1111` | His dashboard. |
| **Karam** | `https://fixitsukil.github.io/bossman-queue/barber.html?pin=2222` | His dashboard. |
| **Jalal** | `https://fixitsukil.github.io/bossman-queue/barber.html?pin=3333` | His dashboard. |
| **Jassy** | `https://fixitsukil.github.io/bossman-queue/barber.html?pin=4444` | Facial therapist dashboard. |

> Each worker should **bookmark their own link** on their phone (open in Chrome/Safari, then Add to Home Screen).

---

## 2. Daily use

**Opening:**
1. Turn on the counter tablet, open the **Tablet** link fullscreen. The rotating QR appears.
2. Each worker opens their own dashboard link on their phone.

**A customer arrives:**
1. They scan the QR on the tablet.
2. They pick their barber (or Jassy for a facial). For a haircut + facial, they tick "My service includes a facial" — that adds them to Jassy's list at the same time.
3. They enter name + WhatsApp number and tap Join. They see their position and rough wait.

**A worker serving customers:**
- Their dashboard shows who's waiting. Tap **Call Next**, set how many minutes the service will take, tap **Call & Start**.
- The customer in the chair shows at the top. Use 📞 / 💬 to call/WhatsApp them if they've wandered off.
- Tap ✅ when done, or ❌ for a no-show.

**Closing:**
- Nothing to do. At **11 PM** the queue automatically resets to zero and the day's totals are saved.

---

## 3. Owner view

Open your link (`owner.html?pin=8888`). You'll see:
- **Today's Total** — customers served + total joined, per worker.
- Each worker's live queue, who's being served, and estimated waits.
- Auto-refreshes every 30 seconds.

---

## 4. Fairness & anti-abuse (already on)

- **Rotating QR** — the code changes every 30 minutes, so a screenshot can't be reused later.
- **Location check** — customers must be physically at the shop to join (blocks pre-registering from home).
- **One join per phone**, and **one join per device every 30 minutes**.

---

## 5. Common admin tasks

> These need the **Supabase** account (the database). Log in at supabase.com with the
> Google account used to create it → open the **Bossman** project → **SQL Editor** →
> **New query**, paste the command, and click **Run**.

**Change a PIN** (example: the owner PIN):
```sql
update app_config set value = 'NEWPIN' where key = 'owner_pin';
```
Change a worker's PIN by editing the `barbers` table (Table Editor → barbers → edit the `pin` cell).

**Add a new barber:**
```sql
insert into barbers (id, name, pin, is_active, avg_minutes, role, sort)
values ('barber4', 'New Name', '5555', true, 35, 'barber', 5);
```
(Use `role` = `therapist` for a facial therapist.)

**Temporarily turn the QR-code requirement off** (e.g. for testing):
```sql
update app_config set value = 'false' where key = 'require_token';  -- 'true' to turn back on
```

**See saved daily history:** Table Editor → `daily_totals`.

---

## 6. Who to call / where things live

- **Code:** GitHub — `github.com/FixITSukil/bossman-queue` (the website files).
- **Database:** Supabase — the project that stores barbers, the queue, and daily totals.
- **Hosting:** GitHub Pages (free) serves the website automatically.

Changes to how the system *works* are made in the code (GitHub) by whoever maintains it —
no "redeploy" or server steps are needed; updates go live automatically.

---

## 7. Troubleshooting

| Problem | Fix |
|---------|-----|
| Tablet QR blank / "Can't reach server" | Check the tablet's Wi-Fi. Refresh the page. |
| Customer says "You must be at Bossman" but they're inside | Ask them to allow location in their browser. If it still blocks people inside, the shop location may need fine-tuning — note it down. |
| Customer says "QR has expired" | They scanned an old screenshot. Ask them to scan the live tablet QR again. |
| A worker's dashboard is empty / "Invalid PIN" | Check they're using the correct link with their PIN. |
| Owner page won't load | Make sure the link ends with `?pin=8888` (your owner PIN). |

---

*Prepared as a handover for Rajdave. Keep this document somewhere safe.*
