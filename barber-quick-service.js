(function() {
  "use strict";

  var modal;
  var form;
  var nameInput;
  var phoneInput;
  var durationInput;
  var positionSelect;
  var submitButton;
  var errorText;
  var statusText;
  var rendererWrapped = false;

  function addStyles() {
    if (document.getElementById("bossman-quick-service-styles")) return;
    var style = document.createElement("style");
    style.id = "bossman-quick-service-styles";
    style.textContent =
      ".quick-queue-actions{display:flex;align-items:center;justify-content:flex-end;gap:.45rem;flex-wrap:wrap}" +
      ".quick-service-open{background:var(--moss);color:var(--gold-bright);border:1px solid var(--gold);border-radius:.6rem;padding:.5rem .7rem;font:inherit;font-size:.78rem;font-weight:700;cursor:pointer}" +
      ".quick-service-overlay{position:fixed;inset:0;z-index:220;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:1.25rem}" +
      ".quick-service-overlay.quick-hidden{display:none!important}" +
      ".quick-service-dialog{width:100%;max-width:360px;max-height:90vh;overflow:auto;background:var(--moss);border:1px solid var(--line);border-radius:1rem;padding:1.35rem;box-shadow:var(--shadow)}" +
      ".quick-service-dialog h2{font-family:var(--serif);font-size:1.25rem;color:var(--cream);margin:0 0 .4rem}" +
      ".quick-service-dialog>p{color:var(--cream-dim);font-size:.8rem;line-height:1.45;margin:0 0 .9rem}" +
      ".quick-service-dialog label{display:block;color:var(--cream-dim);font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:.75rem 0 .32rem}" +
      ".quick-service-dialog input,.quick-service-dialog select{width:100%;box-sizing:border-box;background:var(--pine);border:1.5px solid var(--fern);border-radius:.6rem;padding:.72rem .8rem;color:var(--cream);font:inherit;outline:none}" +
      ".quick-service-dialog input:focus,.quick-service-dialog select:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,167,106,.18)}" +
      ".quick-duration-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem;margin:.45rem 0 .55rem}" +
      ".quick-duration-presets button{padding:.58rem;border:1px solid var(--line);border-radius:.5rem;background:var(--pine);color:var(--cream);font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}" +
      ".quick-duration-presets button.active{background:var(--gold);color:var(--pine);border-color:var(--gold)}" +
      ".quick-service-note{font-size:.72rem!important;color:var(--cream-dim)!important;margin:.5rem 0 0!important;line-height:1.4}" +
      ".quick-service-error{color:#f3b0aa!important;font-size:.8rem!important;min-height:1.2em;margin:.7rem 0 0!important}" +
      ".quick-service-actions{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;margin-top:1rem}" +
      ".quick-service-actions button{padding:.75rem;border-radius:.6rem;font:inherit;font-weight:700;cursor:pointer}" +
      ".quick-service-close{background:var(--pine);border:1px solid var(--line);color:var(--cream-dim)}" +
      ".quick-service-save{background:var(--gold);border:1px solid var(--gold);color:var(--pine)}" +
      ".quick-service-actions button:disabled{opacity:.6;cursor:wait}" +
      ".quick-service-status{display:none;color:var(--gold-bright);font-size:.8rem;line-height:1.4;margin:0 0 .65rem}" +
      ".quick-service-status.visible{display:block}" +
      ".quick-service-badge{display:inline-block;margin-top:.3rem;padding:.16rem .45rem;border-radius:999px;background:rgba(201,167,106,.15);border:1px solid rgba(201,167,106,.35);color:var(--gold-bright);font-size:.65rem;font-weight:700}";
    document.head.appendChild(style);
  }

  function waitingEntries() {
    var queue = Array.isArray(window.latestQueue) ? window.latestQueue.slice() : [];
    return queue.filter(function(entry) { return entry.status === "waiting"; })
      .sort(function(a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
  }

  function populatePositions() {
    var waiting = waitingEntries();
    positionSelect.textContent = "";

    if (!waiting.length) {
      var only = document.createElement("option");
      only.value = "";
      only.textContent = window.servingId ? "Next — after the current customer" : "Next available";
      positionSelect.appendChild(only);
      return;
    }

    waiting.forEach(function(entry, index) {
      var option = document.createElement("option");
      option.value = entry.id;
      option.textContent = index === 0
        ? "Next — before " + entry.customerName
        : "Before " + entry.customerName + " (currently #" + (index + 1) + ")";
      positionSelect.appendChild(option);
    });

    var end = document.createElement("option");
    end.value = "";
    end.textContent = "End of queue";
    positionSelect.appendChild(end);
  }

  function setDuration(value) {
    durationInput.value = value;
    document.querySelectorAll(".quick-duration-presets button").forEach(function(button) {
      button.classList.toggle("active", Number(button.dataset.minutes) === Number(value));
    });
  }

  function openModal() {
    errorText.textContent = "";
    nameInput.value = "";
    phoneInput.value = "";
    setDuration(10);
    populatePositions();
    modal.classList.remove("quick-hidden");
    setTimeout(function() { nameInput.focus(); }, 50);
  }

  function closeModal() {
    if (submitButton.disabled) return;
    modal.classList.add("quick-hidden");
  }

  function showStatus(message) {
    statusText.textContent = message;
    statusText.classList.add("visible");
    setTimeout(function() { statusText.classList.remove("visible"); }, 6000);
  }

  function normalizePhone(value) {
    var digits = String(value || "").replace(/\D/g, "");
    if (digits.charAt(0) === "0") digits = "60" + digits.slice(1);
    return digits;
  }

  function submitQuickService(event) {
    event.preventDefault();
    if (submitButton.disabled) return;

    var name = nameInput.value.trim();
    var phone = normalizePhone(phoneInput.value);
    var duration = parseInt(durationInput.value, 10);
    var beforeId = positionSelect.value || null;

    if (name.length < 2) {
      errorText.textContent = "Enter the customer name.";
      return;
    }
    if (phone.length < 9 || phone.length > 15) {
      errorText.textContent = "Enter a valid customer phone number.";
      return;
    }
    if (!(duration >= 5 && duration <= 120)) {
      errorText.textContent = "Service time must be between 5 and 120 minutes.";
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Adding…";
    errorText.textContent = "";

    sbRpc("insert_quick_service_customer", {
      p_pin: window.PIN,
      p_customer_name: name,
      p_phone: phone,
      p_duration_minutes: duration,
      p_before_entry_id: beforeId
    }).then(function(result) {
      if (!result || result.error || result.ok !== true) {
        throw new Error(result && result.error ? result.error : "Could not add this customer.");
      }
      modal.classList.add("quick-hidden");
      showStatus(name + " added at queue position #" + result.position + " for " + duration + " minutes.");
      if (typeof window.loadQueue === "function") window.loadQueue();
    }).catch(function(error) {
      errorText.textContent = error && error.message ? error.message : "Could not add this customer.";
      populatePositions();
    }).finally(function() {
      submitButton.disabled = false;
      submitButton.textContent = "Add to Queue";
    });
  }

  function decorateQueue(queue) {
    var waiting = (Array.isArray(queue) ? queue : [])
      .filter(function(entry) { return entry.status === "waiting"; })
      .sort(function(a, b) { return (Number(a.position) || 0) - (Number(b.position) || 0); });
    var rows = document.querySelectorAll("#queue-list .queue-item");

    waiting.forEach(function(entry, index) {
      var row = rows[index];
      var duration = parseInt(entry.durationMinutes, 10);
      if (!row || !(duration > 0)) return;
      var detail = row.querySelector(".queue-left > div:last-child");
      if (!detail || detail.querySelector(".quick-service-badge")) return;
      var badge = document.createElement("div");
      badge.className = "quick-service-badge";
      badge.textContent = (duration <= 15 ? "Quick service · " : "Planned service · ") + duration + " min";
      detail.appendChild(badge);
    });
  }

  function wrapRenderer() {
    if (rendererWrapped) return;
    if (typeof window.renderQueue !== "function") {
      setTimeout(wrapRenderer, 100);
      return;
    }
    var originalRenderQueue = window.renderQueue;
    window.renderQueue = function(queue) {
      originalRenderQueue(queue);
      decorateQueue(queue);
    };
    rendererWrapped = true;
    if (Array.isArray(window.latestQueue)) decorateQueue(window.latestQueue);
  }

  function createInterface() {
    if (!document.getElementById("barber-name") || document.getElementById("quick-service-open")) return;
    addStyles();

    var headers = Array.prototype.slice.call(document.querySelectorAll(".section-header"));
    var queueHeader = headers.find(function(header) {
      var title = header.querySelector(".section-title");
      return title && title.textContent.trim() === "Queue";
    });
    var callButton = document.getElementById("call-btn");
    if (!queueHeader || !callButton) return;

    var actions = document.createElement("div");
    actions.className = "quick-queue-actions";
    var openButton = document.createElement("button");
    openButton.type = "button";
    openButton.id = "quick-service-open";
    openButton.className = "quick-service-open";
    openButton.textContent = "＋ Quick Service";
    openButton.title = "Add a short service customer anywhere in your queue";
    actions.appendChild(openButton);
    actions.appendChild(callButton);
    queueHeader.appendChild(actions);

    statusText = document.createElement("p");
    statusText.id = "quick-service-status";
    statusText.className = "quick-service-status";
    var queueError = document.getElementById("queue-action-error");
    if (queueError) queueError.insertAdjacentElement("beforebegin", statusText);

    modal = document.createElement("div");
    modal.id = "quick-service-modal";
    modal.className = "quick-service-overlay quick-hidden";
    modal.innerHTML =
      '<div class="quick-service-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-service-title">' +
        '<h2 id="quick-service-title">Add Quick Service</h2>' +
        '<p>Add a short walk-in service and choose exactly where the customer should enter your queue.</p>' +
        '<form id="quick-service-form">' +
          '<label for="quick-service-name">Customer name</label>' +
          '<input id="quick-service-name" type="text" autocomplete="name" maxlength="80" required>' +
          '<label for="quick-service-phone">Phone number</label>' +
          '<input id="quick-service-phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="20" placeholder="e.g. 01112345678" required>' +
          '<p class="quick-service-note">The customer can later scan the shop QR and use Find My Queue with this same name and phone number.</p>' +
          '<label>Service time</label>' +
          '<div class="quick-duration-presets">' +
            '<button type="button" data-minutes="5">5 min</button>' +
            '<button type="button" data-minutes="10">10 min</button>' +
            '<button type="button" data-minutes="15">15 min</button>' +
          '</div>' +
          '<input id="quick-service-duration" type="number" min="5" max="120" step="5" value="10" required>' +
          '<label for="quick-service-position">Insert into queue</label>' +
          '<select id="quick-service-position"></select>' +
          '<p class="quick-service-note">Everyone behind this position will automatically receive an updated waiting time.</p>' +
          '<p class="quick-service-error" id="quick-service-error" role="alert"></p>' +
          '<div class="quick-service-actions">' +
            '<button class="quick-service-close" id="quick-service-close" type="button">Cancel</button>' +
            '<button class="quick-service-save" id="quick-service-save" type="submit">Add to Queue</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modal);

    form = document.getElementById("quick-service-form");
    nameInput = document.getElementById("quick-service-name");
    phoneInput = document.getElementById("quick-service-phone");
    durationInput = document.getElementById("quick-service-duration");
    positionSelect = document.getElementById("quick-service-position");
    submitButton = document.getElementById("quick-service-save");
    errorText = document.getElementById("quick-service-error");

    openButton.addEventListener("click", openModal);
    document.getElementById("quick-service-close").addEventListener("click", closeModal);
    form.addEventListener("submit", submitQuickService);
    modal.addEventListener("click", function(event) {
      if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape" && !modal.classList.contains("quick-hidden")) closeModal();
    });
    document.querySelectorAll(".quick-duration-presets button").forEach(function(button) {
      button.addEventListener("click", function() { setDuration(button.dataset.minutes); });
    });
    durationInput.addEventListener("input", function() { setDuration(durationInput.value); });

    wrapRenderer();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", createInterface);
  else createInterface();
})();
