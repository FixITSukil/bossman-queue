(function() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function() {
      navigator.serviceWorker.register("./service-worker.js").catch(function() {});
    });
  }

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
