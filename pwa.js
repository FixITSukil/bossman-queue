(function() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function() {
      navigator.serviceWorker.register("./service-worker.js").catch(function() {});
    });
  }

  // Recovery is loaded only after its Supabase RPC has been deployed.
  window.addEventListener("load", function() {
    if (document.getElementById("bossman-recovery-loader")) return;
    var script = document.createElement("script");
    script.id = "bossman-recovery-loader";
    script.src = "recovery-loader.js?v=20261017a";
    document.body.appendChild(script);
  });

  // Turn alerts are available after the customer joins a live queue.
  window.addEventListener("load", function() {
    if (document.getElementById("bossman-turn-alerts")) return;
    var script = document.createElement("script");
    script.id = "bossman-turn-alerts";
    script.src = "turn-alerts.js?v=20261017a";
    document.body.appendChild(script);
  });

  // Waiting customers can compare live queues and securely change barber.
  window.addEventListener("load", function() {
    if (document.getElementById("bossman-switch-barber")) return;
    var script = document.createElement("script");
    script.id = "bossman-switch-barber";
    script.src = "switch-barber.js?v=20261017a";
    document.body.appendChild(script);
  });

  var card = document.getElementById("install-card");
  var button = document.getElementById("install-button");
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
    promptEvent.userChoice.finally(function() {
      promptEvent = null;
      button.classList.add("hidden");
    });
  });
  window.addEventListener("appinstalled", function() { card.classList.add("hidden"); });
})();
