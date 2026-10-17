(function() {
  "use strict";

  var box;
  var button;
  var note;
  var overlay;
  var choiceList;
  var modalError;
  var modalTitle;
  var busy = false;

  function addStyles() {
    if (document.getElementById("bossman-switch-barber-styles")) return;
    var style = document.createElement("style");
    style.id = "bossman-switch-barber-styles";
    style.textContent =
      ".switch-barber-box{margin-top:1rem;padding:1rem;background:var(--pine);border:1px solid var(--line);border-radius:.8rem;text-align:left}" +
      ".switch-barber-title{color:var(--cream);font-weight:700;font-size:.95rem}" +
      ".switch-barber-note{color:var(--cream-dim);font-size:.78rem;line-height:1.45;margin:.35rem 0 .8rem}" +
      ".switch-barber-button{width:100%;padding:.78rem;border:1px solid var(--gold);border-radius:.6rem;background:transparent;color:var(--gold-bright);font:inherit;font-weight:800;cursor:pointer}" +
      ".switch-barber-button:disabled{opacity:.58;cursor:not-allowed}" +
      ".switch-barber-overlay{position:fixed;inset:0;z-index:260;background:rgba(0,0,0,.74);display:flex;align-items:center;justify-content:center;padding:1.2rem}" +
      ".switch-barber-overlay.switch-hidden{display:none!important}" +
      ".switch-barber-dialog{width:100%;max-width:390px;max-height:90vh;overflow:auto;background:var(--moss);border:1px solid var(--line);border-radius:1rem;padding:1.3rem;box-shadow:var(--shadow)}" +
      ".switch-barber-dialog h2{font-family:var(--serif);font-size:1.3rem;color:var(--cream);margin:0 0 .4rem}" +
      ".switch-barber-dialog>p{color:var(--cream-dim);font-size:.8rem;line-height:1.5;margin:0 0 .9rem}" +
      ".switch-barber-list{display:flex;flex-direction:column;gap:.6rem}" +
      ".switch-barber-choice{width:100%;display:flex;align-items:center;justify-content:space-between;gap:.8rem;padding:.9rem;border:1px solid var(--line);border-radius:.75rem;background:var(--pine);color:var(--cream);font:inherit;text-align:left;cursor:pointer}" +
      ".switch-barber-choice:hover{border-color:var(--gold)}" +
      ".switch-barber-choice:disabled{opacity:.6;cursor:wait}" +
      ".switch-barber-name{font-family:var(--serif);font-size:1rem;font-weight:700}" +
      ".switch-barber-meta{color:var(--cream-dim);font-size:.74rem;margin-top:.18rem}" +
      ".switch-barber-wait{color:var(--gold-bright);font-weight:800;font-size:.83rem;white-space:nowrap}" +
      ".switch-barber-free{color:#b8d996}" +
      ".switch-barber-error{color:#f3b0aa!important;font-size:.8rem!important;line-height:1.4;min-height:1.2em;margin:.75rem 0 0!important}" +
      ".switch-barber-actions{display:flex;justify-content:flex-end;margin-top:1rem}" +
      ".switch-barber-close{padding:.68rem 1rem;border:1px solid var(--line);border-radius:.55rem;background:var(--pine);color:var(--cream-dim);font:inherit;font-weight:700;cursor:pointer}";
    document.head.appendChild(style);
  }

  function queuePageVisible() {
    var done = document.getElementById("step-done");
    return done && !done.classList.contains("hidden") && !!window.myEntryId;
  }

  function customerStillWaiting() {
    var title = document.getElementById("conf-title");
    return title && /in the queue/i.test(title.textContent || "");
  }

  function updateUi(message) {
    if (!box || !button || !note) return;
    var visible = queuePageVisible() && customerStillWaiting();
    box.style.display = visible ? "block" : "none";
    if (!visible) return;

    if (message) note.textContent = message;

    if (!window.myCancelToken) {
      button.disabled = true;
      button.textContent = "Ask Staff to Change Barber";
      note.textContent = "This queue was recovered without the original secure key. Bossman staff can move you safely.";
      return;
    }

    button.disabled = busy;
    button.textContent = busy ? "Loading Barbers…" : "Change Barber";
    if (!message) {
      note.textContent = "Compare the live queues and move to the end of another available barber's queue.";
    }
  }

  function closeModal() {
    if (busy) return;
    overlay.classList.add("switch-hidden");
  }

  function showLoading() {
    modalError.textContent = "";
    choiceList.innerHTML = '<p style="color:var(--cream-dim);text-align:center;padding:1rem 0">Loading live queues…</p>';
  }

  function queueSummary(timing) {
    if (timing.queueMinutes <= 0) return "Free now";
    return timing.waitingCount + " waiting · ~" + timing.queueMinutes + " min";
  }

  function renderChoices(items, currentName) {
    choiceList.textContent = "";
    modalTitle.textContent = "Change from " + currentName;

    if (!items.length) {
      choiceList.innerHTML = '<p style="color:var(--cream-dim);text-align:center;padding:1rem 0">No other barber is accepting customers right now.</p>';
      return;
    }

    items.sort(function(a, b) {
      if (a.timing.queueMinutes !== b.timing.queueMinutes) {
        return a.timing.queueMinutes - b.timing.queueMinutes;
      }
      return a.barber.name.localeCompare(b.barber.name);
    });

    items.forEach(function(item) {
      var choice = document.createElement("button");
      choice.type = "button";
      choice.className = "switch-barber-choice";

      var detail = document.createElement("div");
      var name = document.createElement("div");
      name.className = "switch-barber-name";
      name.textContent = item.barber.name;
      var meta = document.createElement("div");
      meta.className = "switch-barber-meta";
      meta.textContent = item.timing.waitingCount === 0
        ? "No customers waiting"
        : item.timing.waitingCount + " customer" + (item.timing.waitingCount === 1 ? "" : "s") + " waiting";
      detail.appendChild(name);
      detail.appendChild(meta);

      var wait = document.createElement("div");
      wait.className = "switch-barber-wait" + (item.timing.queueMinutes <= 0 ? " switch-barber-free" : "");
      wait.textContent = item.timing.queueMinutes <= 0 ? "FREE NOW" : "~" + item.timing.queueMinutes + " MIN";

      choice.appendChild(detail);
      choice.appendChild(wait);
      choice.addEventListener("click", function() { confirmSwitch(item, choice); });
      choiceList.appendChild(choice);
    });
  }

  function openModal() {
    if (busy || !window.myEntryId) return;
    if (!window.myCancelToken) {
      updateUi();
      return;
    }

    busy = true;
    updateUi();
    showLoading();
    overlay.classList.remove("switch-hidden");

    call({ action: "getEntry", id: window.myEntryId }).then(function(entry) {
      if (!entry || entry.status !== "waiting") {
        throw new Error("You can only change barber while you are still waiting.");
      }

      if (entry.barberId) window.myBarberId = entry.barberId;

      return call({ action: "getBarbers" }).then(function(barbers) {
        var candidates = (Array.isArray(barbers) ? barbers : []).filter(function(barber) {
          return barber.role === "barber"
            && barber.isAvailable
            && barber.id !== window.myBarberId;
        });

        return Promise.all(candidates.map(function(barber) {
          return call({ action: "getQueue", barberId: barber.id }).then(function(queue) {
            return {
              barber: barber,
              timing: bossmanQueueTiming(queue || [], barber.avgMinutes || 35)
            };
          });
        })).then(function(items) {
          var currentName = window.selectedBarber && window.selectedBarber.name
            ? window.selectedBarber.name
            : "your current barber";
          renderChoices(items, currentName);
        });
      });
    }).catch(function(error) {
      modalError.textContent = error && error.message ? error.message : "Could not load barber queues.";
      choiceList.textContent = "";
    }).finally(function() {
      busy = false;
      updateUi();
    });
  }

  function setChoicesDisabled(disabled) {
    choiceList.querySelectorAll("button").forEach(function(item) {
      item.disabled = disabled;
    });
  }

  function confirmSwitch(item, selectedButton) {
    if (busy || !window.myEntryId || !window.myCancelToken) return;

    var currentName = window.selectedBarber && window.selectedBarber.name
      ? window.selectedBarber.name
      : "your current barber";
    var targetWait = queueSummary(item.timing);
    var confirmed = window.confirm(
      "Change from " + currentName + " to " + item.barber.name + "?\n\n" +
      "You will leave your current position and join the end of " + item.barber.name + "'s queue.\n" +
      "Current estimate: " + targetWait + "."
    );
    if (!confirmed) return;

    busy = true;
    modalError.textContent = "";
    setChoicesDisabled(true);
    selectedButton.textContent = "Changing…";
    updateUi();

    sbRpc("switch_queue_barber", {
      p_entry_id: window.myEntryId,
      p_cancel_token: window.myCancelToken,
      p_target_barber_id: item.barber.id
    }).then(function(result) {
      if (!result || result.error || result.ok !== true) {
        throw new Error(result && result.error ? result.error : "Could not change barber.");
      }

      window.selectedBarber = {
        id: result.barberId,
        name: result.barberName,
        avgMinutes: result.avgMinutes || item.barber.avgMinutes || 35
      };
      window.myBarberId = result.barberId;

      if (typeof window.saveEntry === "function") window.saveEntry(window.selectedBarber);

      var barberLabel = document.getElementById("conf-barber");
      if (barberLabel) {
        barberLabel.textContent = result.barberName + (window.myFacialEntryId ? " + Facial" : "");
      }

      overlay.classList.add("switch-hidden");
      updateUi("Changed to " + result.barberName + ". Your new queue position is #" + result.position + ".");

      if (typeof window.refreshPosition === "function") window.refreshPosition();
      if (typeof window.loadBarbers === "function") window.loadBarbers();
    }).catch(function(error) {
      modalError.textContent = error && error.message ? error.message : "Could not change barber.";
      setChoicesDisabled(false);
      selectedButton.textContent = item.barber.name;
    }).finally(function() {
      busy = false;
      updateUi();
    });
  }

  function createInterface() {
    if (document.getElementById("switch-barber-box")) return;
    var panel = document.querySelector("#step-done .panel");
    var leaveButton = document.getElementById("btn-leave");
    if (!panel || !leaveButton) return;

    addStyles();

    box = document.createElement("div");
    box.id = "switch-barber-box";
    box.className = "switch-barber-box";
    box.innerHTML =
      '<div class="switch-barber-title">✂️ Change Barber</div>' +
      '<p class="switch-barber-note" id="switch-barber-note">Compare the live queues and move to another available barber.</p>' +
      '<button class="switch-barber-button" id="switch-barber-button" type="button">Change Barber</button>';
    leaveButton.insertAdjacentElement("beforebegin", box);

    button = document.getElementById("switch-barber-button");
    note = document.getElementById("switch-barber-note");
    button.addEventListener("click", openModal);

    overlay = document.createElement("div");
    overlay.id = "switch-barber-overlay";
    overlay.className = "switch-barber-overlay switch-hidden";
    overlay.innerHTML =
      '<div class="switch-barber-dialog" role="dialog" aria-modal="true" aria-labelledby="switch-barber-title">' +
        '<h2 id="switch-barber-title">Change Barber</h2>' +
        '<p>You will join the end of the selected barber\'s live queue. Your old queue position will be released immediately.</p>' +
        '<div class="switch-barber-list" id="switch-barber-list"></div>' +
        '<p class="switch-barber-error" id="switch-barber-error" role="alert"></p>' +
        '<div class="switch-barber-actions">' +
          '<button class="switch-barber-close" id="switch-barber-close" type="button">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    choiceList = document.getElementById("switch-barber-list");
    modalError = document.getElementById("switch-barber-error");
    modalTitle = document.getElementById("switch-barber-title");

    document.getElementById("switch-barber-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", function(event) {
      if (event.target === overlay) closeModal();
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape" && !overlay.classList.contains("switch-hidden")) closeModal();
    });

    var title = document.getElementById("conf-title");
    if (title) {
      new MutationObserver(function() { updateUi(); }).observe(title, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    updateUi();
    setInterval(function() { updateUi(); }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createInterface);
  else createInterface();
})();
