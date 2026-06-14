# Builds a one-page branded quick-reference PDF for Bossman.
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import os

FOREST   = (10/255, 31/255, 20/255)
CREAM    = (233/255, 221/255, 193/255)
CREAMDIM = (168/255, 159/255, 134/255)
GOLD     = (201/255, 167/255, 106/255)
LINE     = (60/255, 80/255, 62/255)

W, H = A4
c = canvas.Canvas("Bossman-Quick-Guide.pdf", pagesize=A4)

# Background + gold border frame
c.setFillColorRGB(*FOREST); c.rect(0, 0, W, H, fill=1, stroke=0)
c.setStrokeColorRGB(*GOLD); c.setLineWidth(1.5)
c.rect(22, 22, W-44, H-44, fill=0, stroke=1)

M = 52                      # content left margin
VAL = M + 165               # value column for rows
y = H - 78                  # generous top margin

# Logo
if os.path.exists("logo.png"):
    try:
        size = 76
        c.drawImage(ImageReader("logo.png"), (W-size)/2, y-size, size, size, mask='auto')
        y -= size + 20
    except Exception:
        pass

c.setFont("Helvetica-Bold", 23); c.setFillColorRGB(*CREAM)
c.drawCentredString(W/2, y, "BOSSMAN"); y -= 20
c.setFillColorRGB(*GOLD); c.setFont("Helvetica", 8.5)
c.drawCentredString(W/2, y, "G E N T L E M A N ' S   C L U B   —   Q U E U E   Q U I C K   G U I D E")
y -= 40

def section(title, gap_before=14):
    global y
    y -= gap_before
    c.setFillColorRGB(*GOLD); c.setFont("Helvetica-Bold", 11.5)
    c.drawString(M, y, title)
    c.setStrokeColorRGB(*LINE); c.setLineWidth(0.6); c.line(M, y-7, W-M, y-7)
    y -= 24

def row(label, value):
    global y
    c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9.5)
    c.drawString(M+6, y, label)
    c.setFillColorRGB(*CREAMDIM); c.setFont("Helvetica", 8.6)
    c.drawString(VAL, y, value); y -= 17

def subhead(txt):
    global y
    y -= 4
    c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9.5)
    c.drawString(M+6, y, txt); y -= 16

def bullet(txt):
    global y
    c.setFillColorRGB(*CREAM); c.setFont("Helvetica", 9)
    c.drawString(M+14, y, txt); y -= 15

# --- Links ---
section("Links   (bookmark on phone: open in browser → Add to Home Screen)", gap_before=0)
row("Tablet (counter)", "fixitsukil.github.io/bossman-queue/qr-display.html")
row("Owner (you)", "...github.io/bossman-queue/owner.html?pin=8888")
row("Assaf", "...github.io/bossman-queue/barber.html?pin=1111")
row("Karam", "...github.io/bossman-queue/barber.html?pin=2222")
row("Jalal", "...github.io/bossman-queue/barber.html?pin=3333")
row("Jassy (facial)", "...github.io/bossman-queue/barber.html?pin=4444")
row("Website / menu", "...github.io/bossman-queue/website.html")

# --- Daily use ---
section("Daily use")
subhead("OPEN")
bullet("•  Open the Tablet link fullscreen at the counter (rotating QR shows).")
bullet("•  Each worker opens their own dashboard link on their phone.")
subhead("SERVE")
bullet("•  Customer scans QR → picks worker → enters name + WhatsApp → joins.")
bullet("•  Worker taps Call Next, sets minutes, taps Call & Start.")
bullet("•  Use the call / WhatsApp buttons if the customer isn't around.")
bullet("•  Tap the green tick when done, the red cross for a no-show.")
subhead("CLOSE")
bullet("•  Nothing to do. Queue auto-resets at 11 PM; daily totals are saved.")

# --- Fairness ---
section("Built-in fairness (always on)")
bullet("•  QR changes every 30 min — screenshots can't be reused later.")
bullet("•  Customers must be at the shop to join (location check).")
bullet("•  One join per phone, and one per device every 30 minutes.")

# --- Troubleshooting ---
section("If something's off")
row("Tablet QR blank", "Check Wi-Fi, refresh the page.")
row("'QR has expired'", "Old screenshot — scan the live tablet QR again.")
row("'You must be at Bossman'", "Allow location in the browser.")
row("Owner page empty", "Make sure link ends with ?pin=8888")
row("Worker page empty", "Use the correct link with their PIN.")

# Footer
c.setFillColorRGB(*CREAMDIM); c.setFont("Helvetica-Oblique", 7.5)
c.drawCentredString(W/2, 40, "Full details in HANDOVER.md   •   github.com/FixITSukil/bossman-queue   •   Estd 2024")

c.save()
print("saved Bossman-Quick-Guide.pdf")
