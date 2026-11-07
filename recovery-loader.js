(function() {
  "use strict";

  function installDuplicateJoinHelper() {
    var error = document.getElementById("form-error");
    if (!error || error.dataset.recoveryObserved === "true") return;
    error.dataset.recoveryObserved = "true";

    function check() {
      var joinForm = document.getElementById("step-form");
      if (error.classList.contains("hidden") || (joinForm && joinForm.classList.contains("hidden"))) return;
      var message = error.textContent || "";
      if (!/already in a queue|joined recently/i.test(message)) return;
      if (typeof window.openBossmanQueueRecovery !== "function") return;
      var name = document.getElementById("inp-name");
      var phone = document.getElementById("inp-phone");
      window.openBossmanQueueRecovery(
        name ? name.value : "",
        phone ? phone.value : ""
      );
    }

    new MutationObserver(check).observe(error, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"]
    });
    check();
  }

  function loadRecoveryWhenAvailable() {
    if (!window.sbRpc || !document.getElementById("step-pick")) return;

    sbRpc("recover_queue_by_phone", { p_phone: "" }).then(function() {
      var existing = document.getElementById("bossman-recovery-script");
      if (existing) {
        installDuplicateJoinHelper();
        return;
      }

      var script = document.createElement("script");
      script.id = "bossman-recovery-script";
      script.src = "recovery.js?v=20261107-phone";
      script.onload = installDuplicateJoinHelper;
      document.body.appendChild(script);
    }).catch(function() {});
  }

  if (document.readyState === "complete") loadRecoveryWhenAvailable();
  else window.addEventListener("load", loadRecoveryWhenAvailable);
})();
