(function () {
  "use strict";

  var loading = false;

  function describeBackupStatus(data, nowMs) {
    if (!data.configured) return "Setup incomplete — records are waiting for Google Sheets connection.";
    if (data.lastError || Number(data.failedCount) > 0) return "Needs attention — copying failed. Records remain saved in the database.";
    if (typeof data.pendingCount !== "number" || !isFinite(data.pendingCount) || data.pendingCount < 0 || Math.floor(data.pendingCount) !== data.pendingCount) return "Could not verify the changes waiting to copy. Please refresh this page.";
    var last = Date.parse(data.lastSyncedAt || "");
    if (!isFinite(last)) return "Waiting for the first confirmed copy to Google Sheets.";
    if (!isFinite(nowMs)) return "Copy confirmed — checking the server time for freshness.";
    if (nowMs - last > 180000) return "Sync overdue — records remain saved in the database.";
    if (Number(data.pendingCount) > 0) return "Copying saved changes to Google Sheets…";
    return "Up to date — saved changes have been copied to Google Sheets.";
  }

  function safeSheetUrl(value) {
    try {
      var url = new URL(value);
      return url.protocol === "https:" && url.hostname === "docs.google.com" &&
        /^\/spreadsheets\/d\/[A-Za-z0-9_-]+\//.test(url.pathname) ? url.href : "";
    } catch (error) { return ""; }
  }

  function loadBackupStatus() {
    if (loading || !document.getElementById("backup-status")) return;
    loading = true;
    sbRpc("get_google_sheet_sync_status", { p_owner_pin: OWNER_PIN }).then(function (data) {
      if (!data || !data.ok || data.error) throw new Error("Could not verify recording status.");
      var clock = window.BossmanTiming;
      var nowMs = clock && typeof clock.nowMs === "function" ? clock.nowMs() : NaN;
      document.getElementById("backup-status").textContent = describeBackupStatus(data, typeof nowMs === "number" ? nowMs : NaN);
      var last = Date.parse(data.lastSyncedAt || "");
      document.getElementById("backup-last-sync").textContent = isFinite(last)
        ? "Last confirmed copy: " + new Date(last).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" }) + " MYT"
        : "No successful copy confirmed yet.";
      var pending = Number(data.pendingCount);
      document.getElementById("backup-pending").textContent = isFinite(pending)
        ? "Saved changes waiting to copy: " + pending
        : "Could not verify the number of changes waiting to copy.";
      var link = document.getElementById("backup-sheet-link");
      var url = safeSheetUrl(data.spreadsheetUrl);
      if (url) { link.href = url; link.classList.remove("hidden"); }
      else { link.removeAttribute("href"); link.classList.add("hidden"); }
    }).catch(function () {
      document.getElementById("backup-status").textContent = "Could not verify data recording. Please refresh this page.";
      document.getElementById("backup-pending").textContent = "";
    }).finally(function () { loading = false; });
  }

  window.loadBackupStatus = loadBackupStatus;
  window.bossmanBackupStatusText = describeBackupStatus;
  loadBackupStatus();
  setInterval(loadBackupStatus, 30000);
})();
