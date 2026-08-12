import {buildEmailMessage,validateSubmission} from './contact.js';

const MAX_REQUEST_BODY_BYTES=16_384;
const REQUIRED_CONFIG=Object.freeze([
  'ALLOWED_ORIGINS',
  'CONTACT_FROM_EMAIL',
  'CONTACT_TO_EMAIL',
  'RESEND_API_KEY',
  'RESEND_API_URL',
  'RESEND_USER_AGENT',
  'TURNSTILE_EXPECTED_ACTION',
  'TURNSTILE_EXPECTED_HOSTNAMES',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_VERIFY_URL',
]);

class ExternalServiceError extends Error{
  constructor(code,{status=502,providerStatus=null,providerCode=null}={}){
    super(code);
    this.name='ExternalServiceError';
    this.code=code;
    this.status=status;
    this.providerStatus=providerStatus;
    this.providerCode=providerCode;
  }
}

function parseList(value){
  return new Set(String(value||'').split(',').map(item=>item.trim()).filter(Boolean));
}

function requestId(){
  return crypto.randomUUID();
}

function corsHeaders(origin){
  return origin?{
    'access-control-allow-origin':origin,
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'Content-Type',
    'access-control-max-age':'86400',
    vary:'Origin',
  }:{};
}

function jsonResponse(body,{status,origin=null,headers={}}){
  const correlationHeaders=typeof body?.requestId==='string'?{'x-request-id':body.requestId}:{};
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'cache-control':'no-store',
      'content-type':'application/json; charset=utf-8',
      'x-content-type-options':'nosniff',
      ...correlationHeaders,
      ...corsHeaders(origin),
      ...headers,
    },
  });
}

function errorResponse({status,code,message,requestId:correlationId,origin=null,details=[],headers={}}){
  return jsonResponse({
    ok:false,
    error:{code,message,details},
    requestId:correlationId,
  },{status,origin,headers});
}

function logEvent({logger,level,event,fields={}}){
  const entry=JSON.stringify({event,...fields});
  const method=typeof logger[level]==='function'?level:'log';
  logger[method](entry);
}

function missingConfig(env){
  const missing=REQUIRED_CONFIG.filter(key=>typeof env[key]!=='string'||!env[key].trim());
  if(!env.CONTACT_RATE_LIMITER||typeof env.CONTACT_RATE_LIMITER.limit!=='function')missing.push('CONTACT_RATE_LIMITER');
  return missing;
}

async function verifyTurnstile(submission,request,env,fetchImpl){
  const form=new URLSearchParams({
    secret:env.TURNSTILE_SECRET_KEY,
    response:submission.turnstileToken,
    idempotency_key:submission.submissionId,
  });
  const remoteIp=request.headers.get('cf-connecting-ip');
  if(remoteIp)form.set('remoteip',remoteIp);

  let response;
  try{
    response=await fetchImpl(env.TURNSTILE_VERIFY_URL,{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:form,
    });
  }catch(error){
    throw new ExternalServiceError('verification_unavailable',{providerCode:error?.name||'network_error'});
  }

  let result;
  try{
    result=await response.json();
  }catch{
    throw new ExternalServiceError('verification_unavailable',{providerStatus:response.status,providerCode:'invalid_response'});
  }
  if(!response.ok){
    throw new ExternalServiceError('verification_unavailable',{providerStatus:response.status,providerCode:'http_error'});
  }

  const expectedHostnames=parseList(env.TURNSTILE_EXPECTED_HOSTNAMES);
  const validHostname=expectedHostnames.has(result.hostname);
  const validAction=result.action===env.TURNSTILE_EXPECTED_ACTION;
  const validTestResult=env.TURNSTILE_ALLOW_TEST_RESULT==='true'&&result?.metadata?.result_with_testing_key===true;
  if(!result.success||(!validTestResult&&(!validHostname||!validAction))){
    return {
      ok:false,
      providerCode:Array.isArray(result['error-codes'])?result['error-codes'].join(','):'challenge_rejected',
    };
  }
  return {ok:true};
}

async function sendEmail(submission,env,fetchImpl){
  const message=buildEmailMessage(submission,{
    from:env.CONTACT_FROM_EMAIL,
    to:env.CONTACT_TO_EMAIL,
  });
  let response;
  try{
    response=await fetchImpl(env.RESEND_API_URL,{
      method:'POST',
      headers:{
        authorization:`Bearer ${env.RESEND_API_KEY}`,
        'content-type':'application/json',
        'idempotency-key':`contact-enquiry/${submission.submissionId}`,
        'user-agent':env.RESEND_USER_AGENT,
      },
      body:JSON.stringify(message),
    });
  }catch(error){
    throw new ExternalServiceError('email_delivery_failed',{providerCode:error?.name||'network_error'});
  }

  let result={};
  try{
    result=await response.json();
  }catch{
    result={name:'invalid_response'};
    if(response.ok)throw new ExternalServiceError('email_delivery_failed',{providerStatus:response.status,providerCode:'invalid_response'});
  }
  if(!response.ok){
    throw new ExternalServiceError('email_delivery_failed',{
      providerStatus:response.status,
      providerCode:typeof result?.name==='string'?result.name:'provider_error',
    });
  }
  return {providerStatus:response.status};
}

export function createContactHandler({fetchImpl=null,logger=null,clock=null}={}){
  return async function handleContactRequest(request,env){
    const startedAt=(clock||performance).now();
    const activeLogger=logger||console;
    const activeFetch=fetchImpl||globalThis.fetch;
    let correlationId=requestId();
    const url=new URL(request.url);
    const origin=request.headers.get('origin')||'';
    const allowedOrigins=parseList(env.ALLOWED_ORIGINS);
    const allowedOrigin=allowedOrigins.has(origin)?origin:null;
    const duration=()=>Math.max(0,Math.round((clock||performance).now()-startedAt));
    const reject=(status,code,message,details=[])=>{
    logEvent({logger:activeLogger,level:'warn',event:'contact_request_rejected',fields:{
        requestId:correlationId,
        origin,
        status,
        stage:code,
        durationMs:duration(),
      }});
      return errorResponse({status,code,message,requestId:correlationId,origin:allowedOrigin,details});
    };

    if(url.pathname!=='/contact')return reject(404,'not_found','The requested endpoint was not found.');
    if(request.method==='OPTIONS'){
      if(!allowedOrigin)return reject(403,'origin_not_allowed','This website origin is not allowed to submit enquiries.');
      return new Response(null,{status:204,headers:{
        'cache-control':'no-store',
        'x-content-type-options':'nosniff',
        'x-request-id':correlationId,
        ...corsHeaders(allowedOrigin),
      }});
    }
    if(request.method!=='POST'){
      const response=reject(405,'method_not_allowed','Use POST to submit an enquiry.');
      response.headers.set('allow','POST, OPTIONS');
      return response;
    }
    if(!allowedOrigin)return reject(403,'origin_not_allowed','This website origin is not allowed to submit enquiries.');
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')){
      return reject(415,'unsupported_media_type','Submit the enquiry as JSON.');
    }

    const missing=missingConfig(env);
    if(missing.length){
      logEvent({logger:activeLogger,level:'error',event:'contact_delivery_failed',fields:{
        requestId:correlationId,
        origin,
        status:503,
        stage:'configuration',
        missingConfig:missing,
        durationMs:duration(),
      }});
      return errorResponse({
        status:503,
        code:'service_unavailable',
        message:'Online enquiry delivery is temporarily unavailable. Please use the direct email address.',
        requestId:correlationId,
        origin:allowedOrigin,
      });
    }

    const rateKey=request.headers.get('cf-connecting-ip')||'unknown-client';
    let rateResult;
    try{
      rateResult=await env.CONTACT_RATE_LIMITER.limit({key:`contact:${rateKey}`});
    }catch{
      logEvent({logger:activeLogger,level:'error',event:'contact_delivery_failed',fields:{
        requestId:correlationId,
        origin,
        status:503,
        stage:'rate_limiter_unavailable',
        durationMs:duration(),
      }});
      return errorResponse({
        status:503,
        code:'service_unavailable',
        message:'Online enquiry delivery is temporarily unavailable. Please use the direct email address.',
        requestId:correlationId,
        origin:allowedOrigin,
      });
    }
    if(!rateResult.success){
      logEvent({logger:activeLogger,level:'warn',event:'contact_request_rate_limited',fields:{
        requestId:correlationId,
        origin,
        status:429,
        durationMs:duration(),
      }});
      return errorResponse({
        status:429,
        code:'rate_limited',
        message:'Too many enquiries were submitted. Please wait and try again, or use the direct email address.',
        requestId:correlationId,
        origin:allowedOrigin,
        headers:{'retry-after':'60'},
      });
    }

    const declaredLength=Number(request.headers.get('content-length')||0);
    if(Number.isFinite(declaredLength)&&declaredLength>MAX_REQUEST_BODY_BYTES){
      return reject(413,'request_too_large','The enquiry is too large to submit.');
    }
    let rawBody;
    try{
      rawBody=await request.text();
    }catch{
      return reject(400,'invalid_request_body','The enquiry payload could not be read.');
    }
    if(new TextEncoder().encode(rawBody).byteLength>MAX_REQUEST_BODY_BYTES){
      return reject(413,'request_too_large','The enquiry is too large to submit.');
    }

    let input;
    try{
      input=JSON.parse(rawBody);
    }catch{
      return reject(400,'invalid_json','The enquiry payload is not valid JSON.');
    }
    const validation=validateSubmission(input);
    if(!validation.ok){
      return reject(422,'invalid_request','Check the highlighted enquiry fields and try again.',validation.errors);
    }
    const submission=validation.value;
    correlationId=submission.submissionId;

    logEvent({logger:activeLogger,level:'info',event:'contact_request_received',fields:{
      requestId:correlationId,
      origin,
      status:202,
      stage:'validated',
      durationMs:duration(),
    }});

    if(submission.website){
      logEvent({logger:activeLogger,level:'warn',event:'contact_request_trapped',fields:{
        requestId:correlationId,
        origin,
        status:202,
        durationMs:duration(),
      }});
      return jsonResponse({ok:true,requestId:correlationId},{status:202,origin:allowedOrigin});
    }

    try{
      const verification=await verifyTurnstile(submission,request,env,activeFetch);
      if(!verification.ok){
        logEvent({logger:activeLogger,level:'warn',event:'turnstile_verification_failed',fields:{
          requestId:correlationId,
          origin,
          status:403,
          providerCode:verification.providerCode,
          durationMs:duration(),
        }});
        return errorResponse({
          status:403,
          code:'verification_failed',
          message:'The security check could not be verified. Please complete it again.',
          requestId:correlationId,
          origin:allowedOrigin,
        });
      }

      const delivery=await sendEmail(submission,env,activeFetch);
      logEvent({logger:activeLogger,level:'info',event:'contact_delivery_accepted',fields:{
        requestId:correlationId,
        origin,
        status:202,
        providerStatus:delivery.providerStatus,
        durationMs:duration(),
      }});
      return jsonResponse({ok:true,requestId:correlationId},{status:202,origin:allowedOrigin});
    }catch(error){
      if(!(error instanceof ExternalServiceError)){
        logEvent({logger:activeLogger,level:'error',event:'contact_delivery_failed',fields:{
          requestId:correlationId,
          origin,
          status:500,
          stage:'unexpected',
          durationMs:duration(),
        }});
        return errorResponse({
          status:500,
          code:'internal_error',
          message:'The enquiry could not be sent. Please try again or use the direct email address.',
          requestId:correlationId,
          origin:allowedOrigin,
        });
      }
      logEvent({logger:activeLogger,level:'error',event:'contact_delivery_failed',fields:{
        requestId:correlationId,
        origin,
        status:error.status,
        stage:error.code,
        providerStatus:error.providerStatus,
        providerCode:error.providerCode,
        durationMs:duration(),
      }});
      return errorResponse({
        status:error.status,
        code:error.code,
        message:'The enquiry could not be sent. Please try again or use the direct email address.',
        requestId:correlationId,
        origin:allowedOrigin,
      });
    }
  };
}

export default {
  fetch(request,env){
    return createContactHandler()(request,env);
  },
};
