import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(testDirectory,'..');
const siteSource=fs.readFileSync(path.join(root,'site.js'),'utf8');
const visualCss=fs.readFileSync(path.join(root,'visual-2026.css'),'utf8');

function createMotionHarness({motionAllowed=true}={}){
 let stageTop=0,nextFrameId=1;
 const stageSize={height:800,width:1400};
 const styles=new Map(),classes=new Set(),frames=new Map(),observers=[];
 const listeners=new Map([['scroll',new Set()],['resize',new Set()]]);
 const mediaListeners=new Set();
 const stage={
  getBoundingClientRect:()=>({
   top:stageTop,
   bottom:stageTop+stageSize.height,
   ...stageSize,
  }),
 };
 const statement={
  classList:{toggle:(name,enabled)=>enabled?classes.add(name):classes.delete(name)},
  style:{
   setProperty:(name,value)=>styles.set(name,value),
   removeProperty:name=>styles.delete(name),
  },
 };
 const motionPreference={
  matches:motionAllowed,
  addEventListener:(type,listener)=>{if(type==='change')mediaListeners.add(listener)},
 };
 class FakeIntersectionObserver{
  constructor(callback){this.callback=callback;observers.push(this)}
  observe(target){this.target=target}
 }
 const context={
  document:{
   addEventListener:()=>{},
   querySelector:selector=>selector==='.hero-stage'?stage:selector==='.hero-statement'?statement:null,
   querySelectorAll:()=>[],
  },
  matchMedia:()=>motionPreference,
  IntersectionObserver:FakeIntersectionObserver,
  innerHeight:900,
  requestAnimationFrame:callback=>{
   const id=nextFrameId++;
   frames.set(id,callback);
   return id;
  },
  cancelAnimationFrame:id=>frames.delete(id),
  addEventListener:(type,listener)=>listeners.get(type)?.add(listener),
  removeEventListener:(type,listener)=>listeners.get(type)?.delete(listener),
 };
 vm.runInNewContext(siteSource,context);
 return {
  init:()=>context.initHeroStatementMotion(),
  enter:()=>observers[0].callback([{isIntersecting:true}]),
  exit:()=>observers[0].callback([{isIntersecting:false}]),
  scroll:()=>listeners.get('scroll').forEach(listener=>listener()),
  setStageTop:value=>{stageTop=value},
  flushFrames:()=>{
   const pending=[...frames.values()];
   frames.clear();
   pending.forEach(callback=>callback());
  },
  setMotionAllowed:value=>{
   motionPreference.matches=value;
   mediaListeners.forEach(listener=>listener());
  },
  shift:()=>styles.get('--hero-statement-shift'),
  isActive:()=>classes.has('is-scroll-active'),
  listenerCount:type=>listeners.get(type).size,
  pendingFrameCount:()=>frames.size,
 };
}

test('the production hero statement coordinator follows scroll and stops offscreen',()=>{
 const harness=createMotionHarness();
 harness.init();
 harness.enter();

 assert.equal(harness.isActive(),true);
 assert.equal(harness.listenerCount('scroll'),1);
 assert.equal(harness.pendingFrameCount(),1);
 harness.flushFrames();
 assert.equal(harness.shift(),'0px');

 harness.setStageTop(-400);
 harness.scroll();
 harness.scroll();
 assert.equal(harness.pendingFrameCount(),1,'scroll events should share one animation frame');
 harness.flushFrames();
 assert.equal(harness.shift(),'-160px');

 harness.setStageTop(-1600);
 harness.scroll();
 harness.flushFrames();
 assert.equal(harness.shift(),'-320px','the lift should clamp to the configured maximum');

 harness.scroll();
 assert.equal(harness.pendingFrameCount(),1);
 harness.exit();
 assert.equal(harness.isActive(),false);
 assert.equal(harness.listenerCount('scroll'),0);
 assert.equal(harness.pendingFrameCount(),0,'leaving the hero should cancel pending work');
});

test('reduced motion keeps the statement at its authored position',()=>{
 const harness=createMotionHarness({motionAllowed:false});
 harness.init();
 harness.enter();

 assert.equal(harness.isActive(),false);
 assert.equal(harness.listenerCount('scroll'),0);
 assert.equal(harness.pendingFrameCount(),0);
 assert.equal(harness.shift(),undefined);

 harness.setMotionAllowed(true);
 assert.equal(harness.isActive(),true);
 harness.flushFrames();
 harness.setMotionAllowed(false);
 assert.equal(harness.isActive(),false);
 assert.equal(harness.shift(),undefined);
});

test('the homepage wires the motion coordinator and CSS fallback',()=>{
 assert.match(siteSource,/document\.body\.innerHTML=render\(\);\s*initHeroStatementMotion\(\);/);
 assert.match(visualCss,/\.hero-editorial \.hero-statement\{[^}]*transform:translate3d\(0,var\(--hero-statement-shift,0px\),0\)/);
 assert.match(visualCss,/\.hero-editorial \.hero-statement\.is-scroll-active\{will-change:transform}/);
 assert.match(visualCss,/@media\(prefers-reduced-motion:reduce\)\{/);
 assert.match(visualCss,/\.hero-editorial \.hero-statement\{transform:none!important}/);
});

test('site pages load the current motion assets without stale browser cache',()=>{
 const pages=['index.html','missions.html','mission.html','systems.html','platform.html','industries.html','industry.html','contact.html'];
 for(const page of pages){
  const html=fs.readFileSync(path.join(root,page),'utf8');
  assert.match(html,/visual-2026\.css\?v=20260811-contact-delivery-1/,`${page} should version the motion stylesheet`);
  assert.match(html,/site\.js\?v=20260811-contact-delivery-1/,`${page} should version the motion script`);
 }
});
