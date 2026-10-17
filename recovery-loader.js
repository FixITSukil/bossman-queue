(function() {
  "use strict";

  function loadRecoveryWhenAvailable() {
    if (!window.sbRpc || !document.getElementById("step-pick")) return;

    // An invalid empty lookup returns HTTP 200 when the RPC exists. If the
    // migration has not been deployed yet, PostgREST returns an error status
    // and the customer page remains unchanged.
    sbRpc("recover_queue", {
      p_customer_name: "",
      p_phone: ""
    }).then(function() {
      if (document.getElementById("bossman-recovery-script")) return;
      var script = document.createElement("script");
      script.id = "bossman-recovery-script";
      script.src = "recovery.js?v=20261017a";
      document.body.appendChild(script);
    }).catch(function() {});
  }

  if (document.readyState === "complete") loadRecoveryWhenAvailable();
  else window.addEventListener("load", loadRecoveryWhenAvailable);
})();
