import assert from 'node:assert/strict';
import test from 'node:test';

import worker,{createContactHandler} from '../src/index.js';
import {buildEmailMessage,validateSubmission} from '../src/contact.js';

const ORIGIN='https://blueshieldrobotics.com';
const TURNSTILE_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL='https://api.resend.com/emails';

function validSubmission(overrides={}){
  return {
    submissionId:'b83c13b4-70f7-4ca2-a6c7-cf5f4e56a84f',
    requestType:'capability-briefing',
    name:'Alex Example',
    organisation:'Example Operations',
    email:'alex@example.com',
    sector:'defence-national-security',
    mission:'Discuss a non-sensitive capability requirement.',
    website:'',
    turnstileToken:'turnstile-token',
    ...overrides,
  };
}

function env(overrides={}){
  return {
    ALLOWED_ORIGINS:`${ORIGIN},https://www.blueshieldrobotics.com`,
    CONTACT_FROM_EMAIL:'Blue Shield Robotics Website <website@notify.blueshieldrobotics.com>',
    CONTACT_TO_EMAIL:'info@blueshieldrobotics.com',
    RESEND_API_KEY:'test-resend-key',
    RESEND_API_URL:RESEND_URL,
    RESEND_USER_AGENT:'blueshield-contact-worker/test',
    TURNSTILE_EXPECTED_ACTION:'contact_enquiry',
    TURNSTILE_EXPECTED_HOSTNAMES:'blueshieldrobotics.com,www.blueshieldrobotics.com',
    TURNSTILE_SECRET_KEY:'test-turnstile-secret',
    TURNSTILE_VERIFY_URL:TURNSTILE_URL,
    CONTACT_RATE_LIMITER:{limit:async()=>({success:true})},
    ...overrides,
  };
}

function request(body=validSubmission(),overrides={}){
  return new Request('https://contact-worker.example/contact',{
    method:'POST',
    headers:{
      origin:ORIGIN,
      'content-type':'application/json',
      'cf-connecting-ip':'203.0.113.10',
      ...overrides.headers,
    },
    body:typeof body==='string'?body:JSON.stringify(body),
    ...Object.fromEntries(Object.entries(overrides).filter(([key])=>key!=='headers')),
  });
}

function externalFetch({turnstileResult=null,resendResult=null}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(String(url)===TURNSTILE_URL){
      return Response.json(turnstileResult||{
        success:true,
        hostname:'blueshieldrobotics.com',
        action:'contact_enquiry',
      });
    }
    if(String(url)===RESEND_URL){
      return Response.json(resendResult||{id:'email_123'},{status:202});
    }
    throw new Error(`Unexpected external URL: ${url}`);
  };
  return {calls,fetchImpl};
}

function captureLogger(){
  const entries=[];
  return {
    entries,
    logger:{
      info:value=>entries.push(value),
      warn:value=>entries.push(value),
      error:value=>entries.push(value),
      log:value=>entries.push(value),
    },
  };
}

test('validateSubmission accepts the documented enquiry contract',()=>{
  const result=validateSubmission(validSubmission());

  assert.equal(result.ok,true);
  assert.equal(result.value.requestType,'capability-briefing');
  assert.equal(result.value.email,'alex@example.com');
});

for(const [name,overrides,expectedField,expectedCode] of [
  ['missing name',{name:'   '},'name','required'],
  ['invalid email',{email:'not-an-email'},'email','invalid_format'],
  ['invalid email domain',{email:'alex@example..com'},'email','invalid_format'],
  ['unknown request type',{requestType:'unknown'},'requestType','unsupported_value'],
  ['unknown sector',{sector:'unknown'},'sector','unsupported_value'],
  ['invalid submission id',{submissionId:'not-a-uuid'},'submissionId','invalid_format'],
  ['oversized mission',{mission:'x'.repeat(4001)},'mission','too_long'],
]){
  test(`validateSubmission rejects ${name}`,()=>{
    const result=validateSubmission(validSubmission(overrides));

    assert.equal(result.ok,false);
    assert.ok(result.errors.some(error=>error.field===expectedField&&error.code===expectedCode));
  });
}

test('buildEmailMessage fixes sender and recipient while escaping HTML',()=>{
  const submission=validateSubmission(validSubmission({name:'<script>alert(1)</script>'})).value;
  const message=buildEmailMessage(submission,{
    from:'Website <website@notify.blueshieldrobotics.com>',
    to:'info@blueshieldrobotics.com',
  });

  assert.equal(message.from,'Website <website@notify.blueshieldrobotics.com>');
  assert.deepEqual(message.to,['info@blueshieldrobotics.com']);
  assert.equal(message.reply_to,'alex@example.com');
  assert.equal(message.subject,'[Website enquiry] Request a Capability Briefing');
  assert.doesNotMatch(message.html,/<script>/);
  assert.match(message.html,/&lt;script&gt;/);
});

test('the production default handler verifies Turnstile and submits one fixed Resend request',async()=>{
  const mock=externalFetch();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=mock.fetchImpl;
  try{
    const response=await worker.fetch(request(),env());
    const payload=await response.json();

    assert.equal(response.status,202);
    assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
    assert.deepEqual(payload,{ok:true,requestId:validSubmission().submissionId});
    assert.equal(mock.calls.length,2);

    const turnstileCall=mock.calls[0];
    assert.equal(turnstileCall.url,TURNSTILE_URL);
    assert.match(turnstileCall.options.body.toString(),/response=turnstile-token/);
    assert.doesNotMatch(turnstileCall.options.body.toString(),/alex%40example\.com/);

    const resendCall=mock.calls[1];
    const email=JSON.parse(resendCall.options.body);
    assert.equal(resendCall.url,RESEND_URL);
    assert.equal(resendCall.options.headers['idempotency-key'],`contact-enquiry/${validSubmission().submissionId}`);
    assert.equal(resendCall.options.headers['user-agent'],'blueshield-contact-worker/test');
    assert.equal(email.from,env().CONTACT_FROM_EMAIL);
    assert.deepEqual(email.to,[env().CONTACT_TO_EMAIL]);
    assert.equal(email.reply_to,'alex@example.com');
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('the handler rejects an unauthorized origin before calling external services',async()=>{
  const mock=externalFetch();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(validSubmission(),{headers:{origin:'https://attacker.example'}}),env());
  const payload=await response.json();

  assert.equal(response.status,403);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(payload.error.code,'origin_not_allowed');
  assert.equal(mock.calls.length,0);
});

test('the handler returns field-safe validation details and does not send email',async()=>{
  const mock=externalFetch();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(validSubmission({email:'bad'})),env());
  const payload=await response.json();

  assert.equal(response.status,422);
  assert.equal(payload.error.code,'invalid_request');
  assert.deepEqual(payload.error.details,[{field:'email',code:'invalid_format'}]);
  assert.equal(mock.calls.length,0);
});

test('the handler rejects malformed JSON without calling external services',async()=>{
  const mock=externalFetch();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request('{bad json'),env());
  const payload=await response.json();

  assert.equal(response.status,400);
  assert.equal(payload.error.code,'invalid_json');
  assert.equal(mock.calls.length,0);
});

for(const [name,input,expectedStatus,expectedCode] of [
  ['unknown route',new Request('https://contact-worker.example/unknown',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:'{}'}),404,'not_found'],
  ['unsupported method',new Request('https://contact-worker.example/contact',{method:'GET',headers:{origin:ORIGIN}}),405,'method_not_allowed'],
  ['unsupported content type',new Request('https://contact-worker.example/contact',{method:'POST',headers:{origin:ORIGIN,'content-type':'text/plain'},body:'text'}),415,'unsupported_media_type'],
  ['oversized request',new Request('https://contact-worker.example/contact',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:'x'.repeat(16_385)}),413,'request_too_large'],
]){
  test(`the handler rejects an ${name} before provider processing`,async()=>{
    const mock=externalFetch();
    const handler=createContactHandler({fetchImpl:mock.fetchImpl});
    const response=await handler(input.clone(),env());
    const payload=await response.json();

    assert.equal(response.status,expectedStatus);
    assert.equal(payload.error.code,expectedCode);
    assert.equal(mock.calls.length,0);
  });
}

test('a honeypot submission is acknowledged without Turnstile or email delivery',async()=>{
  const mock=externalFetch();
  const captured=captureLogger();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl,logger:captured.logger});
  const response=await handler(request(validSubmission({website:'https://spam.example'})),env());
  const payload=await response.json();

  assert.equal(response.status,202);
  assert.equal(payload.ok,true);
  assert.equal(mock.calls.length,0);
  assert.ok(captured.entries.some(entry=>entry.includes('contact_request_trapped')));
});

test('a failed Turnstile challenge prevents Resend delivery',async()=>{
  const mock=externalFetch({turnstileResult:{success:false,'error-codes':['invalid-input-response']}});
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(),env());
  const payload=await response.json();

  assert.equal(response.status,403);
  assert.equal(payload.error.code,'verification_failed');
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].url,TURNSTILE_URL);
});

for(const [name,turnstileResult] of [
  ['unexpected hostname',{success:true,hostname:'attacker.example',action:'contact_enquiry'}],
  ['unexpected action',{success:true,hostname:'blueshieldrobotics.com',action:'different_action'}],
]){
  test(`Turnstile rejects an ${name}`,async()=>{
    const mock=externalFetch({turnstileResult});
    const handler=createContactHandler({fetchImpl:mock.fetchImpl});
    const response=await handler(request(),env());
    const payload=await response.json();

    assert.equal(response.status,403);
    assert.equal(payload.error.code,'verification_failed');
    assert.equal(mock.calls.length,1);
  });
}

test('the handler accepts an official Turnstile testing result only when locally enabled',async()=>{
  const mock=externalFetch({turnstileResult:{
    success:true,
    hostname:'example.com',
    metadata:{result_with_testing_key:true},
  }});
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(),env({TURNSTILE_ALLOW_TEST_RESULT:'true'}));

  assert.equal(response.status,202);
  assert.equal(mock.calls.length,2);
  assert.equal(mock.calls[1].url,RESEND_URL);
});

test('production rejects an official Turnstile testing result by default',async()=>{
  const mock=externalFetch({turnstileResult:{
    success:true,
    hostname:'example.com',
    metadata:{result_with_testing_key:true},
  }});
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(),env());

  assert.equal(response.status,403);
  assert.equal(mock.calls.length,1);
});

test('the platform rate limiter rejects an attempt before body or provider processing',async()=>{
  const mock=externalFetch();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl});
  const response=await handler(request(),env({
    CONTACT_RATE_LIMITER:{limit:async()=>({success:false})},
  }));
  const payload=await response.json();

  assert.equal(response.status,429);
  assert.equal(payload.error.code,'rate_limited');
  assert.equal(response.headers.get('retry-after'),'60');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(mock.calls.length,0);
});

test('a Resend failure is visible and structured logs contain no enquiry PII',async()=>{
  const mock=externalFetch();
  mock.fetchImpl=async(url,options)=>{
    mock.calls.push({url:String(url),options});
    if(String(url)===TURNSTILE_URL){
      return Response.json({success:true,hostname:'blueshieldrobotics.com',action:'contact_enquiry'});
    }
    return Response.json({name:'rate_limit_exceeded',message:'provider detail'},{status:429});
  };
  const captured=captureLogger();
  const handler=createContactHandler({fetchImpl:mock.fetchImpl,logger:captured.logger});
  const response=await handler(request(),env());
  const payload=await response.json();
  const logs=captured.entries.join('\n');

  assert.equal(response.status,502);
  assert.equal(payload.error.code,'email_delivery_failed');
  assert.doesNotMatch(JSON.stringify(payload),/provider detail/);
  for(const privateValue of ['Alex Example','alex@example.com','Example Operations','non-sensitive capability']){
    assert.doesNotMatch(logs,new RegExp(privateValue,'i'));
  }
  assert.match(logs,/contact_delivery_failed/);
  assert.match(logs,/rate_limit_exceeded/);
});

test('OPTIONS returns a narrow CORS preflight response for an allowed origin',async()=>{
  const handler=createContactHandler();
  const response=await handler(new Request('https://contact-worker.example/contact',{
    method:'OPTIONS',
    headers:{origin:ORIGIN},
  }),env());

  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'),'POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'),'Content-Type');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('x-request-id'),/^[0-9a-f-]{36}$/);
});

test('missing runtime secrets fail closed with a safe service error',async()=>{
  const captured=captureLogger();
  const handler=createContactHandler({logger:captured.logger});
  const response=await handler(request(),env({RESEND_API_KEY:''}));
  const payload=await response.json();

  assert.equal(response.status,503);
  assert.equal(payload.error.code,'service_unavailable');
  assert.ok(captured.entries.some(entry=>entry.includes('RESEND_API_KEY')));
  assert.doesNotMatch(captured.entries.join('\n'),/test-resend-key/);
});
