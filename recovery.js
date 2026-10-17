(function() {
  "use strict";

  function addStyles() {
    if (document.getElementById("bossman-recovery-styles")) return;
    var style = document.createElement("style");
    style.id = "bossman-recovery-styles";
    style.textContent =
      ".recovery-trigger{width:100%;margin-top:1rem;padding:.85rem;border:1px solid var(--gold);border-radius:.65rem;background:var(--moss);color:var(--gold-bright);font:inherit;font-weight:700;cursor:pointer}" +
      ".recovery-help{margin-top:.45rem;color:var(--cream-dim);font-size:.75rem;line-height:1.45;text-align:center}" +
      ".recovery-overlay{position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:1.25rem}" +
      ".recovery-overlay.recovery-hidden{display:none!important}" +
      ".recovery-dialog{width:100%;max-width:360px;background:var(--moss);border:1px solid var(--line);border-radius:1rem;box-shadow:var(--shadow);padding:1.35rem}" +
      ".recovery-dialog h2{font-family:var(--serif);font-size:1.3rem;color:var(--cream);margin:0 0 .45rem}" +
      ".recovery-dialog>p{color:var(--cream-dim);font-size:.82rem;line-height:1.5;margin:0 0 1rem}" +
      ".recovery-dialog label{display:block;color:var(--cream-dim);font-size:.76rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin:.8rem 0 .35rem}" +
      ".recovery-dialog input{width:100%;box-sizing:border-box;background:var(--pine);border:1.5px solid var(--fern);border-radius:.6rem;padding:.75rem .85rem;color:var(--cream);font:inherit;outline:none}" +
      ".recovery-dialog input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,167,106,.18)}" +
      ".recovery-error{color:#f3b0aa!important;font-size:.8rem!important;margin:.8rem 0 0!important;min-height:1.2em}" +
      ".recovery-actions{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin-top:1rem}" +
      ".recovery-actions button{padding:.78rem;border-radius:.6rem;font:inherit;font-weight:700;cursor:pointer}" +
      ".recovery-back{background:var(--pine);border:1px solid var(--line);color:var(--cream-dim)}" +
      ".recovery-submit{background:var(--gold);border:1px solid var(--gold);color:var(--pine)}" +
      ".recovery-actions button:disabled{opacity:.6;cursor:wait}";
    document.head.appendChild(style);
  }

  function createInterface() {
    var pick = document.getElementById("step-pick");
    var barberList = document.getElementById("barber-list");
    if (!pick || !barberList || document.getElementById("recover-queue-button")) return;

    addStyles();

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = "recover-queue-button";
    trigger.className = "recovery-trigger";
    trigger.textContent = "Already joined? Find my queue";

    var help = document.createElement("p");
    help.className = "recovery-help";
    help.textContent = "Use the same name and phone number entered when joining.";

    barberList.insertAdjacentElement("afterend", trigger);
    trigger.insertAdjacentElement("afterend", help);

    var overlay = document.createElement("div");
    overlay.id = "queue-recovery-overlay";
    overlay.className = "recovery-overlay recovery-hidden";
    overlay.innerHTML =
      '<div class="recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-recovery-title">' +
        '<h2 id="queue-recovery-title">Find My Queue</h2>' +
        '<p>If your original queue page was closed, enter the exact same details used when you registered.</p>' +
        '<form id="queue-recovery-form">' +
          '<label for="queue-recovery-name">Your name</label>' +
          '<input id="queue-recovery-name" name="name" type="text" autocomplete="name" maxlength="80" required>' +
          '<label for="queue-recovery-phone">Phone number</label>' +
          '<input id="queue-recovery-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" required>' +
          '<p class="recovery-error" id="queue-recovery-error" role="alert"></p>' +
          '<div class="recovery-actions">' +
            '<button class="recovery-back" id="queue-recovery-back" type="button">Back</button>' +
            '<button class="recovery-submit" id="queue-recovery-submit" type="submit">Find Queue</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(overlay);

    var form = document.getElementById("queue-recovery-form");
    var back = document.getElementById("queue-recovery-back");
    var submit = document.getElementById("queue-recovery-submit");
    var error = document.getElementById("queue-recovery-error");
    var nameInput = document.getElementById("queue-recovery-name");
    var phoneInput = document.getElementById("queue-recovery-phone");

    function openRecovery() {
      error.textContent = "";
      overlay.classList.remove("recovery-hidden");
      setTimeout(function() { nameInput.focus(); }, 50);
    }

    function closeRecovery() {
      if (submit.disabled) return;
      overlay.classList.add("recovery-hidden");
    }

    function restoreQueue(entries) {
      var primary = entries.find(function(entry) { return entry.role !== "therapist"; }) || entries[0];
      var facial = entries.find(function(entry) { return entry.role === "therapist" && entry.id !== primary.id; }) || null;

      selectedBarber = {
        id: primary.barberId,
        name: primary.barberName,
        avgMinutes: primary.avgMinutes || 35
      };
      myEntryId = primary.id;
      myCancelToken = null;
      myBarberId = primary.barberId;
      myFacialEntryId = facial ? facial.id : null;
      myFacialCancelToken = null;
      myFacialBarberId = facial ? facial.barberId : null;

      saveEntry(selectedBarber);
      syncCancelButton();
      document.getElementById("conf-barber").textContent = primary.barberName + (facial ? " + " + facial.barberName : "");
      document.getElementById("step-pick").classList.add("hidden");
      document.getElementById("step-form").classList.add("hidden");
      document.getElementById("step-done").classList.remove("hidden");
      overlay.classList.add("recovery-hidden");
      tickClock();
      refreshPosition();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(refreshPosition, 10000);
    }

    trigger.addEventListener("click", openRecovery);
    back.addEventListener("click", closeRecovery);
    overlay.addEventListener("click", function(event) {
      if (event.target === overlay) closeRecovery();
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape" && !overlay.classList.contains("recovery-hidden")) closeRecovery();
    });

    form.addEventListener("submit", function(event) {
      event.preventDefault();
      var name = nameInput.value.trim();
      var phone = phoneInput.value.trim();
      if (name.length < 2 || phone.length < 8) {
        error.textContent = "Enter the same name and phone number used to join.";
        return;
      }

      submit.disabled = true;
      back.disabled = true;
      submit.textContent = "Finding…";
      error.textContent = "";

      sbRpc("recover_queue", {
        p_customer_name: name,
        p_phone: phone
      }).then(function(result) {
        if (!result || result.error || !Array.isArray(result.entries) || !result.entries.length) {
          throw new Error(result && result.error || "No active queue was found with those details.");
        }
        restoreQueue(result.entries);
      }).catch(function(err) {
        error.textContent = err && err.message ? err.message : "Could not find the queue. Please try again.";
      }).finally(function() {
        submit.disabled = false;
        back.disabled = false;
        submit.textContent = "Find Queue";
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createInterface);
  } else {
    createInterface();
  }
})();
