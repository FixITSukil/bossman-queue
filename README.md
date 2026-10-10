# Bossman Queue

The in-shop QR still opens `index.html` and requires a rotating token and shop location. Remote appointments use the public `book.html` page, with no private owner, barber, or kiosk key in its URL.

## Remote booking setup

1. Apply `supabase/migrations/20261010083618_remote_bookings.sql` and then `supabase/migrations/20261010084559_serialize_queue_positions.sql` to the Bossman Supabase project (`ksgkzeiaxwzgufilqbso`). The SQL creates the service catalog, appointments, availability and staff RPCs and coordinates queue positions between QR walk-ins and appointment check-ins. Apply both **before** publishing the updated pages.
2. Publish the updated site to GitHub Pages.
3. Open the existing private owner dashboard and add services with a name and average duration, or upload a CSV with one `Name, minutes` row per service. Customers cannot book until at least one active service is added.
4. Give customers this public link: `https://fixitsukil.github.io/bossman-queue/book.html`.

Customers select an active barber, service, date and 15-minute start time. Times are in `Asia/Kuala_Lumpur`; the first start is 11:00 AM and the last is 10:45 PM. Booking is available for today and the next 14 days. The database checks the service duration and rejects overlaps even when two customers submit at once. A customer can cancel their booking from the same browser; the cancellation token is kept only in browser storage.

Barbers see appointments on their existing private dashboard and check arrivals into the live queue. The owner can see all appointments and edit service times. The 11 PM queue reset leaves future appointments in place. Existing bookings retain the service name and duration recorded when the customer booked.
