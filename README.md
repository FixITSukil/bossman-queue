# Bossman Queue

Give customers this public link: **https://fixitsukil.github.io/bossman-queue/book.html**.

The page shows each active barber's live queue and estimated wait. Customers choose a barber, enter their name and phone, and join the live queue from anywhere. They do not choose a service or appointment time. Online joining is open from 11:00 AM through 10:45 PM Malaysia time; the database enforces these hours. After joining, customers see their place and wait on `index.html`, which refreshes automatically.

The in-shop QR still opens `index.html` and requires a rotating token and shop location. Both paths enter the same live queue. Staff see remote customers in their existing barber and owner dashboards. The service catalog remains available to the owner for staff reference, and previous appointments remain visible to staff.

## Deployment

Apply the SQL migrations in `supabase/migrations/` in timestamp order before publishing the corresponding pages. The remote join function is in `20261010090112_remote_queue_join.sql`. Publish the site to GitHub Pages, then test the public link. No owner, barber, or kiosk secret belongs in the public URL.

Estimated waits use each barber's average minutes and the remaining time of any customer currently being served. They are estimates; actual service length and queue changes can affect them.

Barbers can cancel a waiting or called customer separately from marking a no-show. The customer's queue page then shows an apology and links to WhatsApp or call Bossman at 011-1165 1608. The page checks for status changes every 10 seconds while open and shows the cancellation again if the customer returns to that queue page on the same device.
