(function () {
  'use strict';
  function element(id) { return document.getElementById(id); }
  function loadScript(id, path) {
    if (element(id)) return;
    var script = document.createElement('script');
    script.id = id;
    script.src = path;
    document.body.appendChild(script);
  }
  function setup() {
    // During script loading, unknown hours must not be treated as closed.
    // Both join RPCs still enforce the actual business hours on submission.
    if (!window.BossmanTiming) {
      window.joiningOpen = function () { return true; };
      window.malaysiaMinutes = function () { return null; };
      if (element('hours-closed')) window.updateHoursUI = function () {
        element('hours-closed').classList.remove('hidden');
        element('barber-list').classList.remove('hidden');
        element('hours-title').textContent = 'Checking shop time…';
        element('hours-text').textContent = 'Using Malaysia time from the queue server. Existing customers can still reopen their queue.';
        ['clock', 'conf-clock'].forEach(function (id) {
          if (element(id)) element(id).textContent = '🕐 Syncing Malaysia time…';
        });
      };
    }
    loadScript('bossman-queue-time', 'queue-time.js?v=20261031a');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js', {updateViaCache: 'none'}).then(function (registration) {
        registration.update().catch(function () {});
      }).catch(function () {});
    }
    if (element('step-pick')) {
      loadScript('bossman-recovery-loader', 'recovery-loader.js?v=20261017b');
      loadScript('bossman-turn-alerts', 'turn-alerts.js?v=20261017a');
      loadScript('bossman-switch-barber', 'switch-barber.js?v=20261017a');
    }
    var card = element('install-card');
    var button = element('install-button');
    if (!card) return;
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      card.classList.add('hidden');
      return;
    }
    var promptEvent = null;
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      promptEvent = event;
      if (button) button.classList.remove('hidden');
    });
    if (button) button.addEventListener('click', function () {
      if (!promptEvent) return;
      promptEvent.prompt();
      promptEvent.userChoice.then(function () {
        promptEvent = null;
        button.classList.add('hidden');
      }).catch(function () { promptEvent = null; });
    });
    window.addEventListener('appinstalled', function () { card.classList.add('hidden'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
