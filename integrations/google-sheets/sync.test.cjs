const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');

function event(id, operation = 'INSERT', fields = {}, entity = 'queue_entries') {
  const record = {id:'entry-1',customer_name:'Original customer',phone:'0123456789',barber_id:'barber1',barber_name:'Barber',status:'waiting',position:1,duration_minutes:35,created_at:'2026-11-07T01:00:00Z',...fields};
  return {event_id:String(id),entity_type:entity,operation,record_id:record.id,changed_at:'2026-11-07T01:10:00Z',before_data:operation==='DELETE'?record:null,after_data:operation==='DELETE'?null:record};
}

function fixture(events = []) {
  const state = {events:[...events],acked:new Set(),calls:[],sheets:new Map(),failure:null,failAboveRow:null,lockAvailable:true,locked:false,triggers:[],active:true,writes:[],formulaFailure:false,expansions:[],indexReads:[]};
  const values = new Map([
    ['SUPABASE_URL','https://test-project.supabase.co'],['SUPABASE_PUBLISHABLE_KEY','test-public-key'],
    ['BOSSMAN_BACKUP_KEY','test-private-backup-key'],['BOSSMAN_SPREADSHEET_ID','bound-sheet'],['BOSSMAN_BACKUP_STARTED_UTC','2026-11-07T01:00:00Z']
  ]);
  class Sheet {
    constructor(name){this.name=name;this.rows=[];this.formulas=[];this.maximumRows=1000;this.maximumColumns=state.initialColumns||26;}
    getName(){return this.name;}
    getLastRow(){return this.rows.length;}
    getMaxRows(){return this.maximumRows;}
    getMaxColumns(){return this.maximumColumns;}
    insertRowsAfter(after,count){assert.equal(after,this.maximumRows);assert(count>0);this.maximumRows+=count;state.expansions.push({sheet:this.name,dimension:'rows',after,count});return this;}
    insertColumnsAfter(after,count){assert.equal(after,this.maximumColumns);assert(count>0);this.maximumColumns+=count;state.expansions.push({sheet:this.name,dimension:'columns',after,count});return this;}
    getDataRange(){state.indexReads.push(this.name);return this.getRange(1,1,Math.max(1,this.rows.length),Math.max(1,...this.rows.map(r=>r.length)));}
    getRange(row,col,nr=1,nc=1){
      assert(row+nr-1<=this.maximumRows,'Range requested beyond the current sheet grid');
      assert(col+nc-1<=this.maximumColumns,'Range requested beyond the current sheet columns');
      const sheet=this;
      return {
        setNumberFormat(format){assert.equal(format,'@');return this;},
        setValues(rows){
          assert.equal(rows.length,nr);assert(rows.every(r=>r.length===nc));
          state.writes.push({sheet:sheet.name,row,col,rows:rows.length,cols:nc});
          if(state.failure===sheet.name&&row>1&&(!state.failAboveRow||row+nr-1>state.failAboveRow)){state.failure=null;throw Error('Simulated partial write failure');}
          rows.forEach((values,r)=>values.forEach((value,c)=>{
            const text=String(value);
            sheet.rows[row-1+r] ||= [];
            sheet.formulas[row-1+r] ||= [];
            // Sheets consumes a leading apostrophe while preserving literal text.
            sheet.rows[row-1+r][col-1+c]=text.startsWith("'")?text.slice(1):text;
            sheet.formulas[row-1+r][col-1+c]=text.startsWith('=')?text:'';
          }));
          return this;
        },
        getValues(){return Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>sheet.rows[row-1+r]?.[col-1+c]??''));},
        getFormulas(){return Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>state.formulaFailure&&row>1?'=1':sheet.formulas[row-1+r]?.[col-1+c]??''));}
      };
    }
  }
  const spreadsheet={getId:()=> 'bound-sheet',getSheetByName:name=>state.sheets.get(name)||null,insertSheet:name=>{const sheet=new Sheet(name);state.sheets.set(name,sheet);return sheet;}};
  const properties={getProperty:key=>values.get(key)||null,setProperty:(key,value)=>{values.set(key,String(value));return properties;}};
  const context={
    PropertiesService:{getScriptProperties:()=>properties},
    LockService:{getScriptLock:()=>({tryLock:()=>{state.locked=state.lockAvailable;return state.lockAvailable;},releaseLock:()=>{state.locked=false;}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>state.active?spreadsheet:null,flush:()=>{}},
    Utilities:{formatDate:date=>new Date(date.getTime()+8*3600000).toISOString().slice(0,19).replace('T',' ')},
    ScriptApp:{
      getProjectTriggers:()=>state.triggers,
      deleteTrigger:trigger=>{state.triggers=state.triggers.filter(t=>t!==trigger);},
      newTrigger:handler=>({timeBased(){return this;},everyMinutes(minutes){assert.equal(minutes,1);return this;},create(){state.triggers.push({getHandlerFunction:()=>handler});}})
    },
    UrlFetchApp:{fetch:(url,options)=>{
      const name=url.split('/').pop(),body=JSON.parse(options.payload);
      assert.equal(options.method,'post');assert.equal(body.p_backup_key,'test-private-backup-key');
      state.calls.push({name,body});
      let data;
      const pending=()=>state.events.filter(e=>!state.acked.has(e.event_id));
      if(name==='read_backup_events')data={ok:true,events:pending().slice(0,body.p_limit),pendingCount:pending().length};
      else if(name==='acknowledge_backup_events'){
        body.p_event_ids.forEach(id=>state.acked.add(id));
        data={ok:true,acknowledged:body.p_event_ids.length,pendingCount:pending().length,lastSyncedAt:'2026-11-07T01:11:00Z'};
      } else if(name==='record_backup_sync_status')data={ok:true};
      else throw Error('Unexpected RPC '+name);
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(data)};
    }},console,Date,JSON,Object,Array,String,Number,Math,isFinite,Error
  };
  vm.createContext(context);vm.runInContext(source,context,{filename:'Code.gs'});
  return {context,state,values,run:()=>context.syncBossmanRecords(),rows:name=>state.sheets.get(name)?.rows,status:key=>state.sheets.get('Sync Status')?.rows.find(row=>row[0]===key)?.[1]};
}

const checks=[];
function test(name,run){run();checks.push(name);console.log('PASS '+name);}

test('IDs above safe integer range, leading-zero phones and formula-like names remain exact text',()=>{
  const f=fixture([event('9007199254740993','INSERT',{customer_name:'=IMPORTXML("https://invalid","//x")',cancel_token:'never-copy',customer_token:'never-copy',pin:'never-copy'})]);
  f.run();
  assert.equal(f.rows('Queue Records')[1][0],'entry-1');assert.equal(f.rows('Queue Records')[1][2],'0123456789');
  assert.equal(f.rows('Queue Records')[1][1],'=IMPORTXML("https://invalid","//x")');
  assert.equal(f.rows('Queue Records')[1][13],'9007199254740993');
  assert.equal(f.rows('Queue Records')[1][9],'2026-11-07 09:00:00');
  assert(!JSON.stringify(f.rows('Activity History')).includes('never-copy'));
  for(const name of ['+SUM(1,1)','-1+2','@command',"'literal",'  =1'])assert.equal(f.context.bossmanEncodeCell_(name),"'"+name);
  assert.equal(f.status('Status'),'Up to date');assert.equal(f.status('Pending Events'),'0');
});

test('duplicate event IDs and retrying delivery do not duplicate history',()=>{
  const same=event('2');const f=fixture([same,same]);f.run();
  assert.equal(f.rows('Activity History').length,2);
  f.state.acked.clear();f.run();assert.equal(f.rows('Activity History').length,2);
  assert.equal(f.rows('Queue Records').length,2);
});

test('partial write failure acknowledges nothing and retry repairs history',()=>{
  const f=fixture([event('3')]);
  // Create headers first, then fail only the activity data write.
  f.state.failure='Activity History';assert.throws(f.run,/Simulated partial write failure/);
  assert.equal(f.state.calls.filter(call=>call.name==='acknowledge_backup_events').length,0);
  assert.equal(f.rows('Queue Records').length,2);assert.equal(f.status('Status'),'Needs attention');
  assert.equal(f.state.locked,false);f.run();
  assert.equal(f.rows('Queue Records').length,2);assert.equal(f.rows('Activity History').length,2);assert.equal(f.state.acked.size,1);
});

test('an older decimal event cannot overwrite the latest customer record',()=>{
  const f=fixture([event('9007199254740993','UPDATE',{status:'called',customer_name:'Latest'})]);f.run();
  f.state.events.push(event('9007199254740992','UPDATE',{status:'waiting',customer_name:'Older'}));f.run();
  assert.equal(f.rows('Queue Records')[1][1],'Latest');assert.equal(f.rows('Queue Records')[1][5],'called');
  assert.equal(f.rows('Activity History').length,3);
});

test('delete events retain customer rows and their phone with a tombstone',()=>{
  const f=fixture([event('1')]);f.run();
  f.state.events.push(event('2','DELETE',{customer_name:'Original customer',phone:'0123456789'}));f.run();
  assert.equal(f.rows('Queue Records').length,2);assert.equal(f.rows('Queue Records')[1][2],'0123456789');
  assert.equal(f.rows('Queue Records')[1][14],'2026-11-07T01:10:00Z');assert.equal(f.rows('Activity History').length,3);
});

test('oversized JSON is visible and remains unacknowledged',()=>{
  const f=fixture([event('1','UPDATE',{description:'x'.repeat(50001)})]);
  assert.throws(f.run,/50,000-character/);assert.equal(f.state.acked.size,0);assert.equal(f.status('Status'),'Needs attention');
  assert.match(f.status('Last Error'),/50,000-character/);assert.equal(f.rows('Activity History'),undefined);
});

test('formula or failed readback never acknowledges events',()=>{
  const f=fixture([event('1')]);f.state.formulaFailure=true;
  assert.throws(f.run,/Write verification failed/);assert.equal(f.state.acked.size,0);
});

test('appointments and business settings retain data but exclude private keys',()=>{
  const a=event('1','INSERT',{id:'booking-1',phone:'+60123456789',service_id:'service-1',starts_at:'2026-11-07T02:00:00Z',customer_token:'private'},'bookings');
  const b=event('2','UPDATE',{id:'barber1',name:'Barber',pin:'private',off_days:[0],nested:{api_key:'private',cancel_token:'private',name:'Kept'}},'barbers');
  const f=fixture([a,b]);f.run();
  assert.equal(f.rows('Appointments')[1][2],'+60123456789');assert.equal(f.rows('Appointments')[1][8],'2026-11-07 10:00:00');
  const snapshot=f.rows('Business Records')[1][5];assert(!snapshot.includes('private'));assert(snapshot.includes('Kept'));
  assert.equal(f.rows('Activity History').length,3);
});

test('one-minute trigger setup is idempotent and bound spreadsheet ID persists',()=>{
  const f=fixture();f.values.delete('BOSSMAN_SPREADSHEET_ID');
  f.state.triggers=[{getHandlerFunction:()=> 'syncBossmanRecords'},{getHandlerFunction:()=> 'syncBossmanRecords'}];
  f.context.setupBossmanBackup();assert.equal(f.state.triggers.length,1);assert.equal(f.values.get('BOSSMAN_SPREADSHEET_ID'),'bound-sheet');
  f.context.setupBossmanBackup();assert.equal(f.state.triggers.length,1);
  assert(f.state.calls.some(call=>call.name==='acknowledge_backup_events'&&call.body.p_event_ids.length===0),'empty successful read records a health heartbeat');
  f.state.active=false;const calls=f.state.calls.length;assert.throws(f.run,/bound backup spreadsheet is unavailable/);
  const failedCalls=f.state.calls.slice(calls);assert(!failedCalls.some(call=>call.name==='acknowledge_backup_events'));
  assert(failedCalls.some(call=>call.name==='record_backup_sync_status'&&/bound backup spreadsheet/.test(call.body.p_error)),'missing container is visible in owner sync status');
});

test('idle runs skip all customer and history index reads',()=>{
  const f=fixture();f.run();
  assert.deepEqual([...f.state.sheets.keys()],['Sync Status']);
  assert(f.state.indexReads.every(name=>name==='Sync Status'));
  assert.deepEqual(f.state.calls.map(call=>call.name),['read_backup_events','acknowledge_backup_events'],'idle health uses only two network calls');
  f.state.indexReads=[];f.run();assert(f.state.indexReads.every(name=>name==='Sync Status'));
});

test('archives expand beyond 1,000 rows and a boundary failure retries without duplicates',()=>{
  const f=fixture(Array.from({length:1001},(_,i)=>event(i+1,'UPDATE',{id:'entry-'+i})));
  f.run();assert.equal(f.state.acked.size,500);
  f.state.failure='Activity History';f.state.failAboveRow=1000;
  assert.throws(f.run,/Simulated partial write failure/);assert.equal(f.state.acked.size,900);
  assert(f.state.expansions.some(change=>change.sheet==='Queue Records'&&change.after===1000));
  assert(f.state.expansions.some(change=>change.sheet==='Activity History'&&change.after===1000));
  f.run();assert.equal(f.state.acked.size,1001);
  assert.equal(f.rows('Queue Records').length,1002);assert.equal(f.rows('Activity History').length,1002);
  assert.equal(f.rows('Queue Records')[1][0],'entry-0');assert.equal(f.rows('Queue Records')[1][2],'0123456789');
  assert.equal(new Set(f.rows('Activity History').slice(1).map(row=>row[0])).size,1001);
  assert.equal(f.status('Status'),'Up to date');
});

test('narrow sheet grids expand before header and data ranges are requested',()=>{
  const f=fixture([event('1')]);f.state.initialColumns=2;f.run();
  assert.equal(f.state.sheets.get('Queue Records').getMaxColumns(),15);
  assert.equal(f.state.sheets.get('Activity History').getMaxColumns(),13);
  assert.equal(f.rows('Queue Records')[1][2],'0123456789');assert.equal(f.state.acked.size,1);
  assert(f.state.expansions.some(change=>change.dimension==='columns'&&change.sheet==='Queue Records'));
});

test('at most five batches run and backlog remains visible',()=>{
  const events=Array.from({length:501},(_,i)=>event(i+1,'UPDATE',{id:'entry-'+i}));
  const f=fixture(events);const result=f.run();
  assert.equal(result.exported,500);assert.equal(result.pendingCount,1);assert.equal(f.status('Status'),'Waiting to sync');
  assert.equal(f.state.calls.filter(call=>call.name==='read_backup_events').length,5);assert.equal(f.rows('Activity History').length,501);
  f.run();assert.equal(f.status('Status'),'Up to date');assert.equal(f.rows('Activity History').length,502);
});

test('concurrent invocation does not read or acknowledge events',()=>{
  const f=fixture([event('1')]);f.state.lockAvailable=false;
  assert.equal(f.run().skipped,true);assert.equal(f.state.calls.length,0);
});

test('conflicting payloads for one event ID fail rather than lose evidence',()=>{
  const f=fixture([event('1'),event('1','INSERT',{phone:'0199999999'})]);
  assert.throws(f.run,/Conflicting payloads/);assert.equal(f.state.acked.size,0);
});

test('secret error values are redacted',()=>{
  const f=fixture();assert.equal(f.context.bossmanSafeError_(Error('test-private-backup-key test-public-key'),{backupKey:'test-private-backup-key',publicKey:'test-public-key'}),'[redacted] [redacted]');
});

JSON.parse(fs.readFileSync(path.join(__dirname,'appsscript.json'),'utf8'));
console.log(`${checks.length} checks passed; manifest JSON is valid.`);
