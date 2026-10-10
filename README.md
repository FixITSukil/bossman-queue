# Bossman Queue

Give customers this public link: **https://fixitsukil.github.io/bossman-queue/book.html**.

The page shows each active barber's live queue and estimated wait. Customers choose a barber, enter their name and phone, and join the live queue from anywhere. They do not choose a service or appointment time. Online joining is open from 11:00 AM through 10:45 PM Malaysia time; the database enforces these hours. After joining, customers see their place and wait on `index.html`, which refreshes automatically.

The in-shop QR is permanent: `qr-display.html` shows the fixed `shop-qr.png`, which links to `index.html` and can also be printed. The in-shop page asks customers to share their location. QR joining runs from 11:00 AM through 10:45 PM Malaysia time. Outside that window, the page shows a closed message instead of barber choices, and the database rejects any attempted join. Customers already in the queue can still view their place. Both paths enter the same live queue. Staff see remote customers in their existing barber and owner dashboards. The service catalog remains available to the owner for staff reference, and previous appointments remain visible to staff.

## Deployment

Apply the SQL migrations in `supabase/migrations/` in timestamp order before publishing the corresponding pages. The static QR join function is in `20261010102842_static_shop_qr.sql`. Publish the site to GitHub Pages, then test both the QR and public links. No owner or barber secret belongs in a public URL.

Estimated waits use each barber's average minutes and the remaining time of any customer currently being served. They are estimates; actual service length and queue changes can affect them.

Each barber can use the availability control on their private `barber.html?pin=...` dashboard to stop or resume taking new customers. Pausing removes them from the public booking and in-shop QR choices; it does not remove customers already waiting or being served. The customer pages refresh barber availability every 10 seconds. The owner dashboard continues to show inactive barbers and their queues.

Barbers can cancel a waiting or called customer separately from marking a no-show. The customer's queue page then shows an apology and links to WhatsApp or call Bossman at 011-1165 1608. The page checks for status changes every 10 seconds while open and shows the cancellation again if the customer returns to that queue page on the same device.

The barber's Cancel action asks for explicit No/Yes confirmation before changing the queue. A customer can cancel their own place from the queue status page, including after being called. New queue entries receive a private cancellation token saved on that customer's phone; the public queue ID alone cannot cancel an entry. Entries created before this change need staff help to cancel because their phones never received a token. Both QR and remote joins enforce one active barber place per phone and a 30-minute repeat-join limit on the server, with Malaysian 0 and 60 prefixes treated as the same number. The QR path permits one facial therapist place alongside an active barber place. A completed cut releases the repeat-join limit immediately. The booking page also hides its join form while a saved active entry exists on the device.

The customer pages are installable as a home screen web app. Android Chrome offers an install option; iPhone customers use Safari's Share menu and Add to Home Screen. The live queue still needs an internet connection. The app manifest, service worker, and icons are in the repository root.
