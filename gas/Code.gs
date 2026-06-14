// ─── CONFIG ────────────────────────────────────────────────────────────────
var SHEET_ID = "1rsHKVSYnjGohxMOjfAQ0Pf1hpj-bKmZ46-g0p7c8mj4";
var CALLMEBOT_API_KEY = ""; // optional: fill in for WhatsApp notifications
var NOTIFY_WHEN_POSITION = 2;
// ───────────────────────────────────────────────────────────────────────────

function getSpreadsheet() { return SpreadsheetApp.openById(SHEET_ID); }
function getBarbersSheet() { return getSpreadsheet().getSheetByName("Barbers"); }
function getQueueSheet()   { return getSpreadsheet().getSheetByName("Queue"); }

// ─── ROUTING ───────────────────────────────────────────────────────────────
function doGet(e) {
  var action = e.parameter.action || "";
  var result;

  if (action === "getBarbers")     result = getBarbers();
  else if (action === "getQueue")  result = getQueue(e.parameter.barberId);
  else if (action === "joinQueue") result = joinQueue(e.parameter);
  else if (action === "callNext")  result = callNext(e.parameter.barberId, e.parameter.barberName, e.parameter.durationMinutes);
  else if (action === "updateStatus") result = updateStatus(e.parameter);
  else if (action === "toggleActive") result = toggleActive(e.parameter.barberId);
  else if (action === "getBarberByPin") result = getBarberByPin(e.parameter.pin);
  else if (action === "getAllBarbers")  result = getAllBarbers();
  else if (action === "getDailyStats")  result = getDailyStats();
  else if (action === "clearQueue")     result = clearOldQueue();
  else result = { error: "Unknown action" };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── BARBERS ───────────────────────────────────────────────────────────────
function getBarbers() {
  var rows = getBarbersSheet().getDataRange().getValues();
  var barbers = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][3]) {
      barbers.push({ id: rows[i][0], name: rows[i][1], pin: rows[i][2], isActive: rows[i][3], avgMinutes: rows[i][4], role: rows[i][5] || "barber" });
    }
  }
  return barbers;
}

// End-of-day totals: counts today's customers (served + total joined), per worker.
// Note: the nightly clearOldQueue wipes the sheet at ~11 PM, so check before then.
function getDailyStats() {
  var qRows = getQueueSheet().getDataRange().getValues();
  var bRows = getBarbersSheet().getDataRange().getValues();
  var names = {};
  for (var b = 1; b < bRows.length; b++) { names[bRows[b][0]] = bRows[b][1]; }

  var today = new Date().toDateString();
  var totalJoined = 0, totalServed = 0;
  var perWorker = {};

  for (var i = 1; i < qRows.length; i++) {
    var created = qRows[i][8] ? new Date(qRows[i][8]).toDateString() : null;
    if (created !== today) continue;
    var bid = qRows[i][1];
    var status = qRows[i][5];
    if (!perWorker[bid]) perWorker[bid] = { name: names[bid] || bid, served: 0, joined: 0 };
    perWorker[bid].joined++;
    totalJoined++;
    if (status === "done") { perWorker[bid].served++; totalServed++; }
  }

  var list = [];
  for (var k in perWorker) { list.push({ id: k, name: perWorker[k].name, served: perWorker[k].served, joined: perWorker[k].joined }); }
  return { date: today, totalJoined: totalJoined, totalServed: totalServed, perWorker: list };
}

function getAllBarbers() {
  var rows = getBarbersSheet().getDataRange().getValues();
  var barbers = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) {
      barbers.push({ id: rows[i][0], name: rows[i][1], pin: rows[i][2], isActive: rows[i][3], avgMinutes: rows[i][4], role: rows[i][5] || "barber" });
    }
  }
  return barbers;
}

function getBarberByPin(pin) {
  var rows = getBarbersSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === String(pin)) {
      return { id: rows[i][0], name: rows[i][1], pin: rows[i][2], isActive: rows[i][3], avgMinutes: rows[i][4], role: rows[i][5] || "barber" };
    }
  }
  return null;
}

function toggleActive(barberId) {
  var sheet = getBarbersSheet();
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === barberId) {
      var newVal = !rows[i][3];
      sheet.getRange(i + 1, 4).setValue(newVal);
      return { ok: true, isActive: newVal };
    }
  }
  return { error: "Barber not found" };
}

// ─── QUEUE ─────────────────────────────────────────────────────────────────
function getQueue(barberId) {
  var rows = getQueueSheet().getDataRange().getValues();
  var queue = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === barberId && (rows[i][5] === "waiting" || rows[i][5] === "called")) {
      queue.push({
        id: rows[i][0], barberId: rows[i][1], barberName: rows[i][2],
        customerName: rows[i][3], phone: rows[i][4],
        status: rows[i][5], position: rows[i][6],
        notified: rows[i][7], createdAt: rows[i][8],
        durationMinutes: rows[i][9] || 0,
        calledAt: rows[i][10] || ""
      });
    }
  }
  queue.sort(function(a, b) { return a.position - b.position; });
  return queue;
}

function joinQueue(params) {
  var sheet    = getQueueSheet();
  var queue    = getQueue(params.barberId);

  // Anti-abuse: block the same phone from joining the same barber's queue twice
  var phone = String(params.phone).replace(/\D/g, "");
  for (var j = 0; j < queue.length; j++) {
    if (String(queue[j].phone).replace(/\D/g, "") === phone) {
      return { error: "You're already in this barber's queue." };
    }
  }

  var position = queue.length + 1;
  var id       = Utilities.getUuid();
  var now      = new Date().toISOString();
  sheet.appendRow([id, params.barberId, params.barberName, params.customerName, params.phone, "waiting", position, false, now, 0, ""]);
  checkAndNotify(params.barberId, params.barberName);
  return { ok: true, id: id, position: position, ahead: queue.length };
}

function updateStatus(params) {
  var sheet = getQueueSheet();
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === params.id) {
      sheet.getRange(i + 1, 6).setValue(params.status);
      if (params.status === "done" || params.status === "no_show") {
        Utilities.sleep(300);
        checkAndNotify(rows[i][1], params.barberName || rows[i][2]);
      }
      return { ok: true };
    }
  }
  return { error: "Entry not found" };
}

function callNext(barberId, barberName, durationMinutes) {
  var sheet = getQueueSheet();
  var rows  = sheet.getDataRange().getValues();
  var mins  = parseInt(durationMinutes) || 20;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === barberId && rows[i][5] === "waiting") {
      sheet.getRange(i + 1, 6).setValue("called");
      sheet.getRange(i + 1, 10).setValue(mins);
      sheet.getRange(i + 1, 11).setValue(new Date().toISOString()); // called_at
      sendWhatsApp(rows[i][4], rows[i][3], barberName, "now");
      sheet.getRange(i + 1, 8).setValue(true);
      checkAndNotify(barberId, barberName);
      return { ok: true };
    }
  }
  return { error: "No one waiting" };
}

// ─── DAILY AUTO-CLEAR ──────────────────────────────────────────────────────
// Run clearOldQueue() manually or set a daily time-based trigger in Apps Script:
// Apps Script → Triggers → Add trigger → clearOldQueue → Time-driven → Day timer → e.g. 11:00 PM
// Run this ONCE from the Apps Script editor to schedule the nightly reset.
function setupDailyReset() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "clearOldQueue") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("clearOldQueue")
    .timeBased().atHour(23).everyDays(1)
    .inTimezone("Asia/Kuala_Lumpur").create();
  return "Daily reset scheduled for ~11 PM Malaysia time.";
}

function clearOldQueue() {
  var sheet = getQueueSheet();
  var rows  = sheet.getDataRange().getValues();
  var today = new Date().toDateString();
  var toDelete = [];
  for (var i = rows.length - 1; i >= 1; i--) {
    var createdAt = rows[i][8] ? new Date(rows[i][8]).toDateString() : null;
    var status    = rows[i][5];
    // Delete rows that are done/no_show OR are from a previous day
    if (status === "done" || status === "no_show" || (createdAt && createdAt !== today)) {
      toDelete.push(i + 1);
    }
  }
  toDelete.forEach(function(rowNum) { sheet.deleteRow(rowNum); });
  return { ok: true, deleted: toDelete.length };
}

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────
function checkAndNotify(barberId, barberName) {
  if (!CALLMEBOT_API_KEY) return;
  var sheet   = getQueueSheet();
  var rows    = sheet.getDataRange().getValues();
  var waiting = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === barberId && rows[i][5] === "waiting") {
      waiting.push({ row: i + 1, phone: rows[i][4], name: rows[i][3], notified: rows[i][7] });
    }
  }
  waiting.sort(function(a, b) { return a.row - b.row; });
  var idx = NOTIFY_WHEN_POSITION - 1;
  if (waiting[idx] && !waiting[idx].notified) {
    sendWhatsApp(waiting[idx].phone, waiting[idx].name, barberName, "soon");
    sheet.getRange(waiting[idx].row, 8).setValue(true);
  }
}

function sendWhatsApp(phone, customerName, barberName, timing) {
  if (!CALLMEBOT_API_KEY) return;
  var msg = timing === "now"
    ? "Hi " + customerName + "! It's your turn at Bossman Gentleman's Club Barbershop with " + barberName + ". Please come to the chair now! ✂️"
    : "Hi " + customerName + "! You're almost up at Bossman Gentleman's Club Barbershop with " + barberName + ". Get ready! ✂️";
  var url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(phone) + "&text=" + encodeURIComponent(msg) + "&apikey=" + CALLMEBOT_API_KEY;
  try { UrlFetchApp.fetch(url); } catch(e) { Logger.log("WhatsApp error: " + e); }
}
