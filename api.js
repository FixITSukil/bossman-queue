// Bossman Queue — Supabase API layer.
// Exposes a global call({action, ...}) that returns the same shapes the app
// already expects, so the page code didn't need to change.

var SUPABASE_URL = "https://ksgkzeiaxwzgufilqbso.supabase.co";
var SUPABASE_KEY = "sb_publishable_7QvZN9zPxjI6gG9BdoTj4A_hz6mt6IJ";

var SB_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": "Bearer " + SUPABASE_KEY,
  "Content-Type": "application/json"
};

function sbSelect(path) {
  return fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: SB_HEADERS }).then(function(r) { return r.json(); });
}
function sbRpc(fn, body) {
  return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST", headers: SB_HEADERS, body: JSON.stringify(body || {})
  }).then(function(r) { return r.json(); });
}
function sbPatch(path, body) {
  return fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: "PATCH",
    headers: Object.assign({ "Prefer": "return=minimal" }, SB_HEADERS),
    body: JSON.stringify(body)
  }).then(function() { return { ok: true }; });
}

function mapBarber(r) {
  return { id: r.id, name: r.name, pin: String(r.pin), isActive: r.is_active, avgMinutes: r.avg_minutes, role: r.role };
}
function mapEntry(r) {
  return {
    id: r.id, barberId: r.barber_id, barberName: r.barber_name,
    customerName: r.customer_name, phone: r.phone, status: r.status,
    position: r.position, durationMinutes: r.duration_minutes,
    calledAt: r.called_at, createdAt: r.created_at
  };
}

var DB = {
  getBarbers: function() {
    return sbSelect("barbers?is_active=eq.true&order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getAllBarbers: function() {
    return sbSelect("barbers?order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getBarberByPin: function(pin) {
    return sbSelect("barbers?pin=eq." + encodeURIComponent(pin)).then(function(a) { return (a && a[0]) ? mapBarber(a[0]) : null; });
  },
  getQueue: function(barberId) {
    return sbSelect("queue_entries?barber_id=eq." + encodeURIComponent(barberId) + "&status=in.(waiting,called)&order=position.asc")
      .then(function(a) { return (a || []).map(mapEntry); });
  },
  joinQueue: function(p) {
    return sbRpc("join_queue", {
      p_barber_id: p.barberId, p_barber_name: p.barberName,
      p_customer_name: p.customerName, p_phone: p.phone, p_token: p.t || ""
    });
  },
  updateStatus: function(id, status) {
    return sbPatch("queue_entries?id=eq." + id, { status: status });
  },
  callNext: function(barberId, barberName, mins) {
    return DB.getQueue(barberId).then(function(q) {
      var next = (q || []).filter(function(e) { return e.status === "waiting"; })
                          .sort(function(a, b) { return a.position - b.position; })[0];
      if (!next) return { error: "No one waiting" };
      return sbPatch("queue_entries?id=eq." + next.id, {
        status: "called", called_at: new Date().toISOString(), duration_minutes: parseInt(mins) || 35
      });
    });
  },
  toggleActive: function(barberId) {
    return sbSelect("barbers?id=eq." + encodeURIComponent(barberId) + "&select=is_active").then(function(a) {
      var cur = (a && a[0]) ? a[0].is_active : true;
      var nv = !cur;
      return sbPatch("barbers?id=eq." + encodeURIComponent(barberId), { is_active: nv }).then(function() { return { ok: true, isActive: nv }; });
    });
  },
  getToken: function() { return sbRpc("get_qr_token", {}); },
  getDailyStats: function() { return sbRpc("get_daily_stats", {}); }
};

// Compatibility shim: the pages call(action, ...) just like before.
function call(params) {
  switch (params.action) {
    case "getBarbers":     return DB.getBarbers();
    case "getAllBarbers":  return DB.getAllBarbers();
    case "getBarberByPin": return DB.getBarberByPin(params.pin);
    case "getQueue":       return DB.getQueue(params.barberId);
    case "joinQueue":      return DB.joinQueue(params);
    case "updateStatus":   return DB.updateStatus(params.id, params.status);
    case "callNext":       return DB.callNext(params.barberId, params.barberName, params.durationMinutes);
    case "toggleActive":   return DB.toggleActive(params.barberId);
    case "getToken":       return DB.getToken();
    case "getDailyStats":  return DB.getDailyStats();
    default:               return Promise.resolve({ error: "Unknown action" });
  }
}
