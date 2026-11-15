/* Customer visit lifecycle. Read-only server checks; never alters queue rows.
 * Retire only a confirmed terminal receipt on THIS browser. Active, missing and
 * unverified entries are preserved. Also supports older cached customer pages.
 */
(function () {
  'use strict';
  function setup() {
    var done = document.getElementById('step-done');
    var pick = document.getElementById('step-pick');
    if (!done || !pick || !window.DB || window.BossmanVisit) return;
    var KEY = window.STORE_KEY || 'bossman_queue';
    var ended = ['done', 'cancelled_by_customer', 'cancelled_by_barber', 'no_show'];
    var seenActive = Object.create(null), checks = Object.create(null), endedView = false;
    function el(id) { return document.getElementById(id); }
    function hide(id, yes) { var n=el(id); if(n)n.classList.toggle('hidden',!!yes); }
    function text(id, value) { var n=el(id); if(n)n.textContent=value; }
    function readSaved() {
      var raw=localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    }
    function owns(id) {
      if (!id || window.myEntryId !== id) return false;
      try { var saved=readSaved(); return !saved || saved.entryId===id; }
      catch (error) { return false; }
    }
    function active(entry) { return entry && (entry.status==='waiting' || entry.status==='called'); }
    function terminal(entry) { return entry && !entry.error && ended.indexOf(entry.status)!==-1; }
    function note(message) {
      var n=el('visit-status-note');
      if(!n) { n=document.createElement('p');n.id='visit-status-note';n.setAttribute('role','status');n.style.cssText='font-size:.85rem;line-height:1.5;color:var(--cream-dim);margin:1rem 0;';done.querySelector('.panel').appendChild(n); }
      n.textContent=message;
    }
    function resetViewMarkers() {
      endedView=false;done.removeAttribute('data-visit-ended');
      hide('new-visit-button',true);hide('visit-return-note',true);
      var n=el('visit-status-note');if(n)n.textContent='';
    }
    function showPicker() {
      window.showPick();
      var n=el('visit-return-note');
      if(!n) {n=document.createElement('p');n.id='visit-return-note';n.setAttribute('role','status');n.style.cssText='font-size:.85rem;line-height:1.5;color:var(--cream);padding:.85rem;margin-top:1rem;border:1px solid var(--line);border-radius:.65rem;';pick.insertBefore(n,el('barber-list'));}
      n.textContent='Welcome back. Your previous queue entry has ended. Choose a barber to join a new queue.';
      n.classList.remove('hidden');
      if(typeof window.loadBarbers==='function')window.loadBarbers();
    }
    function release(id) {
      if(!owns(id))return false;
      try {
        var saved=readSaved();
        if(saved && saved.entryId===id)localStorage.removeItem(KEY);
        localStorage.removeItem('bossman_last_join');
        ['bossman_turn_alert_entry','bossman_turn_local_notified'].forEach(function(key){
          if(localStorage.getItem(key)===String(id))localStorage.removeItem(key);
        });
      } catch(error) {note('Your visit has ended, but this browser could not release the saved link. Please ask staff for help.');return false;}
      if(window.refreshInterval)clearInterval(window.refreshInterval);
      window.refreshInterval=null;
      window.myEntryId=null;window.myCancelToken=null;window.myBarberId=null;
      window.myFacialEntryId=null;window.myFacialCancelToken=null;window.myFacialBarberId=null;
      window.queueEntryMissing=false;
      done.setAttribute('data-visit-ended','true');endedView=true;
      hide('replace-missing-booking',true);
      window.dispatchEvent(new CustomEvent('bossman:visit-ended',{detail:{entryId:id}}));
      return true;
    }
    function renderEnded(status) {
      hide('step-pick',true);hide('step-form',true);hide('step-done',false);
      ['conf-badge','conf-stats','conf-refresh','btn-leave','replace-missing-booking'].forEach(function(id){hide(id,true);});
      hide('review-box',status!=='done');hide('cancel-box',status!=='cancelled_by_barber');
      // A single safe restart button below replaces the old self-cancel restart.
      hide('self-cancel-box',true);
      text('conf-icon',status==='done'?'✨':status==='cancelled_by_barber'?'💬':'👋');
      text('conf-title',status==='done'?'Thanks for visiting Bossman!':status==='no_show'?'Your queue entry has ended':'Your queue entry was cancelled');
      note('This queue entry has ended. You can join a new queue for a new visit.');
      var button=el('new-visit-button');
      if(!button){button=document.createElement('button');button.id='new-visit-button';button.type='button';button.className='btn-gold btn-full';button.style.marginTop='1rem';button.textContent='Join a new queue';button.onclick=function(){
        // Reload follows a newer booking saved in another tab; never erase it.
        window.location.reload();
      };done.querySelector('.panel').appendChild(button);}
      button.classList.remove('hidden');
    }
    function followLinked(id, linked, saved) {
      return DB.getBarbers().then(function(workers){
        if(!owns(id))return;
        var b=(workers||[]).find(function(w){return w.id===linked.barberId;});
        if(!b){note('Your other service is still active. Please ask staff to help reopen it.');return;}
        window.myEntryId=linked.id;window.myBarberId=linked.barberId;
        window.myCancelToken=saved && saved.facialCancelToken || window.myFacialCancelToken || null;
        window.myFacialEntryId=null;window.myFacialCancelToken=null;window.myFacialBarberId=null;
        window.selectedBarber=b;
        window.saveEntry(b);window.syncCancelButton();text('conf-barber',b.name);
        if(typeof window.resetCustomerStatePanels==='function')window.resetCustomerStatePanels();
        window.refreshPosition();
        if(window.refreshInterval)clearInterval(window.refreshInterval);
        window.refreshInterval=setInterval(window.refreshPosition,10000);
      });
    }
    function settle(mode) {
      var id=window.myEntryId;
      if(!owns(id))return Promise.resolve();
      if(checks[id]) {if(mode==='resume')checks[id].resume=true;return checks[id].promise;}
      var job={resume:mode==='resume'||!seenActive[id],promise:null};checks[id]=job;
      job.promise=Promise.resolve().then(function(){return DB.getEntry(id);}).then(function(entry){
        if(!owns(id) || !terminal(entry) || entry.id!==id)return;
        var saved=readSaved(), linkedId=window.myFacialEntryId || saved && saved.facialEntryId;
        if(linkedId && linkedId!==id){
          return DB.getEntry(linkedId).then(function(linked){
            if(!owns(id))return;
            if(active(linked) && linked.id===linkedId)return followLinked(id,linked,saved);
            if(!terminal(linked) || linked.id!==linkedId){note('Your other saved service could not be confirmed. Please ask staff before joining again.');return;}
            if(release(id)){if(job.resume)showPicker();else renderEnded(entry.status);}
          });
        }
        if(release(id)){if(job.resume)showPicker();else renderEnded(entry.status);}
      }).catch(function(){
        // A failed read is NOT proof the visit has ended. Keep its receipt.
        if(owns(id))note('Could not confirm the latest queue status. Your saved booking is unchanged. Please refresh or ask staff.');
      }).finally(function(){delete checks[id];});
      return job.promise;
    }
    // Check identity before delivering asynchronous reads to legacy presenters.
    var originalRead=DB.getEntry;
    DB.getEntry=function(id){
      var wasCurrent=window.myEntryId===id;
      return originalRead.apply(this,arguments).then(function(entry){
        if(wasCurrent && window.myEntryId!==id)throw new Error('A newer customer session is open.');
        if(entry && (entry.error || entry.id!==id))throw new Error('Queue identity could not be verified.');
        if(wasCurrent && active(entry))seenActive[id]=true;
        return entry;
      });
    };
    ['showBarberCancelled','showCustomerCancelled','showQueueEnded','showReviewComplete'].forEach(function(name){
      if(typeof window[name]==='function')window[name]=function(){return settle('live');};
    });
    var originalSave=window.saveEntry;
    if(typeof originalSave==='function')window.saveEntry=function(){
      var result=originalSave.apply(this,arguments);
      if(window.myEntryId)seenActive[window.myEntryId]=true;
      resetViewMarkers();return result;
    };
    var style=document.createElement('style');
    style.textContent='#step-done[data-visit-ended="true"] #turn-alert-box{display:none!important}';
    document.head.appendChild(style);
    function revisit(){
      if(document.hidden)return;
      if(endedView && !window.myEntryId){
        // Another tab may hold a new active receipt; let the existing resume flow read it.
        try {if(readSaved()){window.resumeEntry();return;}}catch(ignore){return;}
        showPicker();return;
      }
      settle('resume');
    }
    window.BossmanVisit={version:'20261115-return-visit',check:function(){return settle('resume');}};
    window.addEventListener('pageshow',function(event){if(event.persisted)revisit();});
    window.addEventListener('online',function(){if(!document.hidden && !endedView)settle('resume');});
    // Startup also handles an old cancellation screen rendered before this module loaded.
    settle('resume');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
