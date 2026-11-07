const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const recoverySource = fs.readFileSync(path.join(root, 'recovery.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'recovery-loader.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function entry(id, name = 'Test Customer', barber = 'Jalal', role = 'barber') {
  return {id,customerName:name,barberId:barber.toLowerCase(),barberName:barber,status:'waiting',position:15,durationMinutes:0,calledAt:null,role,avgMinutes:35};
}
function match(id, entries = [entry(id)]) { return {matchId:id,customerName:entries[0].customerName,entries}; }
function fixture(result) {
  const nodes = new Map(), state = {calls:[],saved:[],events:[],observers:[],result,refreshes:0,intervals:[]};
  class Element {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.classes=new Set();this.listeners={};this.dataset={};this.style={};this.value='';this.disabled=false;this._text='';}
    set id(value){this._id=value;nodes.set(value,this);} get id(){return this._id;}
    set className(value){this.classes=new Set(String(value).split(/\s+/).filter(Boolean));} get className(){return [...this.classes].join(' ');}
    get classList(){return {add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),contains:c=>this.classes.has(c)};}
    set textContent(value){this._text=String(value);this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set innerHTML(value){
      this.markup=value;
      for(const found of value.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const child=new Element(found[1]);child.id=found[3];
        const classes=found[2].match(/\bclass="([^"]*)"/);if(classes)child.className=classes[1];
        this.children.push(child);
      }
    }
    appendChild(node){this.children.push(node);return node;}
    insertAdjacentElement(where,node){this.children.push(node);return node;}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    fire(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){},...event});}
    querySelector(selector){return this.children.find(child=>child.tagName===selector.toUpperCase())||this.children.map(child=>child.querySelector(selector)).find(Boolean)||null;}
    focus(){document.activeElement=this;}
  }
  const document={readyState:'complete',head:new Element('head'),body:new Element('body'),getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag),addEventListener(){}};
  function add(id,hidden=false){const node=new Element();node.id=id;if(hidden)node.classList.add('hidden');return node;}
  for(const id of ['step-pick','barber-list','btn-join','inp-name','inp-phone','form-error','conf-barber'])add(id);
  add('step-form',true);add('step-done',true);nodes.get('form-error').classList.add('hidden');
  const context={document,console,selectedBarber:null,myEntryId:'saved-original',myCancelToken:'original-private-token',myBarberId:'original-barber',myFacialEntryId:null,myFacialCancelToken:null,myFacialBarberId:null,refreshInterval:null,
    sbRpc:(name,body)=>{state.calls.push({name,body});return state.result instanceof Error?Promise.reject(state.result):Promise.resolve(state.result);},
    saveEntry:barber=>state.saved.push({barber,entryId:context.myEntryId,cancelToken:context.myCancelToken,facialEntryId:context.myFacialEntryId,facialCancelToken:context.myFacialCancelToken}),
    syncCancelButton:()=>{},tickClock:()=>{},refreshPosition:()=>state.refreshes++,
    setTimeout:fn=>{fn();return 1;},setInterval:(fn,ms)=>{state.intervals.push(ms);return state.intervals.length;},clearInterval:()=>{},
    CustomEvent:function(type,options){this.type=type;this.detail=options.detail;},
    MutationObserver:function(callback){state.observers.push(callback);this.observe=()=>{};}
  };
  context.window=context;context.dispatchEvent=event=>state.events.push(event);
  vm.createContext(context);vm.runInContext(recoverySource,context,{filename:'recovery.js'});
  return {context,state,node:id=>nodes.get(id),add,submit:async phone=>{nodes.get('queue-recovery-phone').value=phone;nodes.get('queue-recovery-form').fire('submit');await settle();},loadHelper:async()=>{add('bossman-recovery-script');vm.runInContext(loaderSource,context,{filename:'recovery-loader.js'});await settle();}};
}

const tests=[];
function test(name,run){tests.push({name,run});}
test('phone-only form restores a unique queue without needing a matching name',async()=>{
  const f=fixture({ok:true,matches:[match('one')],requiresSelection:false});
  assert.equal(f.node('queue-recovery-name'),undefined);
  f.context.openBossmanQueueRecovery('Test Customer raj','099 001-23456789');
  assert.equal(f.node('queue-recovery-phone').value,'099 001-23456789','legacy JS helper keeps phone argument');
  await f.submit('099 001-23456789');
  assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].name,'recover_queue_by_phone');
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls[0].body)),{p_phone:'609900123456789'});
  assert.equal(f.context.myEntryId,'one');assert.equal(f.state.saved.length,1);
  assert.equal(f.context.myCancelToken,null);assert.equal(f.context.myFacialCancelToken,null,'recovery never grants cancellation rights');
  assert(f.node('queue-recovery-overlay').classList.contains('recovery-hidden'));assert(!f.node('step-done').classList.contains('hidden'));
  assert.equal(f.state.refreshes,1);assert.equal(f.state.intervals[0],10000);
});
test('country-code plus and punctuation normalize to the same full phone',async()=>{
  for(const phone of ['+60 990-0123456789','609900123456789']){
    const f=fixture({ok:true,matches:[match('one')]});await f.submit(phone);assert.equal(f.state.calls[0].body.p_phone,'609900123456789');
  }
});
test('incomplete or overlong phone input cannot make a recovery request',async()=>{
  for(const phone of ['', '1234','1234567890123456']){
    const f=fixture({ok:true,matches:[match('one')]});await f.submit(phone);assert.equal(f.state.calls.length,0);assert.equal(f.state.saved.length,0);
    assert.match(f.node('queue-recovery-error').textContent,/full phone number/);
  }
});
test('two customers sharing a phone require an explicit choice before any receipt changes',async()=>{
  const first=match('one',[entry('one','Person One','Assaf')]),second=match('two',[entry('two','Person Two','Jalal')]);
  const f=fixture({ok:true,matches:[first,second],requiresSelection:false});await f.submit('09900123456789');
  assert.equal(f.state.saved.length,0);assert.equal(f.context.myEntryId,'saved-original');
  const buttons=f.node('queue-recovery-matches').children.filter(n=>n.tagName==='BUTTON');
  assert.equal(buttons.length,2);assert.match(buttons[0].textContent,/Person One.*Assaf/);assert.match(buttons[1].textContent,/Person Two.*Jalal/);
  buttons[1].fire('click');assert.equal(f.context.myEntryId,'two');assert.equal(f.context.myFacialEntryId,null);assert.equal(f.context.myCancelToken,null);
});
test('separate haircuts with identical names remain separate selectable matches',async()=>{
  const f=fixture({ok:true,matches:[match('one',[entry('one','Same Name','Assaf')]),match('two',[entry('two','Same Name','Jalal')])]});await f.submit('09900123456789');
  assert.equal(f.state.saved.length,0);assert.equal(f.node('queue-recovery-matches').children.filter(n=>n.tagName==='BUTTON').length,2);
});
test('only the backend-confirmed exact haircut plus facial group restores together',async()=>{
  const f=fixture({ok:true,matches:[match('one',[entry('one','Test Customer'),entry('facial','Test Customer (facial)','Jassy','therapist')])]});await f.submit('09900123456789');
  assert.equal(f.context.myEntryId,'one');assert.equal(f.context.myFacialEntryId,'facial');assert.equal(f.context.myFacialCancelToken,null);
  assert.equal(f.node('conf-barber').textContent,'Jalal + Jassy');
});
test('an unrelated haircut and therapist cannot be silently restored as one person',async()=>{
  const f=fixture({ok:true,matches:[match('one',[entry('one','Test Customer'),entry('facial','Someone Else (facial)','Jassy','therapist')])]});await f.submit('09900123456789');
  assert.equal(f.state.saved.length,0);assert.equal(f.context.myEntryId,'saved-original');assert.match(f.node('queue-recovery-error').textContent,/separate confirmation/);
});
test('empty, duplicate, inactive or malformed matches preserve the existing receipt',async()=>{
  for(const result of [{ok:true,matches:[]},{ok:true,matches:[match('one'),match('one')]},{ok:true,matches:[{matchId:'x',entries:[]}]},{ok:true,matches:[match('one',[{...entry('one'),status:'done'}])]}]){
    const f=fixture(result);await f.submit('09900123456789');assert.equal(f.state.saved.length,0);assert.equal(f.context.myEntryId,'saved-original');assert(f.node('queue-recovery-error').textContent);
  }
});
test('not-found and network errors remain visible and restore usable controls',async()=>{
  for(const result of [{error:'No active queue was found for this phone number.',code:'not_found'},Error('Network unavailable')]){
    const f=fixture(result);await f.submit('09900123456789');assert.equal(f.state.saved.length,0);assert(f.node('queue-recovery-error').textContent);
    assert.equal(f.node('queue-recovery-submit').disabled,false);assert.equal(f.node('queue-recovery-back').disabled,false);assert.equal(f.node('queue-recovery-phone').disabled,false);
  }
});
test('changing the phone removes old matches before a selection can be made',async()=>{
  const f=fixture({ok:true,matches:[match('one'),match('two')]});await f.submit('09900123456789');
  f.node('queue-recovery-phone').value='09900000000000';f.node('queue-recovery-phone').fire('input');
  assert.equal(f.node('queue-recovery-matches').children.length,0);assert(f.node('queue-recovery-matches').classList.contains('recovery-hidden'));assert.equal(f.state.saved.length,0);
});
test('four shared-phone matches remain selectable inside a scrolling mobile dialog',async()=>{
  const f=fixture({ok:true,matches:['one','two','three','four'].map(id=>match(id))});await f.submit('09900123456789');
  assert.equal(f.node('queue-recovery-matches').children.filter(n=>n.tagName==='BUTTON').length,4);
  const css=f.node('bossman-recovery-styles').textContent;
  assert.match(css,/\.recovery-dialog\{[^}]*max-height:90vh/);assert.match(css,/\.recovery-dialog\{[^}]*overflow:auto/);
  assert.match(css,/\.recovery-dialog\{[^}]*box-sizing:border-box/);assert.equal(f.state.saved.length,0);
});
test('customer-supplied names are rendered as text in the match choices',async()=>{
  const f=fixture({ok:true,matches:[match('one',[entry('one','<img src=x onerror=alert(1)>')]),match('two')]});await f.submit('09900123456789');
  const button=f.node('queue-recovery-matches').children.find(n=>n.tagName==='BUTTON');assert.equal(button.children[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(button.children[0].markup,undefined);
});
test('duplicate-join helper ignores hidden stale errors and opens only a visible duplicate error',async()=>{
  const f=fixture({error:'Invalid phone'});const opened=[];f.context.openBossmanQueueRecovery=(...args)=>opened.push(args);
  f.node('form-error').textContent='This number is already in a queue.';f.node('inp-phone').value='09900123456789';f.node('inp-name').value='Different spelling';
  await f.loadHelper();assert.equal(opened.length,0,'hidden old error must not open the modal on installation');
  f.node('step-form').classList.remove('hidden');f.node('form-error').classList.remove('hidden');f.state.observers[0]();assert.equal(opened.length,1);
  assert.equal(opened[0][1],'09900123456789','legacy loader passes the same phone');
  f.node('form-error').classList.add('hidden');f.state.observers[0]();assert.equal(opened.length,1,'hiding old error while resubmitting must not reopen recovery');
  f.node('form-error').classList.remove('hidden');f.node('step-form').classList.add('hidden');f.state.observers[0]();assert.equal(opened.length,1,'successful join hiding its form must not reopen recovery');
});
test('cache and helper loader versions point to the phone-only recovery bundle',()=>{
  assert.match(fs.readFileSync(path.join(root,'service-worker.js'),'utf8'),/bossman-customer-v19/);
  assert.match(loaderSource,/recovery\.js\?v=20261107-phone/);
  assert.match(fs.readFileSync(path.join(root,'pwa.js'),'utf8'),/recovery-loader\.js\?v=20261107-phone/);
  for(const file of ['recovery.js','recovery-loader.js','pwa.js','service-worker.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
});

(async()=>{for(const t of tests){await t.run();console.log('PASS '+t.name);}console.log(tests.length+' phone recovery checks passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
