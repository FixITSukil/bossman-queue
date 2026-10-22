(function() {
  "use strict";

  // One hours check for QR and remote joining. Never parse a phone's
  // locale-formatted clock to decide whether the shop is open.
  var HOURS_VERSION = "20261022-server-clock";
  var OPEN_MINUTE = 660;
  var CLOSE_MINUTE_EXCLUSIVE = 1366; // Includes the full 10:45 PM minute.
  var MAX_CLOCK_AGE = 90000;
  var sample = null;
  var pending = null;
  var syncFailed = false;
  var isQrPage = false;
  var isRemotePage = false;

  function element(id) { return document.getElementById(id); }
  function monotonicNow() { return window.performance.now(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function serverNow() {
    if (!sample) return null;
    var elapsed = monotonicNow() - sample.at;
    if (!isFinite(elapsed) || elapsed < 0 || elapsed > MAX_CLOCK_AGE) return null;
    return sample.utc + elapsed;
  }

  function malaysiaDate() {
    var now = serverNow();
    return now === null ? null : new Date(now + 8 * 60 * 60 * 1000);
  }

  function malaysiaMinutes() {
    var date = malaysiaDate();
    return date ? date.getUTCHours() * 60 + date.getUTCMinutes() : null;
  }

  function openState() {
    var minute = malaysiaMinutes();
    return minute === null ? null : minute >= OPEN_MINUTE && minute < CLOSE_MINUTE_EXCLUSIVE;
  }

  function joiningOpen() {
    // Unknown is not "closed". The join RPC remains the final authority
    // and still enforces the real opening hours on every submission.
    return openState() !== false;
  }

  function updateHoursUI() {
    var state = openState();
    var minute = malaysiaMinutes();
    var date = malaysiaDate();
    var clockLabel = date
      ? "🕐 " + pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + ":" + pad(date.getUTCSeconds()) + " MYT"
      : "🕐 " + (syncFailed ? "Shop time unavailable" : "Checking shop time…");
    ["clock", "conf-clock"].forEach(function(id) {
      var clock = element(id);
      if (clock) clock.textContent = clockLabel;
    });
    document.documentElement.setAttribute("data-bossman-hours-version", HOURS_VERSION);
    document.documentElement.setAttribute("data-bossman-hours-source", state === null ? "unconfirmed" : "server");

    if (isQrPage) {
      element("hours-closed").classList.toggle("hidden", state === true);
      element("barber-list").classList.toggle("hidden", state === false);
      if (state === null) {
        element("hours-title").textContent = syncFailed ? "Could not confirm shop hours" : "Checking shop opening hours…";
        element("hours-text").textContent = syncFailed
          ? "Check your connection. You can still try joining; the server will check opening hours. Your existing queue is not affected."
          : "Using server time, not your phone clock. Existing customers can still reopen their queue.";
      } else if (!state) {
        element("hours-title").textContent = minute < OPEN_MINUTE ? "The queue isn't open yet" : "The queue is closed for today";
        element("hours-text").textContent = minute < OPEN_MINUTE
          ? "Please scan again from 11:00 AM. The last join is at 10:45 PM Malaysia time."
          : "Please come back tomorrow from 11:00 AM. The last join is at 10:45 PM Malaysia time.";
        var form = element("step-form");
        if (form && !form.classList.contains("hidden") && typeof window.showPick === "function") window.showPick();
      }
    }
    if (isRemotePage) updateRemoteButton();
  }

  function updateRemoteButton() {
    var button = element("join-button");
    var selected = window.selectedBarber;
    var state = openState();
    button.disabled = !!window.joining || !selected || !selected.isAvailable || state === false || element("join-form").classList.contains("hidden");
    element("hours-note").textContent = state === null
      ? "Checking opening hours with server time. You can still submit; the server will confirm."
      : state ? "Last online join: 10:45 PM MYT."
      : "Online joining opens at 11:00 AM and closes at 10:45 PM MYT.";
  }

  // HTTP Date is an English GMT timestamp, not a locale-dependent date.
  function parseHttpDate(value) {
    var match = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/.exec(value || "");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (!match) return NaN;
    var month = months.indexOf(match[2]);
    if (month < 0 || +match[1] < 1 || +match[1] > 31 || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) return NaN;
    return Date.UTC(+match[3], month, +match[1], +match[4], +match[5], +match[6]);
  }

  function syncClock() {
    if (pending) return pending;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    var options = { method: "HEAD", cache: "no-store", credentials: "same-origin" };
    if (controller) options.signal = controller.signal;
    var request = fetch("./brand.css?bossman-clock=" + Math.random().toString(36).slice(2), options).then(function(response) {
      if (!response.ok) throw new Error("clock_request_failed");
      var utc = parseHttpDate(response.headers.get("Date"));
      var age = Number(response.headers.get("Age") || "0");
      if (!isFinite(utc) || !isFinite(age) || age < 0) throw new Error("clock_response_invalid");
      return { utc: utc + age * 1000, at: monotonicNow() };
    });
    // HEAD bypasses the GET-only service worker. The nonce and no-store
    // prevent a cached page's old Date header being mistaken for current time.
    var timeout = new Promise(function(_, reject) {
      timer = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error("clock_timeout"));
      }, 8000);
    });
    pending = Promise.race([request, timeout]).then(function(fresh) {
      sample = fresh;
      syncFailed = false;
    }).catch(function() {
      syncFailed = true;
    }).then(function() {
      clearTimeout(timer);
      pending = null;
      updateHoursUI();
    });
    return pending;
  }

  function setupShopHours() {
    isQrPage = !!element("step-pick") && !!element("hours-closed");
    isRemotePage = !!element("join-form") && !!element("hours-note") && !!element("join-button");
    if (!isQrPage && !isRemotePage) return;
    // Existing page functions call these globals. Replacing them preserves
    // registration, recovery, cancellation, switch-barber and alert logic.
    window.malaysiaMinutes = malaysiaMinutes;
    window.joiningOpen = joiningOpen;
    if (isQrPage) window.updateHoursUI = updateHoursUI;
    if (isRemotePage) window.updateButton = updateRemoteButton;
    window.bossmanHoursDiagnostics = function() {
      return { version: HOURS_VERSION, source: serverNow() === null ? "unconfirmed" : "server", open: openState(), serverNowMs: serverNow() };
    };
    updateHoursUI();
    syncClock();
    setInterval(updateHoursUI, 1000);
    setInterval(function() { if (!document.hidden) syncClock(); }, 30000);
    function recheck() {
      if (document.hidden) return;
      sample = null;
      updateHoursUI();
      syncClock();
    }
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
  }

  function loadScript(id, path) {
    if (element(id)) return;
    var script = document.createElement("script");
    script.id = id;
    script.src = path;
    document.body.appendChild(script);
  }

  function setup() {
    setupShopHours();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then(function(registration) {
        registration.update().catch(function() {});
      }).catch(function() {});
    }
    if (element("step-pick")) {
      loadScript("bossman-recovery-loader", "recovery-loader.js?v=20261017b");
      loadScript("bossman-turn-alerts", "turn-alerts.js?v=20261017a");
      loadScript("bossman-switch-barber", "switch-barber.js?v=20261017a");
    }
    var card = element("install-card");
    var button = element("install-button");
    if (!card) return;
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
      card.classList.add("hidden");
      return;
    }
    var promptEvent = null;
    window.addEventListener("beforeinstallprompt", function(event) {
      event.preventDefault();
      promptEvent = event;
      if (button) button.classList.remove("hidden");
    });
    if (button) button.addEventListener("click", function() {
      if (!promptEvent) return;
      promptEvent.prompt();
      promptEvent.userChoice.then(function() {
        promptEvent = null;
        button.classList.add("hidden");
      }).catch(function() { promptEvent = null; });
    });
    window.addEventListener("appinstalled", function() { card.classList.add("hidden"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
