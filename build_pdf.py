# Builds a one-page branded quick-reference PDF for Bossman.
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import os

FOREST   = (10/255, 31/255, 20/255)
MOSS     = (20/255, 52/255, 33/255)
CREAM    = (233/255, 221/255, 193/255)
CREAMDIM = (168/255, 159/255, 134/255)
GOLD     = (201/255, 167/255, 106/255)
LINE     = (60/255, 80/255, 62/255)

W, H = A4
c = canvas.Canvas("Bossman-Quick-Guide.pdf", pagesize=A4)

# Background
c.setFillColorRGB(*FOREST); c.rect(0, 0, W, H, fill=1, stroke=0)
# Gold border frame
c.setStrokeColorRGB(*GOLD); c.setLineWidth(1.5)
c.rect(18, 18, W-36, H-36, fill=0, stroke=1)

M = 42                      # content left margin
y = H - 52

# Logo
if os.path.exists("logo.png"):
    try:
        img = ImageReader("logo.png")
        size = 70
        c.drawImage(img, (W-size)/2, y-size+8, size, size, mask='auto')
        y -= size + 6
    except Exception:
        pass

def center(txt, font, sz, color, dy):
    global y
    c.setFont(font, sz); c.setFillColorRGB(*color)
    c.drawCentredString(W/2, y, txt); y -= dy

center("BOSSMAN", "Helvetica-Bold", 22, CREAM, 18)
c.setFillColorRGB(*GOLD); c.setFont("Helvetica", 8.5)
c.drawCentredString(W/2, y, "G E N T L E M A N ' S   C L U B   —   Q U E U E   Q U I C K   G U I D E"); y -= 22

def section(title):
    global y
    c.setFillColorRGB(*GOLD); c.setFont("Helvetica-Bold", 11)
    c.drawString(M, y, title)
    c.setStrokeColorRGB(*LINE); c.setLineWidth(0.6); c.line(M, y-5, W-M, y-5)
    y -= 20

def row(label, value, lw=150):
    global y
    c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9)
    c.drawString(M+4, y, label)
    c.setFillColorRGB(*CREAMDIM); c.setFont("Helvetica", 8.3)
    c.drawString(M+lw, y, value); y -= 14

def bullet(txt, color=CREAM, sz=8.6, dy=13, indent=8, font="Helvetica"):
    global y
    c.setFillColorRGB(*color); c.setFont(font, sz)
    c.drawString(M+indent, y, txt); y -= dy

# --- Links ---
section("Links  (bookmark on phone: open in browser > Add to Home Screen)")
row("Tablet (counter)", "fixitsukil.github.io/bossman-queue/qr-display.html")
row("Owner (you)", "...github.io/bossman-queue/owner.html?pin=8888")
row("Assaf", "...github.io/bossman-queue/barber.html?pin=1111")
row("Karam", "...github.io/bossman-queue/barber.html?pin=2222")
row("Jalal", "...github.io/bossman-queue/barber.html?pin=3333")
row("Jassy (facial)", "...github.io/bossman-queue/barber.html?pin=4444")
row("Website / menu", "...github.io/bossman-queue/website.html")
y -= 6

# --- Daily use ---
section("Daily use")
c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9.2); c.drawString(M+4, y, "OPEN"); y -= 13
bullet("- Open the Tablet link fullscreen at the counter (rotating QR shows).")
bullet("- Each worker opens their own dashboard link on their phone.")
y -= 4
c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9.2); c.drawString(M+4, y, "SERVE"); y -= 13
bullet("- Customer scans QR > picks worker > enters name + WhatsApp > joins.")
bullet("- Worker taps Call Next, sets minutes, taps Call & Start.")
bullet("- Use the call / WhatsApp buttons if the customer isn't around.")
bullet("- Tap the green tick when done, the red cross for a no-show.")
y -= 4
c.setFillColorRGB(*CREAM); c.setFont("Helvetica-Bold", 9.2); c.drawString(M+4, y, "CLOSE"); y -= 13
bullet("- Nothing to do. Queue auto-resets at 11 PM; daily totals are saved.")
y -= 6

# --- Fairness ---
section("Built-in fairness (always on)")
bullet("- QR changes every 30 min  -  screenshots can't be reused later.")
bullet("- Customers must be at the shop to join (location check).")
bullet("- One join per phone, and one per device every 30 minutes.")
y -= 6

# --- Troubleshooting ---
section("If something's off")
row("Tablet QR blank", "Check Wi-Fi, refresh the page.", 150)
row("'QR has expired'", "Old screenshot - scan the live tablet QR again.", 150)
row("'You must be at Bossman'", "Allow location in the browser.", 150)
row("Owner page empty", "Make sure link ends with ?pin=8888", 150)
row("Worker page empty", "Use the correct link with their PIN.", 150)

# Footer
c.setFillColorRGB(*CREAMDIM); c.setFont("Helvetica-Oblique", 7.5)
c.drawCentredString(W/2, 32, "Full details in HANDOVER.md  -  github.com/FixITSukil/bossman-queue  -  Estd 2024")

c.save()
print("saved Bossman-Quick-Guide.pdf")
