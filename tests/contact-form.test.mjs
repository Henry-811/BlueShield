import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const testDirectory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(testDirectory,'..');
const contactSource=fs.readFileSync(path.join(root,'contact-form.js'),'utf8');
const draftStorageKey='blueshield.contactDraft.v1';

function productionApi(){
 const context={
  URL,
  document:{addEventListener:()=>{}},
 };
 vm.runInNewContext(contactSource,context);
 return context.BlueShieldContactForm;
}

function createForm(){
 const fields=new Map([
  ['requestType',{value:'capability-briefing'}],
  ['name',{value:'Jane Smith'}],
  ['organisation',{value:'Example Pty Ltd'}],
  ['email',{value:'jane@example.com'}],
  ['sector',{value:'defence-national-security'}],
  ['mission',{value:'Persistent coastal surveillance.'}],
  ['website',{value:''}],
 ]);
 const listeners=new Map();
 const status={dataset:{state:'loading'},textContent:''};
 const button={dataset:{defaultLabel:'Send enquiry →'},disabled:true,textContent:'Send enquiry →'};
 const challenge={};
 const attributes=new Map();
 let resetCount=0;
 const form={
  elements:{namedItem:name=>fields.get(name)||null},
  querySelector:selector=>({
   '#formStatus':status,
   '#contactSubmit':button,
   '#contactTurnstile':challenge,
  })[selector]||null,
  setAttribute:(name,value)=>attributes.set(name,value),
  removeAttribute:name=>attributes.delete(name),
  addEventListener:(type,listener)=>listeners.set(type,listener),
  reset:()=>{
   resetCount+=1;
   for(const [name,field] of fields){
    if(!['requestType','sector'].includes(name))field.value='';
   }
   fields.get('requestType').value='capability-briefing';
   fields.get('sector').value='defence-national-security';
  },
 };
 return {
  form,status,button,challenge,fields,attributes,listeners,
  resetCount:()=>resetCount,
 };
}

function createTurnstile(){
 let options=null;
 let resetCount=0;
 return {
  api:{
   render:(target,renderOptions)=>{
    assert.ok(target);
    options=renderOptions;
    options.callback('turnstile-token-1');
    return 'widget-1';
   },
   reset:widgetId=>{
    assert.equal(widgetId,'widget-1');
    resetCount+=1;
    options.callback(`turnstile-token-${resetCount+1}`);
   },
  },
  options:()=>options,
  resetCount:()=>resetCount,
 };
}

function createStorage(initialValues={}){
 const values=new Map(Object.entries(initialValues));
 let removeCount=0;
 return {
  getItem:key=>values.has(key)?values.get(key):null,
  setItem:(key,value)=>values.set(key,String(value)),
  removeItem:key=>{
   removeCount+=1;
   values.delete(key);
  },
  has:key=>values.has(key),
  value:key=>values.get(key),
  removeCount:()=>removeCount,
 };
}

const config={
 apiEndpoint:'https://blueshield-contact.example.workers.dev/contact',
 turnstileSiteKey:'public-site-key',
 turnstileAction:'contact_enquiry',
 turnstileScriptUrl:'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
};

const timerOptions={
 setTimer:()=>1,
 clearTimer:()=>{},
 AbortControllerImpl:AbortController,
};

test('the production contact coordinator submits the documented payload and shows accepted state',async()=>{
 const api=productionApi();
 const harness=createForm();
 const challenge=createTurnstile();
 const draftStorage=createStorage({
  [draftStorageKey]:JSON.stringify({
   requestType:'capability-briefing',
   name:'Jane Smith',
   organisation:'Example Pty Ltd',
   email:'jane@example.com',
   sector:'defence-national-security',
   mission:'Persistent coastal surveillance.',
  }),
 });
 let resolveFetch;
 const calls=[];
 const fetchImpl=(url,options)=>{
  calls.push({url,options});
  return new Promise(resolve=>{resolveFetch=resolve});
 };
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  fetchImpl,
  turnstileApi:challenge.api,
  draftStorage,
  uuid:()=> '5c855ee7-24d6-49d8-af17-0a1cb0f8a4cd',
  ...timerOptions,
 });

 assert.equal(controller.configured,true);
 assert.equal(challenge.options().sitekey,'public-site-key');
 assert.equal(challenge.options().action,'contact_enquiry');
 assert.equal(challenge.options().language,'en');
 assert.equal(harness.button.disabled,false);

 const submitPromise=controller.submit({preventDefault:()=>{}});
 assert.equal(harness.button.disabled,true);
 assert.equal(harness.button.textContent,'Sending enquiry…');
 assert.equal(harness.attributes.get('aria-busy'),'true');
 await controller.submit({preventDefault:()=>{}});
 assert.equal(calls.length,1,'a rapid duplicate submit must share the in-flight request');
 resolveFetch(Response.json({ok:true,requestId:'request-1'},{status:202}));
 await submitPromise;

 assert.equal(calls.length,1);
 assert.equal(calls[0].url,config.apiEndpoint);
 assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.headers['content-type'],'application/json');
 assert.deepEqual(JSON.parse(calls[0].options.body),{
  submissionId:'5c855ee7-24d6-49d8-af17-0a1cb0f8a4cd',
  requestType:'capability-briefing',
  name:'Jane Smith',
  organisation:'Example Pty Ltd',
  email:'jane@example.com',
  sector:'defence-national-security',
  mission:'Persistent coastal surveillance.',
  website:'',
  turnstileToken:'turnstile-token-1',
 });
 assert.equal(harness.resetCount(),1);
 assert.equal(challenge.resetCount(),1);
 assert.equal(harness.status.dataset.state,'success');
 assert.match(harness.status.textContent,/Enquiry received/);
 assert.equal(harness.attributes.has('aria-busy'),false);
 assert.equal(draftStorage.has(draftStorageKey),false,'an accepted enquiry clears the saved draft');
});

test('ordinary contact fields survive a same-tab refresh without persisting security state',async()=>{
 const api=productionApi();
 const draftStorage=createStorage();
 const firstHarness=createForm();
 const firstChallenge=createTurnstile();
 await api.initContactForm({
  form:firstHarness.form,
  status:firstHarness.status,
  button:firstHarness.button,
  challenge:firstHarness.challenge,
  config,
  fetchImpl:async()=>Response.json({ok:true},{status:202}),
  turnstileApi:firstChallenge.api,
  draftStorage,
  uuid:()=> '5814f798-06b9-4f0d-9e04-cd3fffd852f5',
  ...timerOptions,
 });

 firstHarness.fields.get('requestType').value='general-enquiry';
 firstHarness.fields.get('name').value='Refresh Test';
 firstHarness.fields.get('organisation').value='';
 firstHarness.fields.get('email').value='refresh@example.com';
 firstHarness.fields.get('sector').value='energy-utilities';
 firstHarness.fields.get('mission').value='Restore this draft after reload.';
 firstHarness.fields.get('website').value='must-not-be-persisted.example';
 firstHarness.listeners.get('input')();

 const savedDraft=JSON.parse(draftStorage.value(draftStorageKey));
 assert.deepEqual(Object.keys(savedDraft),[
  'requestType','name','organisation','email','sector','mission',
 ]);
 assert.deepEqual(savedDraft,{
  requestType:'general-enquiry',
  name:'Refresh Test',
  organisation:'',
  email:'refresh@example.com',
  sector:'energy-utilities',
  mission:'Restore this draft after reload.',
 });

 draftStorage.setItem(draftStorageKey,JSON.stringify({
  ...savedDraft,
  website:'must-not-be-restored.example',
  turnstileToken:'expired-token',
  submissionId:'0eb65c10-89e3-49ab-83ca-a8fab85683b8',
  status:'success',
 }));
 const refreshedHarness=createForm();
 refreshedHarness.fields.get('requestType').value='capability-briefing';
 refreshedHarness.fields.get('name').value='';
 refreshedHarness.fields.get('organisation').value='';
 refreshedHarness.fields.get('email').value='';
 refreshedHarness.fields.get('sector').value='defence-national-security';
 refreshedHarness.fields.get('mission').value='';
 refreshedHarness.fields.get('website').value='';
 const refreshedChallenge=createTurnstile();
 const refreshedController=await api.initContactForm({
  form:refreshedHarness.form,
  status:refreshedHarness.status,
  button:refreshedHarness.button,
  challenge:refreshedHarness.challenge,
  config,
  fetchImpl:async()=>Response.json({ok:true},{status:202}),
  turnstileApi:refreshedChallenge.api,
  draftStorage,
  uuid:()=> 'b7e94076-eed2-4852-acdf-0cccb4f290a8',
  ...timerOptions,
 });

 assert.equal(refreshedController.configured,true);
 assert.equal(refreshedHarness.fields.get('requestType').value,'general-enquiry');
 assert.equal(refreshedHarness.fields.get('name').value,'Refresh Test');
 assert.equal(refreshedHarness.fields.get('organisation').value,'');
 assert.equal(refreshedHarness.fields.get('email').value,'refresh@example.com');
 assert.equal(refreshedHarness.fields.get('sector').value,'energy-utilities');
 assert.equal(refreshedHarness.fields.get('mission').value,'Restore this draft after reload.');
 assert.equal(refreshedHarness.fields.get('website').value,'');
 assert.equal(refreshedChallenge.options().action,'contact_enquiry','Turnstile starts a fresh challenge after reload');
 assert.equal(refreshedHarness.status.dataset.state,'ready');
});

test('unavailable draft storage never blocks the secure contact form',async()=>{
 const api=productionApi();
 const harness=createForm();
 const challenge=createTurnstile();
 const warnings=[];
 const failingStorage={
  getItem:()=>{throw new Error('Storage unavailable.');},
  setItem:()=>{throw new Error('Storage unavailable.');},
  removeItem:()=>{throw new Error('Storage unavailable.');},
 };
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  fetchImpl:async()=>Response.json({ok:true},{status:202}),
  turnstileApi:challenge.api,
  draftStorage:failingStorage,
  logger:{warn:(...args)=>warnings.push(args)},
  uuid:()=> '919cfa56-1333-4799-9d30-d58da2d9a5f7',
  ...timerOptions,
 });

 assert.equal(controller.configured,true);
 assert.equal(harness.button.disabled,false);
 assert.equal(warnings.length,1);
 assert.doesNotMatch(JSON.stringify(warnings),/Jane Smith|jane@example\.com|Persistent coastal/);
});

test('delivery failures preserve fields and reuse the submission id until the user edits',async()=>{
 const api=productionApi();
 const harness=createForm();
 const challenge=createTurnstile();
 const responses=[
  Response.json({ok:false,error:{code:'service_unavailable'}},{status:503}),
  Response.json({ok:false,error:{code:'service_unavailable'}},{status:503}),
  Response.json({ok:true},{status:202}),
 ];
 const bodies=[];
 const ids=[
  '1fb71a1e-42fa-4d14-bafd-d4db2c2d94cb',
  '12d2a0c3-0e99-4ff0-a252-bd9dc186aa57',
 ];
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  fetchImpl:async(url,options)=>{
   bodies.push(JSON.parse(options.body));
   return responses.shift();
  },
  turnstileApi:challenge.api,
  uuid:()=>ids.shift(),
  ...timerOptions,
 });

 await controller.submit({preventDefault:()=>{}});
 assert.equal(harness.status.dataset.state,'error');
 assert.match(harness.status.textContent,/temporarily unavailable/);
 assert.equal(harness.fields.get('name').value,'Jane Smith');
 assert.equal(harness.resetCount(),0);

 await controller.submit({preventDefault:()=>{}});
 assert.equal(bodies[1].submissionId,bodies[0].submissionId);
 harness.fields.get('mission').value='Updated coastal surveillance requirement.';
 harness.listeners.get('input')();
 await controller.submit({preventDefault:()=>{}});

 assert.notEqual(bodies[2].submissionId,bodies[1].submissionId);
 assert.equal(bodies[2].mission,'Updated coastal surveillance requirement.');
 assert.equal(harness.status.dataset.state,'success');
});

test('editing fields during an in-flight request creates a new id for the changed retry',async()=>{
 const api=productionApi();
 const harness=createForm();
 const challenge=createTurnstile();
 const bodies=[];
 let resolveFirstRequest;
 const ids=[
  '38ec77cb-0c77-49e1-98bd-a82dd61da06a',
  'aa3da861-c3d9-484c-9029-b1e97fa1987a',
 ];
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  fetchImpl:async(url,options)=>{
   bodies.push(JSON.parse(options.body));
   if(bodies.length===1)return new Promise(resolve=>{resolveFirstRequest=resolve});
   return Response.json({ok:false,error:{code:'service_unavailable'}},{status:503});
  },
  turnstileApi:challenge.api,
  uuid:()=>ids.shift(),
  ...timerOptions,
 });

 const firstRequest=controller.submit({preventDefault:()=>{}});
 harness.fields.get('mission').value='Changed while the first request is in flight.';
 harness.listeners.get('input')();
 resolveFirstRequest(Response.json({ok:false,error:{code:'service_unavailable'}},{status:503}));
 await firstRequest;
 await controller.submit({preventDefault:()=>{}});

 assert.notEqual(bodies[1].submissionId,bodies[0].submissionId);
 assert.equal(bodies[1].mission,'Changed while the first request is in flight.');
});

test('a browser timeout preserves fields and reports a recoverable timeout',async()=>{
 const api=productionApi();
 const harness=createForm();
 const challenge=createTurnstile();
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  fetchImpl:async(url,options)=>new Promise((resolve,reject)=>{
   options.signal.addEventListener('abort',()=>{
    const error=new Error('Request timed out.');
    error.name='AbortError';
    reject(error);
   },{once:true});
  }),
  turnstileApi:challenge.api,
  uuid:()=> '84dfd68b-6819-4e94-bf6a-deab19ec872d',
  setTimer:callback=>{
   queueMicrotask(callback);
   return 1;
  },
  clearTimer:()=>{},
  AbortControllerImpl:AbortController,
 });

 await controller.submit({preventDefault:()=>{}});

 assert.equal(harness.status.dataset.state,'error');
 assert.match(harness.status.textContent,/timed out/);
 assert.equal(harness.fields.get('name').value,'Jane Smith');
 assert.equal(harness.resetCount(),0);
 assert.equal(challenge.resetCount(),1);
});

test('an unconfigured site fails visibly and cannot submit',async()=>{
 const api=productionApi();
 const harness=createForm();
 let fetchCalls=0;
 const controller=await api.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config:{apiEndpoint:'',turnstileSiteKey:''},
  fetchImpl:async()=>{fetchCalls+=1},
  ...timerOptions,
 });

 assert.equal(controller.configured,false);
 assert.equal(controller.reason,'configuration_missing');
 assert.equal(harness.button.disabled,true);
 assert.equal(harness.status.dataset.state,'unavailable');
 assert.match(harness.status.textContent,/info@blueshieldrobotics\.com/);
 assert.equal(fetchCalls,0);
});

test('the async Turnstile loader renders directly after the script load event',async()=>{
 const challenge=createTurnstile();
 const harness=createForm();
 const listeners=new Map();
 let readyCalls=0;
 let context;
 const script={
  dataset:{},
  addEventListener:(type,listener)=>listeners.set(type,listener),
 };
 const documentRef={
  addEventListener:()=>{},
  querySelector:selector=>selector==='script[data-contact-turnstile]'?null:null,
  createElement:tag=>{
   assert.equal(tag,'script');
   return script;
  },
  head:{
   append:appendedScript=>{
    assert.equal(appendedScript,script);
    context.turnstile={
     ...challenge.api,
     ready:callback=>{
      readyCalls+=1;
      callback();
     },
    };
    queueMicrotask(()=>listeners.get('load')());
   },
  },
 };
 context={URL,document:documentRef};
 vm.runInNewContext(contactSource,context);

 const controller=await context.BlueShieldContactForm.initContactForm({
  form:harness.form,
  status:harness.status,
  button:harness.button,
  challenge:harness.challenge,
  config,
  documentRef,
  fetchImpl:async()=>Response.json({ok:true},{status:202}),
  ...timerOptions,
 });

 assert.equal(script.async,true);
 assert.equal(script.defer,true);
 assert.equal(readyCalls,0,'turnstile.ready() is incompatible with async/defer script loading');
 assert.equal(controller.configured,true);
 assert.equal(harness.button.disabled,false);
});
