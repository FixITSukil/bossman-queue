(function() {
  "use strict";

  function normalizePhone(value) {
    var digits = String(value || "").replace(/\D/g, "");
    return digits.charAt(0) === "0" ? "60" + digits.slice(1) : digits;
  }

  function normalizedName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function validateMatches(result) {
    if (!result || result.error || result.ok !== true || !Array.isArray(result.matches) || !result.matches.length) {
      throw new Error(result && result.error || "No active queue was found for this phone number.");
    }
    var seenMatches = Object.create(null), seenEntries = Object.create(null);
    result.matches.forEach(function(match) {
      if (!match || typeof match.matchId !== "string" || !match.matchId || seenMatches[match.matchId]
          || !Array.isArray(match.entries) || !match.entries.length || match.entries.length > 2) {
        throw new Error("Could not confirm the matching queues. Please try again or ask Bossman staff.");
      }
      seenMatches[match.matchId] = true;
      match.entries.forEach(function(entry) {
        if (!entry || typeof entry.id !== "string" || !entry.id || seenEntries[entry.id]
            || typeof entry.barberId !== "string" || !entry.barberId
            || (entry.status !== "waiting" && entry.status !== "called")) {
          throw new Error("Could not confirm the matching queues. Please try again or ask Bossman staff.");
        }
        seenEntries[entry.id] = true;
      });
      if (match.entries.length === 2) {
        var haircut = match.entries.filter(function(entry) { return entry.role === "barber"; });
        var facial = match.entries.filter(function(entry) { return entry.role === "therapist"; });
        if (haircut.length !== 1 || facial.length !== 1
            || !normalizedName(haircut[0].customerName)
            || normalizedName(facial[0].customerName) !== normalizedName(haircut[0].customerName) + " (facial)") {
          throw new Error("These queues need separate confirmation. Please ask Bossman staff for help.");
        }
      }
    });
    return result.matches;
  }

  function addStyles() {
    if (document.getElementById("bossman-recovery-styles")) return;
    var style = document.createElement("style");
    style.id = "bossman-recovery-styles";
    style.textContent =
      ".recovery-trigger{width:100%;margin-top:1rem;padding:.85rem;border:1px solid var(--gold);border-radius:.65rem;background:var(--moss);color:var(--gold-bright);font:inherit;font-weight:700;cursor:pointer}" +
      ".recovery-trigger.form-trigger{background:var(--pine)}" +
      ".recovery-help{margin-top:.45rem;color:var(--cream-dim);font-size:.75rem;line-height:1.45;text-align:center}" +
      ".recovery-overlay{position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:1.25rem}" +
      ".recovery-overlay.recovery-hidden{display:none!important}" +
      ".recovery-dialog{width:100%;max-width:360px;box-sizing:border-box;max-height:90vh;overflow:auto;background:var(--moss);border:1px solid var(--line);border-radius:1rem;box-shadow:var(--shadow);padding:1.35rem}" +
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
    style.textContent += ".recovery-matches.recovery-hidden{display:none!important}" +
      ".recovery-matches>p{font-size:.82rem;line-height:1.5;color:var(--cream-dim);margin:.8rem 0 .5rem}" +
      ".recovery-match{display:block;width:100%;text-align:left;margin:.5rem 0;padding:.8rem;border:1px solid var(--gold);border-radius:.6rem;background:var(--pine);color:var(--cream);font:inherit;cursor:pointer;overflow-wrap:anywhere}" +
      ".recovery-match strong,.recovery-match small{display:block}" +
      ".recovery-match small{margin-top:.3rem;color:var(--cream-dim);font-size:.76rem;line-height:1.4}";
    document.head.appendChild(style);
  }

  function makeTrigger(id, label, extraClass) {
    var button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "recovery-trigger" + (extraClass ? " " + extraClass : "");
    button.textContent = label;
    return button;
  }

  function makeHelp(text) {
    var help = document.createElement("p");
    help.className = "recovery-help";
    help.textContent = text;
    return help;
  }

  function createInterface() {
    var pick = document.getElementById("step-pick");
    var barberList = document.getElementById("barber-list");
    var joinButton = document.getElementById("btn-join");
    if (!pick || !barberList || !joinButton) return;
    if (document.getElementById("queue-recovery-overlay")) return;

    addStyles();

    var pickTrigger = makeTrigger(
      "recover-queue-button",
      "Already joined? Find my queue"
    );
    var pickHelp = makeHelp("Use the phone number entered when joining. No name is needed.");
    barberList.insertAdjacentElement("afterend", pickTrigger);
    pickTrigger.insertAdjacentElement("afterend", pickHelp);

    var formTrigger = makeTrigger(
      "recover-queue-button-form",
      "Already in queue? Get my queue back",
      "form-trigger"
    );
    var formHelp = makeHelp("Closed the previous tab? Reopen your live queue without registering again.");
    joinButton.insertAdjacentElement("afterend", formTrigger);
    formTrigger.insertAdjacentElement("afterend", formHelp);

    var overlay = document.createElement("div");
    overlay.id = "queue-recovery-overlay";
    overlay.className = "recovery-overlay recovery-hidden";
    overlay.innerHTML =
      '<div class="recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-recovery-title">' +
        '<h2 id="queue-recovery-title">Find My Queue</h2>' +
        '<p>Enter the full phone number used when you joined. No name is needed. If more than one customer uses this number, choose your queue.</p>' +
        '<form id="queue-recovery-form">' +
          '<label for="queue-recovery-phone">Phone number</label>' +
          '<input id="queue-recovery-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" required>' +
          '<div class="recovery-matches recovery-hidden" id="queue-recovery-matches" role="group" aria-label="Choose your queue"></div>' +
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
    var phoneInput = document.getElementById("queue-recovery-phone");
    var matchesContainer = document.getElementById("queue-recovery-matches");

    function clearMatches() {
      matchesContainer.textContent = "";
      matchesContainer.classList.add("recovery-hidden");
    }

    function openRecovery(prefillPhone, legacyPhone) {
      if (submit.disabled) return;
      error.textContent = "";
      clearMatches();
      // Keep the former (name, phone) helper compatible with cached loaders.
      if (typeof legacyPhone === "string") prefillPhone = legacyPhone;
      if (typeof prefillPhone === "string" && prefillPhone.trim()) {
        phoneInput.value = prefillPhone.trim();
      }
      overlay.classList.remove("recovery-hidden");
      setTimeout(function() {
        if (!phoneInput.value) phoneInput.focus();
        else submit.focus();
      }, 50);
    }

    function closeRecovery() {
      if (submit.disabled) return;
      overlay.classList.add("recovery-hidden");
    }

    function restoreQueue(entries) {
      var primary = entries.find(function(entry) { return entry.role !== "therapist"; }) || entries[0];
      var facial = entries.find(function(entry) {
        return entry.role === "therapist" && entry.id !== primary.id;
      }) || null;

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
      document.getElementById("conf-barber").textContent =
        primary.barberName + (facial ? " + " + facial.barberName : "");
      document.getElementById("step-pick").classList.add("hidden");
      document.getElementById("step-form").classList.add("hidden");
      document.getElementById("step-done").classList.remove("hidden");
      var formError = document.getElementById("form-error");
      if (formError) formError.classList.add("hidden");
      overlay.classList.add("recovery-hidden");
      tickClock();
      refreshPosition();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(refreshPosition, 10000);
      window.dispatchEvent(new CustomEvent("bossman:queue-restored", {
        detail: { entryId: primary.id, barberId: primary.barberId }
      }));
    }

    function showMatches(matches) {
      clearMatches();
      var explanation = document.createElement("p");
      explanation.textContent = "More than one active queue uses this number. Choose yours.";
      matchesContainer.appendChild(explanation);
      matches.forEach(function(match) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "recovery-match";
        var title = document.createElement("strong");
        title.textContent = match.customerName || match.entries[0].customerName || "Customer";
        button.appendChild(title);
        match.entries.forEach(function(entry) {
          var detail = document.createElement("small");
          detail.textContent = (entry.barberName || "Assigned worker") + " · "
            + (entry.status === "called" ? "Called / being served" : "Waiting"
              + (Number(entry.position) > 0 ? " · #" + entry.position : ""));
          button.appendChild(detail);
        });
        button.addEventListener("click", function() {
          try { restoreQueue(match.entries); }
          catch (err) { error.textContent = err && err.message || "Could not open this queue. Please try again."; }
        });
        matchesContainer.appendChild(button);
      });
      matchesContainer.classList.remove("recovery-hidden");
      var first = matchesContainer.querySelector("button");
      if (first) first.focus();
    }

    window.openBossmanQueueRecovery = openRecovery;

    pickTrigger.addEventListener("click", function() {
      openRecovery("");
    });
    formTrigger.addEventListener("click", function() {
      var currentPhone = document.getElementById("inp-phone");
      openRecovery(currentPhone ? currentPhone.value : "");
    });
    phoneInput.addEventListener("input", function() { clearMatches(); error.textContent = ""; });
    back.addEventListener("click", closeRecovery);
    overlay.addEventListener("click", function(event) {
      if (event.target === overlay) closeRecovery();
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape" && !overlay.classList.contains("recovery-hidden")) {
        closeRecovery();
      }
    });

    form.addEventListener("submit", function(event) {
      event.preventDefault();
      if (submit.disabled) return;
      var phone = normalizePhone(phoneInput.value);
      clearMatches();
      if (phone.length < 9 || phone.length > 15) {
        error.textContent = "Enter the full phone number used to join.";
        return;
      }

      submit.disabled = true;
      back.disabled = true;
      phoneInput.disabled = true;
      submit.textContent = "Finding…";
      error.textContent = "";

      sbRpc("recover_queue_by_phone", { p_phone: phone }).then(function(result) {
        var matches = validateMatches(result);
        if (matches.length === 1) restoreQueue(matches[0].entries);
        else showMatches(matches);
      }).catch(function(err) {
        error.textContent = err && err.message
          ? err.message
          : "Could not find the queue. Please try again.";
      }).finally(function() {
        submit.disabled = false;
        back.disabled = false;
        phoneInput.disabled = false;
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
