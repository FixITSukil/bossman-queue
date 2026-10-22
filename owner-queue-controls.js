/* Bossman owner queue management. No credentials are stored in this file. */
(function () {
  'use strict';
  var labels = {move:'Move / reorder',complete:'Mark completed',no_show:'Mark no-show',cancel:'Remove from queue',return_waiting:'Return to waiting',duration:'Adjust service duration',start:'Call & start',clear_waiting:'Clear waiting customers',clear_all:'Clear entire active queue'};
  function el(id) { return document.getElementById(id); }
  function node(tag, cls, text) { var n=document.createElement(tag); if(cls)n.className=cls; if(text!=null)n.textContent=text; return n; }
  function option(select,value,text) { var o=node('option','',text); o.value=value; select.appendChild(o); }
  function snapshot(q,b) { return {barberId:b.id,status:q.status,position:q.position,durationMinutes:q.durationMinutes||0,calledAt:q.calledAt||null}; }
  function waiting(b) { return (b.queue||[]).filter(function(q){return q.status==='waiting';}).slice().sort(function(a,b){return a.position-b.position;}); }

  // Follow owner transfers using the SAME entry ID and original private token.
  // This also works for read-only Find My Queue sessions; it grants no new rights.
  function setupCustomer() {
    if (!el('step-done') || !window.DB || DB.__ownerFollowInstalled) return;
    DB.__ownerFollowInstalled=true;
    var original=DB.getEntry;
    var sequence=0;
    DB.getEntry=function(id) {
      var request=++sequence;
      return original.call(DB,id).then(function(entry) {
        if(!entry || id!==window.myEntryId || request!==sequence) return entry;
        if(entry.status==='waiting') {
          try { if(localStorage.getItem('bossman_turn_local_notified')===String(id)) localStorage.removeItem('bossman_turn_local_notified'); } catch(ignore) {}
        }
        if(!entry.barberId || entry.barberId===window.myBarberId) return entry;
        return DB.getBarbers().then(function(workers) {
          if(id!==window.myEntryId || request!==sequence) return entry;
          var b=workers.find(function(w){return w.id===entry.barberId;});
          window.myBarberId=entry.barberId;
          window.selectedBarber=b||{id:entry.barberId,name:'Assigned barber',avgMinutes:35};
          if(typeof window.saveEntry==='function') window.saveEntry(window.selectedBarber);
          if(el('conf-barber')) el('conf-barber').textContent=window.selectedBarber.name+(window.myFacialEntryId?' + Facial':'');
          window.dispatchEvent(new CustomEvent('bossman:queue-transferred',{detail:{entryId:id,barberId:entry.barberId}}));
          return entry;
        });
      });
    };
    var cancellation=document.querySelector('#cancel-box p');
    if(cancellation && cancellation.firstChild && cancellation.firstChild.nodeType===3) {
      cancellation.firstChild.textContent="We're sorry, Bossman staff have cancelled your queue entry. Please WhatsApp or call Bossman at ";
    }
  }

  function setupOwner() {
    var container=el('barbers-container');
    if(!container || !window.OWNER_PIN || el('owner-queue-tools')) return;
    var current=null, busy=false, opener=null, oldOverflow='';
    var style=node('style');
    style.textContent='.oq-toolbar{margin:1rem 0;padding:1rem;border:1px solid var(--gold);border-radius:.8rem;background:var(--moss);color:var(--cream)}.oq-toolbar p,.oq-help{font-size:.82rem;line-height:1.5;color:var(--cream-dim);margin:.5rem 0}.oq-manage,.oq-clear{padding:.5rem .7rem;border:1px solid var(--gold);border-radius:.5rem;background:var(--pine);color:var(--gold-bright);font:inherit;font-size:.78rem;cursor:pointer}.oq-clear{margin:.6rem 1rem;color:#f3b0aa;border-color:var(--line)}.oq-row{flex-wrap:wrap;gap:.55rem}.oq-row>div{min-width:0;overflow-wrap:anywhere}.oq-manage{margin-left:auto}.oq-overlay{position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.76);display:flex;align-items:center;justify-content:center;padding:1rem}.oq-hidden{display:none!important}.oq-dialog{background:var(--moss);color:var(--cream);border:1px solid var(--gold);border-radius:1rem;width:100%;max-width:430px;max-height:90vh;overflow:auto;padding:1.3rem;box-sizing:border-box}.oq-dialog h2{font-family:var(--serif);margin:0 0 .5rem}.oq-dialog label{display:block;margin:.8rem 0 .35rem;font-size:.82rem}.oq-dialog input,.oq-dialog select{box-sizing:border-box;width:100%;min-height:44px;background:var(--pine);color:var(--cream);border:1px solid var(--fern);border-radius:.5rem;padding:.65rem;font:inherit;font-size:16px}.oq-dialog select{white-space:normal}.oq-buttons{display:flex;gap:.6rem;margin-top:1rem}.oq-buttons button{flex:1;padding:.8rem;border-radius:.55rem;font:inherit;cursor:pointer}.oq-save{background:var(--gold);color:var(--pine);border:0;font-weight:bold}.oq-close{background:var(--pine);color:var(--cream);border:1px solid var(--line)}.oq-dialog button:disabled{opacity:.55;cursor:wait}.oq-error{color:#f3b0aa;font-size:.82rem;line-height:1.5;margin-top:.7rem}.oq-status{color:var(--gold-bright);font-size:.86rem;line-height:1.5}.oq-history{margin:1rem 0;padding:1rem;background:var(--moss);border:1px solid var(--line);border-radius:.8rem;color:var(--cream)}.oq-history summary{cursor:pointer;color:var(--gold-bright)}.oq-history-item{padding:.65rem 0;border-bottom:1px solid var(--line);font-size:.8rem;line-height:1.5;overflow-wrap:anywhere}.oq-history-item small{display:block;color:var(--cream-dim)}';
    document.head.appendChild(style);
    var toolbar=node('section','oq-toolbar'); toolbar.id='owner-queue-tools';
    toolbar.appendChild(node('strong','','Owner queue controls'));
    toolbar.appendChild(node('p','','Use Manage beside a customer to fix missed completions, move them or adjust their service time. Removing a booking preserves its history.'));
    var message=node('p','oq-status'); message.id='owner-queue-message'; message.setAttribute('role','status'); toolbar.appendChild(message);
    container.insertAdjacentElement('beforebegin',toolbar);
    var history=node('details','oq-history'); history.id='owner-queue-history';
    history.appendChild(node('summary','','Recent owner changes'));
    var historyList=node('div'); history.appendChild(historyList); container.insertAdjacentElement('afterend',history);
    history.addEventListener('toggle',function(){if(history.open)loadHistory();});
    var overlay=node('div','oq-overlay oq-hidden'); overlay.id='owner-queue-modal';
    overlay.innerHTML='<div class="oq-dialog" role="dialog" aria-modal="true" aria-labelledby="oq-title"><h2 id="oq-title"></h2><p class="oq-help" id="oq-context"></p><form id="oq-form"><label for="oq-action">Action</label><select id="oq-action"></select><p class="oq-help" id="oq-description"></p><div id="oq-move"><label for="oq-barber">Barber</label><select id="oq-barber"></select><label for="oq-position">Place in waiting queue</label><select id="oq-position"></select></div><div id="oq-time"><label for="oq-minutes">Total service duration (minutes)</label><input id="oq-minutes" type="number" min="5" max="240" step="1"><p class="oq-help">For a service already started, this is the total time from the original start, not extra minutes from now.</p></div><label for="oq-reason">Reason / note</label><input id="oq-reason" maxlength="240" minlength="3" required autocomplete="off"><div id="oq-clear-confirm"><label for="oq-confirm">Type CLEAR to confirm</label><input id="oq-confirm" autocomplete="off" autocapitalize="characters"></div><p class="oq-error" id="oq-error" role="alert"></p><div class="oq-buttons"><button class="oq-close" id="oq-close" type="button">Back</button><button class="oq-save" id="oq-save" type="submit">Save change</button></div></form></div>';
    document.body.appendChild(overlay);
    function hide(id,yes) { el(id).classList.toggle('oq-hidden',!!yes); }
    function worker(id) { return (window.ownerWorkers||[]).find(function(w){return w.id===id;}); }
    function open() {
      opener=document.activeElement; oldOverflow=document.body.style.overflow;
      document.body.style.overflow='hidden'; el('oq-error').textContent=''; el('oq-confirm').value='';
      overlay.classList.remove('oq-hidden'); el('oq-action').focus();
    }
    function close() {
      if(busy)return; overlay.classList.add('oq-hidden'); document.body.style.overflow=oldOverflow; current=null;
      if(opener && document.contains(opener))opener.focus();
    }
    function positions() {
      var list=el('oq-position'); list.textContent='';
      var b=worker(el('oq-barber').value); var qs=b?waiting(b).filter(function(q){return q.id!==current.entry.id;}):[];
      qs.forEach(function(q,i){option(list,q.id,(i===0?'Front — before ':'Before ')+(q.customerName||'Customer'));});
      option(list,'','End of waiting queue');
      list.value='';
      if(b && b.id===current.barber.id) {
        var next=qs.find(function(q){return q.position>current.entry.position;});
        list.value=next?next.id:'';
      }
    }
    var descriptions={
      move:'Choose a barber and position. This keeps the same booking and customer link. The person currently being served is not interrupted.',
      complete:'Only use this if the service was actually finished. It counts as served and allows the customer page to show the review button.',
      no_show:'The customer did not turn up. Their live place ends; this does not count as a completed haircut.',
      cancel:'Remove this booking from the live queue. Its history stays and it is not counted as served.',
      return_waiting:'Correct an accidental call. The customer returns to waiting; complete any active service before calling the next person.',
      duration:'Update the estimate used by all queue screens. This does not reset the service start time.',
      start:'Call the first waiting customer and start their timer. An enabled turn alert may notify them. No second service can start while another is active.'
    };
    var reasons={move:'Owner adjusted queue order / barber',complete:'Owner corrected a missed completion',no_show:'Owner confirmed customer did not attend',cancel:'Owner removed an abandoned booking',return_waiting:'Owner corrected an accidental call',duration:'Owner corrected service duration',start:'Owner called next customer',clear_waiting:'Owner cleared abandoned waiting entries',clear_all:'Owner cleared this active queue'};
    function actionChanged() {
      var a=el('oq-action').value;
      hide('oq-move',a!=='move'); hide('oq-time',a!=='duration' && a!=='start');
      hide('oq-clear-confirm',!current.bulk);
      el('oq-minutes').required=a==='duration'||a==='start'; el('oq-confirm').required=current.bulk;
      el('oq-reason').value=reasons[a]||'Owner queue correction';
      if(current.bulk) {
        var qs=current.barber.queue.filter(function(q){return q.status==='waiting'||(a==='clear_all'&&q.status==='called');});
        el('oq-description').textContent='This will cancel '+qs.length+' '+(a==='clear_all'?'active':'waiting')+' booking(s) for '+current.barber.name+'. '+(a==='clear_waiting'?'The current service is kept. ':'The current service is also cancelled. ')+'History is retained. No booking is marked completed.';
      } else el('oq-description').textContent=descriptions[a]||'';
      el('oq-save').textContent=current.bulk?'Clear selected queue':'Confirm change';
    }
    function manage(b,q) {
      if(busy)return;
      current={bulk:false,barber:JSON.parse(JSON.stringify(b)),entry:JSON.parse(JSON.stringify(q)),expected:snapshot(q,b)};
      el('oq-title').textContent='Manage '+(q.customerName||'customer');
      el('oq-context').textContent=b.name+' · '+(q.status==='called'?'Currently called / serving':'Waiting');
      var a=el('oq-action'); a.textContent='';
      (q.status==='waiting'?['move','complete','no_show','cancel','duration','start']:['complete','no_show','cancel','return_waiting','duration']).forEach(function(key){option(a,key,labels[key]);});
      var dest=el('oq-barber'); dest.textContent='';
      (window.ownerWorkers||[]).filter(function(w){return w.id===b.id||(w.role===b.role&&w.isAvailable);}).forEach(function(w){option(dest,w.id,w.name+(w.id===b.id?' (current)':''));});
      dest.value=b.id; positions(); el('oq-minutes').value=q.durationMinutes>0?q.durationMinutes:b.avgMinutes||35;
      actionChanged(); open();
    }
    function clearQueue(b) {
      if(busy)return;
      current={bulk:true,barber:JSON.parse(JSON.stringify(b))};
      el('oq-title').textContent='Clear '+b.name+' queue'; el('oq-context').textContent='Review carefully. This is a cancellation, not a completion.';
      var a=el('oq-action'); a.textContent=''; option(a,'clear_waiting',labels.clear_waiting); option(a,'clear_all',labels.clear_all);
      actionChanged(); open();
    }
    function decorate(workers) {
      var cards=container.querySelectorAll('.barber-card');
      (workers||[]).forEach(function(b,index) {
        var card=cards[index]; if(!card || card.querySelector('[data-owner-controls]'))return;
        var marker=node('span'); marker.setAttribute('data-owner-controls','true'); marker.style.display='none'; card.appendChild(marker);
        var qs=waiting(b), serving=(b.queue||[]).find(function(q){return q.status==='called';});
        var servingRow=card.querySelector('.serving-row');
        if(serving&&servingRow) addManage(servingRow,b,serving);
        card.querySelectorAll('.queue-row').forEach(function(row,i){if(qs[i])addManage(row,b,qs[i]);});
        if((b.queue||[]).length) {
          var clear=node('button','oq-clear','Clear queue…'); clear.type='button'; clear.onclick=function(){clearQueue(b);}; card.appendChild(clear);
        }
      });
    }
    function addManage(row,b,q) {
      row.classList.add('oq-row');
      var button=node('button','oq-manage','Manage'); button.type='button';
      button.setAttribute('aria-label','Manage '+(q.customerName||'customer'));
      button.onclick=function(){manage(b,q);}; row.appendChild(button);
    }
    function loadHistory() {
      sbRpc('owner_queue_history',{p_owner_pin:window.OWNER_PIN}).then(function(r){
        if(!r || !r.ok)throw new Error(r&&r.error||'Could not load owner changes.');
        historyList.textContent='';
        if(!r.changes.length) {historyList.appendChild(node('p','oq-help','No owner queue changes recorded yet.')); return;}
        r.changes.forEach(function(change){
          var row=node('div','oq-history-item',(labels[change.action]||change.action)+' · '+(change.customer_name||'Customer'));
          var before=change.previous_state||{}, after=change.next_state||{};
          var time=new Date(change.created_at).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'});
          row.appendChild(node('small','',time+' MYT · '+(before.barberName||'')+(before.barberId!==after.barberId?' → '+(after.barberName||''):'')));
          row.appendChild(node('small','',change.reason)); historyList.appendChild(row);
        });
      }).catch(function(e){historyList.textContent=e.message;});
    }
    function refresh() {
      if(typeof window.loadAll==='function')window.loadAll();
      if(typeof window.loadStats==='function')window.loadStats();
      if(typeof window.loadOwnerBookings==='function')window.loadOwnerBookings();
      if(history.open)loadHistory();
    }
    el('oq-action').onchange=actionChanged; el('oq-barber').onchange=positions; el('oq-close').onclick=close;
    overlay.onclick=function(e){if(e.target===overlay)close();};
    overlay.addEventListener('keydown',function(e){
      if(e.key==='Escape') {e.preventDefault(); close();}
      if(e.key==='Tab') {
        var focus=Array.from(overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter(function(n){return n.offsetParent!==null;});
        if(!focus.length)return;
        if(e.shiftKey&&document.activeElement===focus[0]) {e.preventDefault();focus[focus.length-1].focus();}
        else if(!e.shiftKey&&document.activeElement===focus[focus.length-1]) {e.preventDefault();focus[0].focus();}
      }
    });
    el('oq-form').onsubmit=function(event){
      event.preventDefault(); if(busy||!current)return;
      var action=el('oq-action').value;
      var data={p_owner_pin:window.OWNER_PIN,p_action:action,p_reason:el('oq-reason').value.trim()};
      if(data.p_reason.length<3){el('oq-error').textContent='Please enter a reason.';return;}
      if(current.bulk) {
        if(el('oq-confirm').value.trim()!=='CLEAR'){el('oq-error').textContent='Type CLEAR to confirm.';return;}
        data.p_target_barber_id=current.barber.id;
        data.p_queue_snapshot=current.barber.queue.filter(function(q){return q.status==='waiting'||(action==='clear_all'&&q.status==='called');}).map(function(q){return {id:q.id,status:q.status};});
        if(!data.p_queue_snapshot.length){el('oq-error').textContent='There are no matching customers to clear.';return;}
      } else {
        data.p_entry_id=current.entry.id; data.p_expected=current.expected;
        if(action==='move'){data.p_target_barber_id=el('oq-barber').value; data.p_before_entry_id=el('oq-position').value||null;}
        if(action==='start'||action==='duration') {
          data.p_minutes=Number(el('oq-minutes').value);
          if(!Number.isInteger(data.p_minutes)||data.p_minutes<5||data.p_minutes>240){el('oq-error').textContent='Enter 5–240 whole minutes.';return;}
        }
        if(!window.confirm((labels[action]||action)+' for '+current.entry.customerName+'?\n\n'+el('oq-description').textContent))return;
      }
      busy=true; el('oq-error').textContent=''; el('oq-save').disabled=true; el('oq-close').disabled=true; el('oq-save').textContent='Saving…';
      var timer;
      Promise.race([sbRpc('owner_queue_action',data),new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error('No confirmation received. Refresh and check the queue before trying again; the change may already be saved.'));},15000);})])
      .then(function(r){
        if(!r||!r.ok)throw new Error(r&&r.error||'Could not save this change.');
        busy=false; close(); message.textContent=(labels[action]||action)+' saved. '+r.affected+' booking(s) updated.';
        refresh();
      }).catch(function(e){el('oq-error').textContent=e.message||'Could not save. Check the queue before retrying.';refresh();})
      .finally(function(){clearTimeout(timer);busy=false;el('oq-save').disabled=false;el('oq-close').disabled=false;el('oq-save').textContent='Confirm change';});
    };
    var originalRender=window.render;
    if(typeof originalRender==='function')window.render=function(workers){originalRender(workers);decorate(workers);};
    decorate(window.ownerWorkers||[]);
  }
  function setup(){setupCustomer();setupOwner();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
