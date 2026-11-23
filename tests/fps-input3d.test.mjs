import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirstPersonInput3d } from '../assets/runtime/integrations/fps-input3d.js';

class FakeTarget {
  listeners = new Map();
  addEventListener(type, fn) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(fn);
    this.listeners.set(type,handlers);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, values = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target:this, preventDefault(){}, stopPropagation(){},
        ...values });
    }
  }
  totalListeners() { return [...this.listeners.values()].reduce((n,x)=>n+x.size,0); }
}
function fixture(options = {}) {
  const canvas = new FakeTarget();
  canvas.clientWidth = 800;
  canvas.clientHeight = 500;
  canvas.getBoundingClientRect=()=>({left:0,top:0,width:800,height:500});
  canvas.setPointerCapture=()=>{};
  canvas.releasePointerCapture=()=>{};
  const documentRef = new FakeTarget();
  documentRef.pointerLockElement = null;
  documentRef.hidden=false;
  documentRef.exitPointerLock=()=>{
    documentRef.pointerLockElement=null;
    documentRef.emit('pointerlockchange');
  };
  canvas.requestPointerLock=()=>{
    documentRef.pointerLockElement=canvas;
    documentRef.emit('pointerlockchange');
    return Promise.resolve();
  };
  const windowRef = new FakeTarget();
  return {
    canvas, documentRef, windowRef,
    adapter:createFirstPersonInput3d({
      canvas, documentRef, windowRef, navigatorRef:{getGamepads:()=>[]},
      ...options,
    }),
  };
}

test('opt-in FPS input maps keyboard with normalized diagonals and editable-field protection', () => {
  const h=fixture();
  h.windowRef.emit('keydown',{code:'KeyW'});
  h.windowRef.emit('keydown',{code:'KeyD'});
  const input=h.adapter.sample();
  assert.ok(input.move.x > 0.7 && input.move.x < 0.72);
  assert.ok(input.move.y < -0.7 && input.move.y > -0.72);
  assert.equal(input.fire,false);
  h.windowRef.emit('keydown',{code:'KeyR',target:{tagName:'INPUT'}});
  assert.equal(h.adapter.sample().reload,false);
  h.windowRef.emit('keyup',{code:'KeyD'});
  h.windowRef.emit('keyup',{code:'KeyW'});
  assert.deepEqual(h.adapter.sample().move,{x:0,y:0});
  h.adapter.dispose();
  assert.equal(h.windowRef.totalListeners(),0);
});

test('pointer lock is gesture-driven, consumes relative deltas and resets on lost focus', async () => {
  const h=fixture();
  assert.equal(h.documentRef.pointerLockElement,null, 'never lock without a user gesture');
  assert.equal(await h.adapter.requestLock(),true);
  assert.equal(h.adapter.sample().locked,true);
  h.documentRef.emit('pointermove',{pointerType:'mouse',movementX:20,movementY:-10});
  const delta=h.adapter.consumeLook();
  assert.ok(delta.dx > 0.04 && delta.dx < 0.06);
  assert.ok(delta.dy < -0.02 && delta.dy > -0.03);
  assert.deepEqual(h.adapter.consumeLook(),{dx:0,dy:0});
  h.canvas.emit('pointerdown',{button:0,pointerType:'mouse'});
  assert.equal(h.adapter.sample().fire,true);
  h.windowRef.emit('blur');
  assert.equal(h.adapter.sample().fire,false);
  h.adapter.releaseLock();
  assert.equal(h.adapter.sample().locked,false);
  h.adapter.dispose();
  assert.equal(h.documentRef.totalListeners(),0);
});

test('touch left thumb moves, right thumb looks, and multi-pointer releases do not stick', () => {
  const h=fixture();
  h.canvas.emit('pointerdown',{pointerType:'touch',pointerId:10,clientX:100,clientY:250});
  h.canvas.emit('pointerdown',{pointerType:'touch',pointerId:11,clientX:670,clientY:250});
  h.canvas.emit('pointermove',{pointerType:'touch',pointerId:10,clientX:155,clientY:180});
  h.canvas.emit('pointermove',{pointerType:'touch',pointerId:11,clientX:700,clientY:258});
  const state=h.adapter.sample();
  assert.equal(state.touch,true);
  assert.ok(state.move.x>0.4 && state.move.y<-.6);
  const look=h.adapter.consumeLook();
  assert.ok(look.dx>0 && look.dy>0);
  h.canvas.emit('pointerup',{pointerType:'touch',pointerId:10});
  h.canvas.emit('pointercancel',{pointerType:'touch',pointerId:11});
  assert.deepEqual(h.adapter.sample().move,{x:0,y:0});
  assert.deepEqual(h.adapter.consumeLook(),{dx:0,dy:0});
  h.adapter.dispose();
});

test('standard gamepad input applies deadzone and maps primary actions', () => {
  let axes=[0.1,-0.1,0,0];
  const buttons=Array.from({length:16},()=>({pressed:false,value:0}));
  const h=fixture({navigatorRef:{
    getGamepads:()=>[{connected:true,mapping:'standard',axes,buttons}],
  }});
  let input=h.adapter.sample();
  assert.deepEqual(input.move,{x:0,y:0},'stick jitter below deadzone is ignored');
  axes=[0.65,-0.5,0.4,-0.35];
  buttons[7]={pressed:true,value:1};
  buttons[6]={pressed:true,value:1};
  input=h.adapter.sample();
  assert.ok(input.move.x>0.45 && input.move.y<-.25);
  assert.equal(input.fire,true);
  assert.equal(input.ads,true);
  assert.ok(h.adapter.consumeLook().dx>0);
  h.adapter.dispose();
});

test('UI touch action overrides, visibility reset and disposal are safe', () => {
  const h=fixture();
  h.adapter.setAction('fire',true);
  assert.equal(h.adapter.sample().fire,true);
  h.documentRef.hidden=true;
  h.documentRef.emit('visibilitychange');
  assert.equal(h.adapter.sample().fire,false);
  assert.throws(()=>h.adapter.setAction('remoteCode',true), /action/i);
  assert.equal(h.adapter.dispose(),true);
  assert.equal(h.adapter.dispose(),false);
  assert.equal(h.canvas.totalListeners(),0);
  assert.equal(h.windowRef.totalListeners(),0);
});
