export const REQUEST_TYPES=Object.freeze({
  'capability-briefing':'Request a Capability Briefing',
  demonstration:'Arrange a Demonstration',
  'pilot-program':'Discuss a Pilot Program',
  'general-enquiry':'General Enquiry',
});

export const SECTORS=Object.freeze({
  'defence-national-security':'Defence & National Security',
  'border-maritime-coastal-security':'Border, Maritime & Coastal Security',
  'public-safety-emergency-services':'Public Safety & Emergency Services',
  'surveying-geospatial-digital-twins':'Surveying, Geospatial & Digital Twins',
  'utilities-critical-infrastructure':'Utilities & Critical Infrastructure',
  'mining-resources':'Mining & Resources',
  'construction-major-projects':'Construction & Major Projects',
  'agriculture-forestry-environment':'Agriculture, Forestry & Environment',
  other:'Other',
});

const FIELD_LIMITS=Object.freeze({
  submissionId:36,
  name:100,
  organisation:160,
  email:254,
  mission:4000,
  website:200,
  turnstileToken:2048,
});

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN=/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu;

function isRecord(value){
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value));
}

function readString(input,field,{required=false,maxLength}){
  const raw=input[field];
  if(raw===undefined||raw===null){
    return required?{error:{field,code:'required'}}:{value:''};
  }
  if(typeof raw!=='string')return {error:{field,code:'invalid_type'}};
  const value=raw.trim();
  if(required&&!value)return {error:{field,code:'required'}};
  if(value.length>maxLength)return {error:{field,code:'too_long'}};
  return {value};
}

export function validateSubmission(input){
  if(!isRecord(input))return {ok:false,errors:[{field:'body',code:'invalid_type'}]};

  const errors=[];
  const values={};
  const fields=[
    ['submissionId',{required:true,maxLength:FIELD_LIMITS.submissionId}],
    ['name',{required:true,maxLength:FIELD_LIMITS.name}],
    ['organisation',{maxLength:FIELD_LIMITS.organisation}],
    ['email',{required:true,maxLength:FIELD_LIMITS.email}],
    ['mission',{maxLength:FIELD_LIMITS.mission}],
    ['website',{maxLength:FIELD_LIMITS.website}],
    ['turnstileToken',{required:true,maxLength:FIELD_LIMITS.turnstileToken}],
  ];

  for(const [field,options] of fields){
    const result=readString(input,field,options);
    if(result.error)errors.push(result.error);
    else values[field]=result.value;
  }

  if(typeof input.requestType!=='string'||!Object.hasOwn(REQUEST_TYPES,input.requestType)){
    errors.push({field:'requestType',code:'unsupported_value'});
  }else values.requestType=input.requestType;

  if(typeof input.sector!=='string'||!Object.hasOwn(SECTORS,input.sector)){
    errors.push({field:'sector',code:'unsupported_value'});
  }else values.sector=input.sector;

  if(values.submissionId&&!UUID_PATTERN.test(values.submissionId)){
    errors.push({field:'submissionId',code:'invalid_format'});
  }
  if(values.email&&!EMAIL_PATTERN.test(values.email)){
    errors.push({field:'email',code:'invalid_format'});
  }

  return errors.length?{ok:false,errors}:{ok:true,value:Object.freeze(values)};
}

function escapeHtml(value){
  return value.replace(/[&<>'"]/g,character=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    "'":'&#39;',
    '"':'&quot;',
  })[character]);
}

function displayValue(value){
  return value||'Not provided';
}

export function buildEmailMessage(submission,{from,to}){
  const requestLabel=REQUEST_TYPES[submission.requestType];
  const sectorLabel=SECTORS[submission.sector];
  const fields=[
    ['Request type',requestLabel],
    ['Name',submission.name],
    ['Organisation',displayValue(submission.organisation)],
    ['Email',submission.email],
    ['Sector',sectorLabel],
    ['Mission requirement',displayValue(submission.mission)],
    ['Submission ID',submission.submissionId],
  ];
  const text=fields.map(([label,value])=>`${label}: ${value}`).join('\n\n');
  const rows=fields.map(([label,value])=>`<tr><th style="padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #d8dee8">${escapeHtml(label)}</th><td style="padding:10px 12px;white-space:pre-wrap;border-bottom:1px solid #d8dee8">${escapeHtml(value)}</td></tr>`).join('');
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#101827"><h1 style="font-size:22px">New website enquiry</h1><table style="width:100%;border-collapse:collapse">${rows}</table></body></html>`;
  return Object.freeze({
    from,
    to:[to],
    reply_to:submission.email,
    subject:`[Website enquiry] ${requestLabel}`,
    text,
    html,
  });
}
