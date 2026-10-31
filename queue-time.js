/* Shared database clock and honest queue countdown. Never writes queue records. */
(function () {
  'use strict';
  if (window.BossmanTiming) return;
  var VERSION = '20261031a';
  var CLOCK_MAX_AGE = 90000, QUEUE_MAX_AGE = 30000;
  var sample = null, pending = null, clockSerial = 0, failed = false;
  var queues = {}, entries = {}, sequence = 0, generation = 0;
  function mono() { return performance.now(); }
  function el(id) { return document.getElementById(id); }
  function text(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function nowMs() {
    if (!sample) return null;
    var elapsed = mono() - sample.at;
    return elapsed >= 0 && elapsed <= CLOCK_MAX_AGE ? sample.utc + elapsed : null;
  }
  function minutesAt(utc) {
    if (utc === null) return null;
    var date = new Date(utc + 480 * 60000);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
  function openState() {
    var minutes = minutesAt(nowMs());
    return minutes === null ? null : minutes >= 660 && minutes < 1366;
  }
  function clockLabel() {
    var utc = nowMs();
    if (utc === null) return failed ? '🕐 Reconnecting to shop time…' : '🕐 Syncing Malaysia time…';
    var date = new Date(utc + 480 * 60000);
    return '🕐 ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds()) + ' MYT';
  }
  function paintClock() {
    var label = clockLabel();
    text(el('clock'), label); text(el('conf-clock'), label);
  }
  function syncClock(force) {
    if (pending && !force) return pending.promise;
    if (pending && pending.controller) pending.controller.abort();
    var serial = ++clockSerial;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var started = mono(), nonce = String(serial) + '-' + Math.random().toString(36).slice(2);
    var options = { method: 'POST', headers: window.SB_HEADERS, cache: 'no-store', body: JSON.stringify({p_nonce: nonce}) };
    if (controller) options.signal = controller.signal;
    var timer;
    var request = fetch(window.SUPABASE_URL + '/rest/v1/rpc/bossman_clock', options).then(function (response) {
      if (!response.ok) throw new Error('clock_http');
      return response.json();
    }).then(function (data) {
      var received = mono(), rtt = received - started;
      if (!data || data.nonce !== nonce || data.timezone !== 'Asia/Kuala_Lumpur' || Number(data.utcOffsetMinutes) !== 480
          || typeof data.serverEpochMs !== 'number' || !isFinite(data.serverEpochMs)
          || data.serverEpochMs < 1577836800000 || data.serverEpochMs > 4102444800000 || rtt < 0 || rtt > 8000) {
        throw new Error('clock_invalid');
      }
      return {utc: data.serverEpochMs + rtt / 2, at: received};
    });
    var job = Promise.race([request, new Promise(function (_, reject) {
      timer = setTimeout(function () { if (controller) controller.abort(); reject(new Error('clock_timeout')); }, 8000);
    })]).then(function (fresh) {
      if (serial === clockSerial) { sample = fresh; failed = false; }
    }).catch(function () {
      if (serial === clockSerial) failed = true;
    }).then(function () {
      clearTimeout(timer);
      if (serial === clockSerial) { pending = null; paint(); }
    });
    pending = {promise: job, controller: controller};
    return job;
  }
  function average(value) { var n = parseInt(value, 10); return n > 0 ? n : 35; }
  function duration(entry, avg) { return average(entry && entry.durationMinutes > 0 ? entry.durationMinutes : avg); }
  function remainingSeconds(serving, avg, utc) {
    if (!serving) return 0;
    var planned = duration(serving, avg) * 60;
    if (typeof utc !== 'number') utc = nowMs();
    var started = Date.parse(serving.calledAt || '');
    if (utc === null || !isFinite(started)) return planned;
    return Math.max(0, Math.ceil(planned - Math.max(0, utc - started) / 1000));
  }
  function timing(queue, avg, utc) {
    queue = Array.isArray(queue) ? queue : [];
    avg = average(avg);
    var waiting = queue.filter(function (q) { return q.status === 'waiting'; }).slice().sort(function (a,b) {
      return (Number(a.position)||0) - (Number(b.position)||0) || String(a.id).localeCompare(String(b.id));
    });
    var serving = queue.find(function (q) { return q.status === 'called'; }) || null;
    var remaining = remainingSeconds(serving, avg, utc);
    var planned = waiting.reduce(function (sum,q) { return sum + duration(q,avg)*60; },0);
    return {avgMinutes:avg,waiting:waiting,serving:serving,waitingCount:waiting.length,
      remainingServiceSeconds:remaining,remainingServiceMinutes:Math.ceil(remaining/60),
      waitingServiceMinutes:planned/60,queueSeconds:remaining+planned,queueMinutes:Math.ceil((remaining+planned)/60)};
  }
  function waitSeconds(id, queue, avg, utc) {
    var t = timing(queue,avg,utc), wait = t.remainingServiceSeconds;
    for (var i=0;i<t.waiting.length;i++) {
      if (t.waiting[i].id === id) return wait;
      wait += duration(t.waiting[i],t.avgMinutes)*60;
    }
    return t.serving && t.serving.id === id ? 0 : null;
  }
  function countdown(seconds) {
    var s = Math.max(0,Math.ceil(seconds));
    return '~' + Math.floor(s/60) + ':' + pad(s%60);
  }
  function current(cache) {
    return cache && mono() - cache.at <= QUEUE_MAX_AGE && mono() >= cache.at && navigator.onLine !== false;
  }
  function readTicket() { return {sequence:++sequence,generation:generation,at:mono()}; }
  function keepQueue(id, data, request) {
    if (!Array.isArray(data) || !id || request.generation !== generation || mono()-request.at > QUEUE_MAX_AGE
        || queues[id] && queues[id].sequence > request.sequence) return;
    queues[id] = {queue:data,at:request.at,sequence:request.sequence};
    setTimeout(paint,0);
  }
  function hookReads() {
    var db = window.DB;
    if (!db) return;
    var getQueue = db.getQueue, getEntry = db.getEntry, getBarberQueue = db.getBarberQueue, getOwner = db.getOwnerView;
    db.getQueue = function (id) {
      var request = readTicket();
      return getQueue.apply(this,arguments).then(function (data) {keepQueue(id,data,request);return data;});
    };
    db.getEntry = function (id) {
      var request = readTicket();
      return getEntry.apply(this,arguments).then(function (data) {
        if (request.generation === generation && (!entries[id] || entries[id].sequence < request.sequence)) {
          entries[id] = {entry:data,at:request.at,sequence:request.sequence};
        }
        setTimeout(paint,0); return data;
      });
    };
    db.getBarberQueue = function () {
      var request = readTicket();
      return getBarberQueue.apply(this,arguments).then(function (data) {
        if (window.barber) keepQueue(window.barber.id,data,request);
        return data;
      });
    };
    db.getOwnerView = function () {
      var request = readTicket();
      return getOwner.apply(this,arguments).then(function (data) {
        if (data && data.ok && Array.isArray(data.workers)) data.workers.forEach(function (b) {keepQueue(b.id,b.queue,request);});
        return data;
      });
    };
  }
  function paintHours() {
    var state = openState(), minutes = minutesAt(nowMs());
    document.documentElement.setAttribute('data-bossman-hours-source',state === null ? 'unconfirmed' : 'database');
    document.documentElement.setAttribute('data-bossman-hours-version',VERSION);
    if (el('hours-closed') && el('barber-list')) {
      el('hours-closed').classList.toggle('hidden',state === true);
      el('barber-list').classList.toggle('hidden',state === false);
      if (state === null) {
        text(el('hours-title'),failed ? 'Could not confirm shop time' : 'Checking shop time…');
        text(el('hours-text'),'You can still try joining. The server checks opening hours; your existing queue is not affected.');
      } else if (!state) {
        text(el('hours-title'),minutes < 660 ? "The queue isn't open yet" : 'The queue is closed for today');
        text(el('hours-text'),'Joining is open from 11:00 AM to 10:45 PM Malaysia time. Existing customers can still reopen their queue.');
        if (el('step-form') && !el('step-form').classList.contains('hidden') && typeof window.showPick === 'function') window.showPick();
      }
    }
    if (el('join-button') && el('join-form')) {
      var b = window.selectedBarber;
      el('join-button').disabled = !!window.joining || !b || !b.isAvailable || state === false || el('join-form').classList.contains('hidden');
      text(el('hours-note'),state === null ? 'Checking shop time; the server will confirm when you join.' : state ? 'Last online join: 10:45 PM MYT.' : 'Online joining opens at 11:00 AM and closes at 10:45 PM MYT.');
    }
  }
  function customerNote() {
    var note = el('queue-countdown-note');
    if (!note && el('conf-stats')) {
      note = document.createElement('p'); note.id='queue-countdown-note';
      note.style.cssText='font-size:.76rem;line-height:1.5;color:var(--cream-dim);margin:.6rem 0;';
      el('conf-stats').insertAdjacentElement('afterend',note);
    }
    return note;
  }
  function paintCustomer() {
    if (!el('conf-wait')) return;
    var note=customerNote(), done=el('step-done'), stats=el('conf-stats');
    var visible=done && !done.classList.contains('hidden') && stats && !stats.classList.contains('hidden') && window.myEntryId;
    if (note) note.style.display=visible?'block':'none';
    if (!visible) return;
    var cache=queues[window.myBarberId], record=entries[window.myEntryId];
    var latest=record && record.entry;
    var value=el('conf-wait'), utc=nowMs();
    value.style.fontVariantNumeric='tabular-nums';
    var label=value.parentNode.querySelector('.stat-label');
    text(label,'Est. wait (min:sec)');
    if (latest && latest.status !== 'waiting' && (!cache || record.sequence >= cache.sequence)) {
      text(value,'Updating…'); text(note,'Refreshing your queue status…'); return;
    }
    if (utc === null || !current(cache)) {
      text(value,utc === null?'Syncing…':'Updating…');
      text(note,'Reconnecting to live queue timing. Your place is unchanged.'); return;
    }
    var avg=window.selectedBarber && window.selectedBarber.avgMinutes || 35;
    var t=timing(cache.queue,avg,utc), seconds=waitSeconds(window.myEntryId,cache.queue,avg,utc);
    if (seconds === null) {text(value,'Updating…');text(note,'Refreshing your queue position…');return;}
    if (!t.serving && seconds === 0) {
      text(value,"You're next");text(note,'Please wait for your barber to call you.');return;
    }
    text(value,countdown(seconds));
    if (!t.serving || !isFinite(Date.parse(t.serving.calledAt || ''))) {
      text(note,'Waiting for the barber to start the next customer. The countdown resumes when service starts.');
    } else if (t.remainingServiceSeconds === 0) {
      text(note,'The current service is over its estimated time. Waiting for the barber to finish; your turn is not confirmed yet.');
    } else {
      text(note,'Live estimate, updated every second. It may change when a service runs longer or the queue changes.');
    }
  }
  function paintStaff() {
    if (nowMs() === null) return;
    if (window.barber && el('stat-wait') && current(queues[window.barber.id])) {
      var q=Array.isArray(window.latestQueue)?window.latestQueue:queues[window.barber.id].queue;
      var t=timing(q,window.barber.avgMinutes);
      text(el('stat-wait'),'~'+t.queueMinutes+'m');
      document.querySelectorAll('#queue-list .queue-item .queue-phone').forEach(function (node,i) {
        if (t.waiting[i]) text(node,'~'+Math.ceil(waitSeconds(t.waiting[i].id,q,t.avgMinutes)/60)+' min wait · '+(t.waiting[i].phone||''));
      });
    }
    if (Array.isArray(window.ownerWorkers) && el('barbers-container')) {
      var cards=el('barbers-container').querySelectorAll('.barber-card');
      window.ownerWorkers.forEach(function (b,index) {
        if (!cards[index] || !current(queues[b.id])) return;
        var t=timing(b.queue,b.avgMinutes);
        text(cards[index].querySelector('.barber-meta'),t.waitingCount+' waiting · ~'+t.queueMinutes+' min queue');
        cards[index].querySelectorAll('.q-wait').forEach(function (node,i) {
          if (t.waiting[i]) text(node,'~'+Math.ceil(waitSeconds(t.waiting[i].id,b.queue,b.avgMinutes)/60)+' min');
        });
      });
    }
  }
  function paint() {paintClock();paintHours();paintCustomer();paintStaff();}
  function recheck() {
    if (document.hidden) return;
    sample=null;generation++;queues={};entries={}; paint();syncClock(true);
    if (window.myEntryId && typeof window.refreshPosition==='function') window.refreshPosition();
    else if (el('barbers-container') && typeof window.loadAll==='function') window.loadAll();
    else if (el('barber-name') && typeof window.loadQueue==='function') window.loadQueue();
    else if (el('join-form') && typeof window.refreshAvailability==='function') window.refreshAvailability();
  }
  function setup() {
    hookReads();
    window.bossmanAverageMinutes=average;
    window.bossmanRemainingServiceMinutes=function (q,avg,utc) {return Math.ceil(remainingSeconds(q,avg,utc)/60);};
    window.bossmanQueueTiming=timing;
    window.bossmanWaitForEntry=function (id,q,avg,utc) {var s=waitSeconds(id,q,avg,utc);return s===null?null:Math.ceil(s/60);};
    window.malaysiaMinutes=function () {return minutesAt(nowMs());};
    window.joiningOpen=function () {return openState()!==false;};
    if (el('hours-closed')) window.updateHoursUI=function () {paintClock();paintHours();};
    if (el('join-button')) window.updateButton=paintHours;
    window.tickClock=function () {paintClock();paintHours();};
    // Previously registered intervals may still hold the old tickClock callback.
    // Guard against those callbacks overwriting database time with device time.
    ['clock','conf-clock'].forEach(function (id) {
      if (el(id)) new MutationObserver(paintClock).observe(el(id),{childList:true,characterData:true,subtree:true});
    });
    if (el('conf-wait')) new MutationObserver(paintCustomer).observe(el('conf-wait'),{childList:true,characterData:true,subtree:true});
    window.bossmanHoursDiagnostics=function () {return {version:VERSION,source:nowMs()===null?'unconfirmed':'database',serverNowMs:nowMs(),open:openState()};};
    // Remote joining must include planned short-service durations too.
    if (el('join-form')) window.queueSummary=function (b) {
      var q=window.queueSnapshot && window.queueSnapshot[b.id];
      if (!Array.isArray(q)) return 'Checking queue…';
      var t=timing(q,b.avgMinutes);
      return t.waitingCount+' waiting · '+(t.queueMinutes?'about '+t.queueMinutes+' min':t.serving?'finishing current service':'no wait');
    };
    paint();syncClock();
    setInterval(function () {if(!document.hidden)paint();},1000);
    setInterval(function () {if(!document.hidden)syncClock();},30000);
    document.addEventListener('visibilitychange',recheck);
    window.addEventListener('pageshow',recheck);window.addEventListener('focus',recheck);window.addEventListener('online',recheck);
    window.addEventListener('offline',function () {generation++;queues={};paint();});
    if (window.myEntryId && typeof window.refreshPosition==='function') window.refreshPosition();
    window.dispatchEvent(new CustomEvent('bossman:timing-ready'));
  }
  window.BossmanTiming={version:VERSION,nowMs:nowMs,syncClock:syncClock,queueTiming:timing,waitSeconds:waitSeconds,formatCountdown:countdown,minutesAt:minutesAt};
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup);else setup();
})();
