(function() {
  "use strict";

  var ALERT_ENTRY_KEY = "bossman_turn_alert_entry";
  var LOCAL_NOTIFIED_KEY = "bossman_turn_local_notified";
  var EDGE_URL = SUPABASE_URL + "/functions/v1/bossman-turn-alert";
  var alertBox = null;
  var alertButton = null;
  var alertNote = null;
  var busy = false;
  var audioContext = null;

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function supportsPush() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function base64UrlToUint8Array(value) {
    var padding = "=".repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  function createUi() {
    if (document.getElementById("turn-alert-box")) return;
    var panel = document.querySelector("#step-done .panel");
    var refresh = document.getElementById("conf-refresh");
    if (!panel || !refresh) return;

    var style = document.createElement("style");
    style.textContent =
      ".turn-alert-box{margin-top:1rem;padding:1rem;background:var(--pine);border:1px solid var(--gold);border-radius:.8rem;text-align:left}" +
      ".turn-alert-title{color:var(--cream);font-weight:700;font-size:.95rem}" +
      ".turn-alert-note{color:var(--cream-dim);font-size:.78rem;line-height:1.45;margin:.35rem 0 .8rem}" +
      ".turn-alert-button{width:100%;padding:.78rem;border:0;border-radius:.6rem;background:var(--gold);color:var(--pine);font:inherit;font-weight:800;cursor:pointer}" +
      ".turn-alert-button:disabled{opacity:.65;cursor:default}";
    document.head.appendChild(style);

    alertBox = document.createElement("div");
    alertBox.id = "turn-alert-box";
    alertBox.className = "turn-alert-box";
    alertBox.innerHTML =
      '<div class="turn-alert-title">🔔 Turn Alert</div>' +
      '<p class="turn-alert-note" id="turn-alert-note">Enable a phone notification when your barber calls you.</p>' +
      '<button class="turn-alert-button" id="turn-alert-button" type="button">Enable Turn Alert</button>';

    refresh.insertAdjacentElement("afterend", alertBox);
    alertButton = document.getElementById("turn-alert-button");
    alertNote = document.getElementById("turn-alert-note");
    alertButton.addEventListener("click", enableAlerts);
    updateUi();
  }

  function queuePageVisible() {
    var done = document.getElementById("step-done");
    return done && !done.classList.contains("hidden") && !!window.myEntryId;
  }

  function updateUi(message) {
    if (!alertBox || !alertButton || !alertNote) return;
    alertBox.style.display = queuePageVisible() ? "block" : "none";
    if (!queuePageVisible()) return;

    if (message) alertNote.textContent = message;

    if (!supportsPush()) {
      alertButton.disabled = true;
      alertButton.textContent = "Notifications Not Supported";
      alertNote.textContent = "Keep this queue page open so the on-screen turn alert can still appear.";
      return;
    }

    if (isIos() && !isStandalone()) {
      alertButton.disabled = false;
      alertButton.textContent = "How to Enable on iPhone";
      alertNote.textContent = "On iPhone: open this page in Safari, tap Share → Add to Home Screen, then open Bossman from the new icon.";
      return;
    }

    if (Notification.permission === "denied") {
      alertButton.disabled = true;
      alertButton.textContent = "Notifications Blocked";
      alertNote.textContent = "Enable Bossman notifications in your phone Settings to receive turn alerts.";
      return;
    }

    if (localStorage.getItem(ALERT_ENTRY_KEY) === String(window.myEntryId) && Notification.permission === "granted") {
      alertButton.disabled = true;
      alertButton.textContent = "🔔 Turn Alert Enabled";
      alertNote.textContent = "You may leave this page. Your phone will notify you when your barber is ready.";
      return;
    }

    alertButton.disabled = busy;
    alertButton.textContent = busy ? "Enabling…" : "Enable Turn Alert";
  }

  async function getVapidPublicKey() {
    var response = await fetch(EDGE_URL, { method: "GET", cache: "no-store" });
    var data = await response.json();
    if (!response.ok || !data || !data.publicKey) throw new Error("Could not prepare notifications.");
    return data.publicKey;
  }

  async function saveSubscription(subscription) {
    if (!window.myEntryId || !window.myCancelToken) {
      throw new Error("Turn alerts can only be enabled from the original secure queue registration on this phone.");
    }
    var json = subscription.toJSON();
    var result = await sbRpc("save_queue_push_subscription", {
      p_entry_id: window.myEntryId,
      p_cancel_token: window.myCancelToken,
      p_endpoint: json.endpoint,
      p_p256dh: json.keys && json.keys.p256dh,
      p_auth: json.keys && json.keys.auth
    });
    if (!result || result.error || result.ok !== true) {
      throw new Error(result && result.error ? result.error : "Could not save the turn alert.");
    }
    localStorage.setItem(ALERT_ENTRY_KEY, String(window.myEntryId));
  }

  async function enableAlerts() {
    if (busy) return;
    if (isIos() && !isStandalone()) {
      alertNote.textContent = "Safari → Share → Add to Home Screen. Then open the Bossman icon and tap Enable Turn Alert again.";
      return;
    }
    if (!supportsPush()) {
      updateUi();
      return;
    }

    busy = true;
    updateUi();
    try {
      var permission = Notification.permission;
      if (permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not allowed.");

      var registration = await navigator.serviceWorker.ready;
      var subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        var publicKey = await getVapidPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey)
        });
      }
      await saveSubscription(subscription);
      unlockAudio();
      updateUi("Turn alerts are enabled. Your phone will notify you when it is your turn.");
    } catch (error) {
      alertNote.textContent = error && error.message ? error.message : "Could not enable turn alerts.";
    } finally {
      busy = false;
      updateUi();
    }
  }

  function unlockAudio() {
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === "suspended") audioContext.resume();
    } catch (e) {}
  }

  function playTone(delayMs, frequency, durationMs) {
    setTimeout(function() {
      try {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioContext) audioContext = new AudioContext();
        if (audioContext.state === "suspended") audioContext.resume();
        var oscillator = audioContext.createOscillator();
        var gain = audioContext.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.35, audioContext.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + durationMs / 1000);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + durationMs / 1000 + 0.05);
      } catch (e) {}
    }, delayMs);
  }

  function ringInPage() {
    if (navigator.vibrate) navigator.vibrate([350, 150, 350, 150, 700]);
    playTone(0, 880, 500);
    playTone(700, 880, 500);
    playTone(1400, 1040, 800);
  }

  async function showLocalTurnNotification() {
    if (!window.myEntryId) return;
    var entry = String(window.myEntryId);
    if (localStorage.getItem(LOCAL_NOTIFIED_KEY) === entry) return;
    localStorage.setItem(LOCAL_NOTIFIED_KEY, entry);

    try {
      var registration = await navigator.serviceWorker.ready;
      var tag = "bossman-turn-" + entry;
      var existing = await registration.getNotifications({ tag: tag });
      if (!existing.length && Notification.permission === "granted") {
        await registration.showNotification("It's your turn at Bossman", {
          body: "Please return now. Your barber is ready for you.",
          icon: "icon-192.png",
          badge: "icon-192.png",
          tag: tag,
          renotify: true,
          requireInteraction: true,
          vibrate: [350, 150, 350, 150, 700],
          data: { url: "./index.html" }
        });
      }
    } catch (e) {}
    ringInPage();
  }

  function observeTurnState() {
    var title = document.getElementById("conf-title");
    if (!title) return;
    function check() {
      updateUi();
      if (/it's your turn/i.test(title.textContent || "")) showLocalTurnNotification();
    }
    new MutationObserver(check).observe(title, { childList: true, characterData: true, subtree: true });
    check();
  }

  async function refreshExistingSubscription() {
    if (!queuePageVisible() || !window.myCancelToken || Notification.permission !== "granted") return;
    if (localStorage.getItem(ALERT_ENTRY_KEY) === String(window.myEntryId)) return;
    try {
      var registration = await navigator.serviceWorker.ready;
      var subscription = await registration.pushManager.getSubscription();
      if (subscription) await saveSubscription(subscription);
    } catch (e) {}
    updateUi();
  }

  function setup() {
    createUi();
    observeTurnState();
    setInterval(function() {
      updateUi();
      refreshExistingSubscription();
    }, 2500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
})();
