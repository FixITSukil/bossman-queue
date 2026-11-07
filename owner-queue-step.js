/* Owner-only one-place queue swaps. Existing Call, Manage and reports stay intact. */
(function () {
  'use strict';
  function setup() {
    var container = document.getElementById('barbers-container');
    if (!container || !window.OWNER_PIN || !window.DB || typeof window.render !== 'function'
        || document.getElementById('owner-step-help')) return;
    var phase = '', fresh = false, epoch = 0, requestId = 0, acceptedId = 0;
    var lastView = null, lastWorkers = window.ownerWorkers || [], lastAction = null;
    var originalRead = DB.getOwnerView, originalRender = window.render;
    function node(tag, cls, value) {
      var n = document.createElement(tag); if (cls) n.className = cls;
      if (value !== undefined) n.textContent = value; return n;
    }
    var style = node('style');
    style.textContent = '.oq-step-group{display:flex;gap:.4rem;margin-right:auto;flex-wrap:wrap}.oq-step-button{min-height:44px;min-width:72px;padding:.5rem .65rem;background:var(--pine);color:var(--gold-bright);border:1px solid var(--gold);border-radius:.5rem;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}.oq-step-button:disabled{opacity:.4;cursor:default}.oq-step-button:focus-visible{outline:3px solid var(--cream);outline-offset:2px}.oq-step-note{flex:0 0 100%;font-size:.76rem;line-height:1.4;color:var(--gold-bright);margin-top:.25rem;overflow-wrap:anywhere}.oq-step-note:empty{display:none}.oq-step-error{color:#f3b0aa}.oq-step-status{font-size:.8rem;line-height:1.45;color:var(--gold-bright);margin:.5rem 0}.oq-step-status:empty{display:none}';
    document.head.appendChild(style);
    var help = node('p', 'oq-help', 'Use ↑ Up or ↓ Down to swap a waiting customer with the next place. Each tap saves one move; the current service stays unchanged.');
    help.id = 'owner-step-help';
    var status = node('p', 'oq-step-status'); status.id = 'owner-step-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    var toolbar = document.getElementById('owner-queue-tools');
    if (toolbar) { toolbar.appendChild(help); toolbar.appendChild(status); }
    else { container.insertAdjacentElement('beforebegin', help); help.insertAdjacentElement('afterend', status); }
    function waiting(b) {
      return (b.queue || []).filter(function (q) { return q.status === 'waiting'; }).slice().sort(function (a, b) {
        return (Number(a.position) || 0) - (Number(b.position) || 0) || String(a.id).localeCompare(String(b.id));
      });
    }
    function deadline(promise, message) {
      var timer;
      return Promise.race([promise, new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error(message)); }, 12000);
      })]).finally(function () { clearTimeout(timer); });
    }
    function controls() {
      var locked = !!phase || !fresh || navigator.onLine === false;
      container.querySelectorAll('.oq-step-button').forEach(function (button) {
        button.disabled = locked || button.getAttribute('data-boundary') === 'true';
      });
      // Do not allow Manage/Clear to overlap this page's unconfirmed arrow action.
      container.querySelectorAll('.oq-manage,.oq-clear').forEach(function (button) {
        if (phase && !button.disabled) { button.setAttribute('data-step-locked', 'true'); button.disabled = true; }
        else if (!phase && button.getAttribute('data-step-locked') === 'true') {
          button.removeAttribute('data-step-locked'); button.disabled = false;
        }
      });
      container.setAttribute('aria-busy', phase ? 'true' : 'false');
    }
    function show(message, error, entryId) {
      status.textContent = message; status.classList.toggle('oq-step-error', !!error);
      lastAction = { entryId: entryId, text: message, error: !!error };
      container.querySelectorAll('.oq-step-note').forEach(function (n) {
        n.textContent = n.getAttribute('data-entry-id') === entryId ? message : '';
        n.classList.toggle('oq-step-error', !!error);
      });
    }
    // Late pre-move polling responses must not paint the previous queue order again.
    DB.getOwnerView = function () {
      var ticket = ++requestId, atEpoch = epoch;
      return originalRead.apply(DB, arguments).then(function (res) {
        if (atEpoch !== epoch || ticket < acceptedId || phase === 'saving') {
          return lastView || { ok: true, workers: lastWorkers };
        }
        if (res && !res.error && Array.isArray(res.workers)) {
          acceptedId = ticket; lastView = res; lastWorkers = res.workers; fresh = true;
        }
        return res;
      });
    };
    function refreshView() {
      return deadline(DB.getOwnerView(window.OWNER_PIN), 'Could not refresh the queue. Check your connection.').then(function (res) {
        if (!res || res.error || !Array.isArray(res.workers)) throw new Error('Could not refresh the queue. Use the current owner link.');
        window.ownerWorkers = res.workers;
        if (typeof window.renderWorkerManagement === 'function') window.renderWorkerManagement();
        window.render(res.workers);
      });
    }
    function step(b, q, neighbor, direction) {
      if (phase || !fresh || navigator.onLine === false || !neighbor || q.status !== 'waiting') return;
      var modal = document.getElementById('owner-queue-modal');
      if (modal && !modal.classList.contains('oq-hidden')) return;
      phase = 'saving'; fresh = false; epoch++; controls();
      show('Moving ' + (q.customerName || 'customer') + ' ' + direction + '…', false, q.id);
      var data = {
        p_owner_pin: window.OWNER_PIN, p_barber_id: b.id, p_entry_id: q.id,
        p_neighbor_id: neighbor.id, p_direction: direction,
        p_expected_position: Number(q.position), p_expected_neighbor_position: Number(neighbor.position)
      };
      var move = Promise.resolve().then(function () { return sbRpc('owner_queue_step', data); });
      deadline(move, 'Move not confirmed. Check the refreshed order before trying again.').then(function (res) {
        if (!res || res.ok !== true || res.affected !== 2) throw new Error(res && res.error || 'Move not confirmed. Check the queue before trying again.');
        show((q.customerName || 'Customer') + ' moved ' + direction + ' one place. Saved.', false, q.id);
      }).catch(function (error) {
        show(error.message || 'Could not confirm the move. Check the queue before trying again.', true, q.id);
      }).then(function () {
        phase = 'refreshing'; epoch++;
        return refreshView().catch(function () {
          fresh = false;
          show('Could not refresh the queue. The move may already be saved. Refresh and check before moving again.', true, q.id);
        });
      }).finally(function () {
        phase = ''; controls();
        if (fresh) {
          var button = Array.from(container.querySelectorAll('.oq-step-button')).find(function (n) {
            return n.getAttribute('data-entry-id') === q.id && n.getAttribute('data-direction') === direction && !n.disabled;
          });
          if (button) { try { button.focus({ preventScroll: true }); } catch (ignore) {} }
        }
        var history = document.getElementById('owner-queue-history');
        if (history && history.open) history.dispatchEvent(new Event('toggle'));
      });
    }
    function decorate(workers) {
      var cards = container.querySelectorAll('.barber-card');
      (workers || []).forEach(function (b, index) {
        var card = cards[index]; if (!card) return;
        var qs = waiting(b);
        card.querySelectorAll('.queue-row').forEach(function (row, i) {
          var q = qs[i]; if (!q || row.querySelector('.oq-step-group')) return;
          var actions = row.querySelector('.oq-actions');
          if (!actions) { actions = node('div', 'oq-actions'); row.appendChild(actions); }
          var group = node('div', 'oq-step-group');
          ['up', 'down'].forEach(function (direction) {
            var neighbor = qs[i + (direction === 'up' ? -1 : 1)];
            var button = node('button', 'oq-step-button', direction === 'up' ? '↑ Up' : '↓ Down');
            button.type = 'button'; button.setAttribute('data-entry-id', q.id); button.setAttribute('data-direction', direction);
            button.setAttribute('data-boundary', neighbor ? 'false' : 'true');
            button.setAttribute('aria-label', 'Move ' + (q.customerName || 'customer') + ' ' + direction + ' one waiting place');
            button.title = neighbor ? 'Swap places with ' + (neighbor.customerName || 'the next customer') : (direction === 'up' ? 'Already first in the waiting queue' : 'Already last in the waiting queue');
            button.onclick = function () { step(b, q, neighbor, direction); };
            group.appendChild(button);
          });
          actions.insertBefore(group, actions.firstChild);
          var note = node('div', 'oq-step-note'); note.setAttribute('data-entry-id', q.id);
          if (lastAction && lastAction.entryId === q.id) {
            note.textContent = lastAction.text; note.classList.toggle('oq-step-error', lastAction.error);
          }
          row.appendChild(note);
        });
      });
      controls();
    }
    window.render = function (workers) {
      if (phase === 'saving') { window.ownerWorkers = lastWorkers; return; }
      originalRender(workers); decorate(workers);
    };
    decorate(lastWorkers);
    refreshView().catch(function () { fresh = false; show('Refresh the queue to enable Up / Down.', true, null); controls(); });
    window.addEventListener('offline', function () { fresh = false; controls(); });
    window.addEventListener('online', function () {
      if (!phase) refreshView().catch(function () { fresh = false; controls(); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();
