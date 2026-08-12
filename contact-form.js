(function initialiseContactModule(scope){
 'use strict';

 const DIRECT_EMAIL='info@blueshieldrobotics.com';
 const REQUEST_TIMEOUT_MS=12_000;
 const CONTACT_DRAFT_STORAGE_KEY='blueshield.contactDraft.v1';
 const DRAFT_FIELD_LIMITS=Object.freeze({
  requestType:64,
  name:100,
  organisation:160,
  email:254,
  sector:64,
  mission:4_000,
 });
 let turnstileLoadPromise=null;

 function setStatus(status,state,message){
  if(!status)return;
  status.dataset.state=state;
  status.textContent=message;
 }

 function setSubmitState(button,{disabled,label}){
  if(!button)return;
  button.disabled=disabled;
  button.textContent=label;
 }

 function isSafeEndpoint(value){
  try{
   const url=new URL(value);
   return url.protocol==='https:'||(
    url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)
   );
  }catch{
   return false;
  }
 }

 function normaliseConfig(rawConfig){
  if(!rawConfig||typeof rawConfig!=='object')return null;
  const apiEndpoint=typeof rawConfig.apiEndpoint==='string'?rawConfig.apiEndpoint.trim():'';
  const turnstileSiteKey=typeof rawConfig.turnstileSiteKey==='string'?rawConfig.turnstileSiteKey.trim():'';
  const turnstileAction=typeof rawConfig.turnstileAction==='string'&&rawConfig.turnstileAction.trim()
   ?rawConfig.turnstileAction.trim()
   :'contact_enquiry';
  if(!apiEndpoint||!turnstileSiteKey||!isSafeEndpoint(apiEndpoint)||turnstileAction!=='contact_enquiry')return null;
  return Object.freeze({
   apiEndpoint,
   turnstileSiteKey,
   turnstileAction,
   turnstileScriptUrl:typeof rawConfig.turnstileScriptUrl==='string'&&rawConfig.turnstileScriptUrl.trim()
    ?rawConfig.turnstileScriptUrl.trim()
    :'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  });
 }

 function fieldValue(form,name){
  const field=form.elements.namedItem(name);
  return typeof field?.value==='string'?field.value:'';
 }

 function draftValues(form){
  return Object.fromEntries(Object.keys(DRAFT_FIELD_LIMITS).map(name=>[
   name,
   fieldValue(form,name).slice(0,DRAFT_FIELD_LIMITS[name]),
  ]));
 }

 function fieldAcceptsValue(field,value){
  if(!field?.options)return true;
  return Array.from(field.options).some(option=>option.value===value);
 }

 function restoreDraftValues(form,draft){
  if(!draft||typeof draft!=='object'||Array.isArray(draft))return false;
  let restored=false;
  for(const [name,limit] of Object.entries(DRAFT_FIELD_LIMITS)){
   const field=form.elements.namedItem(name);
   const storedValue=draft[name];
   if(!field||typeof storedValue!=='string')continue;
   const value=storedValue.slice(0,limit);
   if(!fieldAcceptsValue(field,value))continue;
   field.value=value;
   restored=true;
  }
  return restored;
 }

 function warnDraftFailure(logger,operation,error){
  logger?.warn?.(
   `Contact draft ${operation} failed; continuing without draft storage.`,
   {errorName:typeof error?.name==='string'?error.name:'Error'},
  );
 }

 function defaultDraftStorage(logger){
  try{
   return scope.sessionStorage||null;
  }catch(error){
   warnDraftFailure(logger,'access',error);
   return null;
  }
 }

 function createDraftStore(form,{storage,logger}){
  let available=Boolean(
   storage&&
   typeof storage.getItem==='function'&&
   typeof storage.setItem==='function'&&
   typeof storage.removeItem==='function'
  );
  const fail=(operation,error)=>{
   if(!available)return;
   available=false;
   warnDraftFailure(logger,operation,error);
  };
  return Object.freeze({
   restore:()=>{
    if(!available)return false;
    try{
     const stored=storage.getItem(CONTACT_DRAFT_STORAGE_KEY);
     if(stored===null)return false;
     return restoreDraftValues(form,JSON.parse(stored));
    }catch(error){
     fail('restore',error);
     return false;
    }
   },
   save:()=>{
    if(!available)return;
    try{
     storage.setItem(CONTACT_DRAFT_STORAGE_KEY,JSON.stringify(draftValues(form)));
    }catch(error){
     fail('save',error);
    }
   },
   clear:()=>{
    if(!available)return;
    try{
     storage.removeItem(CONTACT_DRAFT_STORAGE_KEY);
    }catch(error){
     fail('clear',error);
    }
   },
  });
 }

 function readSubmissionValues(form){
  return {
   requestType:fieldValue(form,'requestType'),
   name:fieldValue(form,'name'),
   organisation:fieldValue(form,'organisation'),
   email:fieldValue(form,'email'),
   sector:fieldValue(form,'sector'),
   mission:fieldValue(form,'mission'),
   website:fieldValue(form,'website'),
  };
 }

 function createPayload(form,{submissionId,turnstileToken}){
  return Object.freeze({
   submissionId,
   ...readSubmissionValues(form),
   turnstileToken,
  });
 }

 async function readJsonResponse(response){
  try{
   return await response.json();
  }catch{
   return {ok:false,error:{code:'invalid_response'}};
  }
 }

 function errorMessage(status,code){
  if(code==='verification_failed')return 'The security check expired or could not be verified. Complete it again and resubmit.';
  if(code==='rate_limited'||status===429)return `Too many attempts were made. Wait a minute and try again, or email ${DIRECT_EMAIL}.`;
  if(code==='invalid_request'||status===422)return 'Check the enquiry fields and try again.';
  if(code==='request_too_large'||status===413)return 'The mission requirement is too long. Shorten it and try again.';
  if(status===502||status===503)return `Online delivery is temporarily unavailable. Email ${DIRECT_EMAIL} instead.`;
  return `The enquiry could not be sent. Try again, or email ${DIRECT_EMAIL}.`;
 }

 function loadTurnstile(scriptUrl,{documentRef=scope.document}={}){
  if(scope.turnstile)return Promise.resolve(scope.turnstile);
  if(turnstileLoadPromise)return turnstileLoadPromise;
  turnstileLoadPromise=new Promise((resolve,reject)=>{
   if(!documentRef){
    reject(new Error('Turnstile requires a document.'));
    return;
   }
   const existing=documentRef.querySelector('script[data-contact-turnstile]');
   const script=existing||documentRef.createElement('script');
   const onLoad=()=>{
    const api=scope.turnstile;
    if(!api){
     reject(new Error('Turnstile loaded without its browser API.'));
     return;
    }
    resolve(api);
   };
   const onError=()=>reject(new Error('Turnstile could not be loaded.'));
   script.addEventListener('load',onLoad,{once:true});
   script.addEventListener('error',onError,{once:true});
   if(!existing){
    script.src=scriptUrl;
    script.async=true;
    script.defer=true;
    script.dataset.contactTurnstile='true';
    documentRef.head.append(script);
   }
  });
  return turnstileLoadPromise;
 }

 async function initContactForm(options={}){
  const documentRef=options.documentRef||scope.document;
  const form=options.form||documentRef?.querySelector('#contactForm');
  if(!form)return Object.freeze({configured:false,reason:'form_missing'});

  const status=options.status||form.querySelector('#formStatus');
  const button=options.button||form.querySelector('#contactSubmit');
  const challenge=options.challenge||form.querySelector('#contactTurnstile');
  const defaultLabel=button?.dataset.defaultLabel||'Send enquiry →';
  const logger=options.logger||scope.console;
  const initialRequestType=fieldValue(form,'requestType');
  const draftStorage=options.draftStorage===undefined
   ?defaultDraftStorage(logger)
   :options.draftStorage;
  const draftStore=createDraftStore(form,{storage:draftStorage,logger});
  draftStore.restore();
  let submissionId='';
  let submissionFingerprint='';
  let pending=false;
  form.addEventListener('input',()=>{
   draftStore.save();
   if(!pending){
    submissionId='';
    submissionFingerprint='';
   }
  });
  const config=normaliseConfig(options.config||scope.BLUE_SHIELD_CONTACT_CONFIG);
  const fetchImpl=options.fetchImpl||scope.fetch?.bind(scope);
  const uuid=options.uuid||(()=>scope.crypto.randomUUID());
  const AbortControllerImpl=options.AbortControllerImpl||scope.AbortController;
  const setTimer=options.setTimer||scope.setTimeout.bind(scope);
  const clearTimer=options.clearTimer||scope.clearTimeout.bind(scope);

  setSubmitState(button,{disabled:true,label:defaultLabel});
  if(!config||typeof fetchImpl!=='function'||typeof AbortControllerImpl!=='function'){
   setStatus(status,'unavailable',`Online submission is not configured yet. Please email ${DIRECT_EMAIL}.`);
   return Object.freeze({configured:false,reason:'configuration_missing'});
  }

  let turnstileApi=options.turnstileApi;
  try{
   turnstileApi=turnstileApi||await (options.turnstileLoader||loadTurnstile)(config.turnstileScriptUrl,{documentRef});
  }catch{
   setStatus(status,'error',`The security check could not load. Refresh the page, or email ${DIRECT_EMAIL}.`);
   return Object.freeze({configured:false,reason:'verification_unavailable'});
  }
  if(!turnstileApi||typeof turnstileApi.render!=='function'||!challenge){
   setStatus(status,'error',`The security check is unavailable. Refresh the page, or email ${DIRECT_EMAIL}.`);
   return Object.freeze({configured:false,reason:'verification_unavailable'});
  }

  let turnstileToken='';
  let widgetId=null;

  const setChallengePending=message=>{
   turnstileToken='';
   setSubmitState(button,{disabled:true,label:defaultLabel});
   setStatus(status,'verification',message);
  };

  setChallengePending('Complete the security check to enable secure submission.');
  try{
   widgetId=turnstileApi.render(challenge,{
    sitekey:config.turnstileSiteKey,
    action:config.turnstileAction,
    theme:'dark',
    callback:token=>{
     turnstileToken=token;
     if(!pending)setSubmitState(button,{disabled:false,label:defaultLabel});
     if(['loading','verification'].includes(status?.dataset.state)){
      setStatus(status,'ready','Secure submission is ready.');
     }
    },
    'expired-callback':()=>setChallengePending('The security check expired. Complete it again to submit.'),
    'timeout-callback':()=>setChallengePending('The security check timed out. Complete it again to submit.'),
    'error-callback':()=>{
     setChallengePending(`The security check failed to load. Refresh the page, or email ${DIRECT_EMAIL}.`);
     return true;
    },
   });
  }catch{
   setStatus(status,'error',`The security check could not start. Refresh the page, or email ${DIRECT_EMAIL}.`);
   return Object.freeze({configured:false,reason:'verification_unavailable'});
  }

  const resetChallenge=()=>{
   turnstileToken='';
   setSubmitState(button,{disabled:true,label:defaultLabel});
   if(typeof turnstileApi.reset!=='function')return;
   try{
    turnstileApi.reset(widgetId);
   }catch{
    const message=status?.dataset.state==='success'
     ?'Enquiry received. Refresh the page before sending another enquiry.'
     :`The security check could not reset. Refresh the page, or email ${DIRECT_EMAIL}.`;
    setStatus(status,status?.dataset.state==='success'?'success':'error',message);
   }
  };

  const submit=async event=>{
   event?.preventDefault?.();
   if(pending)return;
   if(!turnstileToken){
    setStatus(status,'verification','Complete the security check before sending the enquiry.');
    return;
   }

   pending=true;
   form.setAttribute('aria-busy','true');
   setSubmitState(button,{disabled:true,label:'Sending enquiry…'});
   setStatus(status,'loading','Securely sending your enquiry…');
   const currentFingerprint=JSON.stringify(readSubmissionValues(form));
   if(!submissionId||submissionFingerprint!==currentFingerprint){
    submissionId=uuid();
    submissionFingerprint=currentFingerprint;
   }
   const payload=createPayload(form,{submissionId,turnstileToken});
   const controller=new AbortControllerImpl();
   const timeoutId=setTimer(()=>controller.abort(),REQUEST_TIMEOUT_MS);

   try{
    const response=await fetchImpl(config.apiEndpoint,{
     method:'POST',
     headers:{'content-type':'application/json'},
     body:JSON.stringify(payload),
     signal:controller.signal,
    });
    const result=await readJsonResponse(response);
    if(response.status!==202||result.ok!==true){
     setStatus(status,'error',errorMessage(response.status,result?.error?.code));
     return;
    }
    form.reset();
    const requestTypeField=form.elements.namedItem('requestType');
    if(requestTypeField)requestTypeField.value=initialRequestType;
    draftStore.clear();
    submissionId='';
    submissionFingerprint='';
    setStatus(status,'success','Enquiry received. We will review the mission brief and respond by email.');
   }catch(error){
    const message=error?.name==='AbortError'
     ?`The request timed out. Try again, or email ${DIRECT_EMAIL}.`
     :`The enquiry could not reach our secure service. Try again, or email ${DIRECT_EMAIL}.`;
    setStatus(status,'error',message);
   }finally{
    clearTimer(timeoutId);
    pending=false;
    form.removeAttribute('aria-busy');
    resetChallenge();
   }
  };

  form.addEventListener('submit',submit);
  return Object.freeze({configured:true,submit});
 }

 const api=Object.freeze({createPayload,initContactForm,normaliseConfig});
 scope.BlueShieldContactForm=api;

 if(scope.document){
  scope.document.addEventListener('DOMContentLoaded',()=>{
   api.initContactForm().catch(()=>{
    const status=scope.document.querySelector('#formStatus');
    const button=scope.document.querySelector('#contactSubmit');
    setSubmitState(button,{disabled:true,label:'Send enquiry →'});
    setStatus(status,'error',`The secure form could not start. Refresh the page, or email ${DIRECT_EMAIL}.`);
   });
  });
 }
})(globalThis);
