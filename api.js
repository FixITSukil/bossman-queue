// Bossman Queue — Supabase API layer (hardened).
// Public key can only read non-sensitive views and write through validated RPCs.

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

function mapBarber(r) {
  return { id: r.id, name: r.name, isActive: r.is_active, avgMinutes: r.avg_minutes, role: r.role };
}
function mapPublicEntry(r) {
  return {
    id: r.id, barberId: r.barber_id, status: r.status, position: r.position,
    durationMinutes: r.duration_minutes, calledAt: r.called_at, createdAt: r.created_at
  };
}

var DB = {
  // Public reads (no PINs, no phone numbers, no names)
  getBarbers: function() {
    return sbSelect("barbers_public?is_active=eq.true&order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getAllBarbers: function() {
    return sbSelect("barbers_public?order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getQueue: function(barberId) {
    return sbSelect("queue_public?barber_id=eq." + encodeURIComponent(barberId) + "&status=in.(waiting,called)&order=position.asc")
      .then(function(a) { return (a || []).map(mapPublicEntry); });
  },
  // Joins / customer self-cancel
  joinQueue: function(p) {
    return sbRpc("join_queue", {
      p_barber_id: p.barberId, p_barber_name: p.barberName,
      p_customer_name: p.customerName, p_phone: p.phone, p_token: p.t || ""
    });
  },
  leaveQueue: function(id) { return sbRpc("leave_queue", { p_entry_id: id }); },
  // Barber dashboard (PIN-gated, returns full detail incl. phone)
  getBarberByPin: function(pin) { return sbRpc("get_barber_by_pin", { p_pin: pin }); },
  getBarberQueue: function(pin) { return sbRpc("get_queue_for_barber", { p_pin: pin }); },
  callNext: function(pin, mins) { return sbRpc("call_next", { p_pin: pin, p_duration: parseInt(mins) || 35 }); },
  setStatus: function(pin, id, status) { return sbRpc("set_status", { p_pin: pin, p_entry_id: id, p_status: status }); },
  toggleActive: function(pin) { return sbRpc("toggle_active", { p_pin: pin }); },
  // Owner (PIN-gated)
  getOwnerView: function(pin) { return sbRpc("get_owner_view", { p_owner_pin: pin }); },
  // Misc
  getToken: function() { return sbRpc("get_qr_token", {}); },
  getDailyStats: function() { return sbRpc("get_daily_stats", {}); }
};

// Compatibility shim used by the pages
function call(params) {
  switch (params.action) {
    case "getBarbers":     return DB.getBarbers();
    case "getAllBarbers":  return DB.getAllBarbers();
    case "getQueue":       return DB.getQueue(params.barberId);
    case "joinQueue":      return DB.joinQueue(params);
    case "leaveQueue":     return DB.leaveQueue(params.id);
    case "getBarberByPin": return DB.getBarberByPin(params.pin);
    case "getBarberQueue": return DB.getBarberQueue(params.pin);
    case "callNext":       return DB.callNext(params.pin, params.durationMinutes);
    case "setStatus":      return DB.setStatus(params.pin, params.id, params.status);
    case "toggleActive":   return DB.toggleActive(params.pin);
    case "getOwnerView":   return DB.getOwnerView(params.pin);
    case "getToken":       return DB.getToken();
    case "getDailyStats":  return DB.getDailyStats();
    default:               return Promise.resolve({ error: "Unknown action" });
  }
}
