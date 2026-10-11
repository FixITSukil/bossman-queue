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
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) throw new Error(data.message || data.error || "Server request failed.");
      return data;
    });
  });
}

function mapBarber(r) {
  return { id: r.id, name: r.name, isActive: r.is_active, isAvailable: r.is_available,
    offToday: r.off_today, avgMinutes: r.avg_minutes, role: r.role };
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
    return sbSelect("barbers_public?order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getAllBarbers: function() {
    return sbSelect("barbers_public?order=sort.asc,name.asc").then(function(a) { return (a || []).map(mapBarber); });
  },
  getQueue: function(barberId) {
    return sbSelect("queue_public?barber_id=eq." + encodeURIComponent(barberId) + "&status=in.(waiting,called)&order=position.asc")
      .then(function(a) { return (a || []).map(mapPublicEntry); });
  },
  getEntry: function(entryId) {
    return sbSelect("queue_public?id=eq." + encodeURIComponent(entryId) + "&limit=1")
      .then(function(a) { return (a && a[0]) ? mapPublicEntry(a[0]) : null; });
  },
  // Joins / customer self-cancel
  joinQueue: function(p) {
    return sbRpc("join_queue", {
      p_barber_id: p.barberId, p_barber_name: p.barberName,
      p_customer_name: p.customerName, p_phone: p.phone, p_token: ""
    });
  },
  leaveQueue: function(id, token) { return sbRpc("leave_queue", { p_entry_id: id, p_cancel_token: token }); },
  // Barber dashboard (secret-link gated, returns full detail incl. phone)
  getBarberByPin: function(pin) { return sbRpc("get_barber_by_pin", { p_pin: pin }); },
  getBarberQueue: function(pin) { return sbRpc("get_queue_for_barber", { p_pin: pin }); },
  callNext: function(pin, mins) { return sbRpc("call_next", { p_pin: pin, p_duration: parseInt(mins) || 35 }); },
  setStatus: function(pin, id, status) { return sbRpc("set_status", { p_pin: pin, p_entry_id: id, p_status: status }); },
  cancelQueueEntry: function(pin, id) { return sbRpc("cancel_queue_entry", { p_pin: pin, p_entry_id: id }); },
  toggleActive: function(pin) { return sbRpc("toggle_active", { p_pin: pin }); },
  // Owner (secret-link gated)
  getOwnerView: function(pin) { return sbRpc("get_owner_view", { p_owner_pin: pin }); },
  // Misc
  getDailyStats: function() { return sbRpc("get_daily_stats", {}); }
};

// Remote appointments use separate RPCs so the counter QR and geofence remain in force for walk-ins.
DB.getServices = function() {
  return sbSelect("services_public?order=sort.asc,name.asc");
};
DB.getBookingSlots = function(barberId, serviceId, day) {
  return sbRpc("booking_slots", { p_barber_id: barberId, p_service_id: serviceId, p_day: day });
};
DB.bookAppointment = function(p) {
  return sbRpc("book_appointment", {
    p_barber_id: p.barberId, p_service_id: p.serviceId, p_day: p.day,
    p_time: p.time, p_customer_name: p.customerName, p_phone: p.phone
  });
};
DB.getBooking = function(id, token) {
  return sbRpc("get_booking", { p_booking_id: id, p_customer_token: token });
};
DB.cancelBooking = function(id, token) {
  return sbRpc("cancel_booking", { p_booking_id: id, p_customer_token: token });
};
DB.getBarberBookings = function(pin, day) {
  return sbRpc("get_bookings_for_barber", { p_pin: pin, p_day: day });
};
DB.checkInBooking = function(pin, id) {
  return sbRpc("check_in_booking", { p_pin: pin, p_booking_id: id });
};
DB.bookingNoShow = function(pin, id) {
  return sbRpc("booking_no_show", { p_pin: pin, p_booking_id: id });
};
DB.getOwnerServices = function(pin) {
  return sbRpc("get_owner_services", { p_owner_pin: pin });
};
DB.getOwnerBookings = function(pin, day) {
  return sbRpc("get_owner_bookings", { p_owner_pin: pin, p_day: day });
};
DB.saveService = function(pin, service) {
  return sbRpc("save_service", {
    p_owner_pin: pin, p_service_id: service.id || null, p_name: service.name,
    p_duration_minutes: service.durationMinutes, p_is_active: service.isActive
  });
};
DB.saveBarber = function(pin, worker) {
  return sbRpc("save_barber", {
    p_owner_pin: pin, p_id: worker.id || null, p_name: worker.name,
    p_role: worker.role, p_avg_minutes: worker.avgMinutes, p_sort: worker.sort,
    p_is_active: worker.isActive, p_is_listed: worker.isListed, p_off_days: worker.offDays || []
  });
};
DB.rotateBarberPin = function(pin, barberId) {
  return sbRpc("rotate_barber_pin", { p_owner_pin: pin, p_barber_id: barberId });
};

// Public link: join the live queue remotely during shop hours.
DB.joinQueueRemote = function(p) {
  return sbRpc("join_queue_remote", {
    p_barber_id: p.barberId, p_customer_name: p.customerName, p_phone: p.phone
  });
};

// Compatibility shim used by the pages
function call(params) {
  switch (params.action) {
    case "getBarbers":     return DB.getBarbers();
    case "getAllBarbers":  return DB.getAllBarbers();
    case "getQueue":       return DB.getQueue(params.barberId);
    case "getEntry":       return DB.getEntry(params.id);
    case "joinQueue":      return DB.joinQueue(params);
    case "leaveQueue":     return DB.leaveQueue(params.id, params.token);
    case "getBarberByPin": return DB.getBarberByPin(params.pin);
    case "getBarberQueue": return DB.getBarberQueue(params.pin);
    case "callNext":       return DB.callNext(params.pin, params.durationMinutes);
    case "setStatus":      return DB.setStatus(params.pin, params.id, params.status);
    case "toggleActive":   return DB.toggleActive(params.pin);
    case "getOwnerView":   return DB.getOwnerView(params.pin);
    case "getDailyStats":  return DB.getDailyStats();
    case "getServices":    return DB.getServices();
    case "bookingSlots":   return DB.getBookingSlots(params.barberId, params.serviceId, params.day);
    case "bookAppointment":return DB.bookAppointment(params);
    case "getBooking":     return DB.getBooking(params.id, params.token);
    case "cancelBooking":  return DB.cancelBooking(params.id, params.token);
    case "getBarberBookings": return DB.getBarberBookings(params.pin, params.day);
    case "checkInBooking": return DB.checkInBooking(params.pin, params.id);
    case "bookingNoShow":  return DB.bookingNoShow(params.pin, params.id);
    case "getOwnerServices": return DB.getOwnerServices(params.pin);
    case "getOwnerBookings": return DB.getOwnerBookings(params.pin, params.day);
    case "saveService":    return DB.saveService(params.pin, params.service);
    default:                return Promise.resolve({ error: "Unknown action" });
  }
}
