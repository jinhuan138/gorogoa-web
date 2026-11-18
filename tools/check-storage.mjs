import fs from'node:fs';import assert from'node:assert/strict';import{ProjectModel}from'../src/engine/project.js';import{RuntimeState}from'../src/engine/state.js';import{snapshot,restore,readSave,writeSave}from'../src/engine/storage.js';
const p=new ProjectModel(JSON.parse(fs.readFileSync(new URL('../public/assets/data/runtime-project.json',import.meta.url),'utf8').replace(/^\uFEFF/,''))),s=new RuntimeState(p),saved=snapshot(s),fresh=new RuntimeState(p);restore(fresh,saved);assert.deepEqual(snapshot(fresh),saved);
for(const mutate of[d=>d.format='wrong',d=>d.locations[0][1]='missing',d=>d.states.pop(),d=>d.coords.push([d.inPlay[0],[2,0]]),d=>d.captors.push([d.inPlay[0],d.inPlay[0]])]){const bad=structuredClone(saved);mutate(bad);assert.throws(()=>restore(fresh,bad));assert.deepEqual(snapshot(fresh),saved);}
const backing=new Map(),storage={getItem:k=>backing.get(k),setItem:(k,v)=>backing.set(k,v)};assert.equal(readSave(storage,'game',fresh),false);assert.equal(writeSave(storage,'game',s),true);assert.equal(readSave(storage,'game',fresh),true);backing.set('game','invalid');assert.equal(readSave(storage,'game',fresh),false);assert.equal(writeSave({setItem(){throw new Error('quota');}},'game',s),false);
console.log('存档检查通过：真实完整状态往返、错误引用/不完整状态/叠层循环拒绝、失败不污染现场、浏览器容量不足兼容。');

// 真实window捕获关系的完整往返必须包含方向，否则OVER/UNDER判定会丢失。
const {LinkModel}=await import('../src/engine/links.js');
const captured=new RuntimeState(p),owner=p.get(p.tree.attrs.staringCard).attrs.guid;
captured.setLocation(owner,'window-fec0e0e5-9948-45c0-a43a-26d01d59cd0c');captured.coords.set(owner,[0,0]);
const final=p.get('final-83bb9e64-d64a-450f-bf1d-04015cfdf6db');captured.setState(captured.stateOwners.get(final.attrs.guid),final);
const links=new LinkModel(p,captured),candidate=links.getCaptureCandidate(owner,'OVER');assert.ok(candidate);assert.equal(links.capture(owner,candidate.cardGUID,'OVER'),true);
const capturedData=snapshot(captured),restoredCapture=new RuntimeState(p);assert.deepEqual(capturedData.captureSides,[[candidate.cardGUID,'OVER']]);restore(restoredCapture,capturedData);
assert.deepEqual(snapshot(restoredCapture),capturedData);assert.equal(restoredCapture.captors.get(candidate.cardGUID),owner);assert.equal(restoredCapture.captureSides.get(candidate.cardGUID),'OVER');
const restoredLinks=new LinkModel(p,restoredCapture);assert.equal(restoredLinks.getCaptureCandidate(owner,'OVER')?.cardGUID,candidate.cardGUID);assert.equal(restoredLinks.captureSides,restoredCapture.captureSides);
for(const side of ['OVER','UNDER']){const data=structuredClone(capturedData);data.captureSides=[[candidate.cardGUID,side]];const target=new RuntimeState(p);restore(target,data);assert.equal(target.captureSides.get(candidate.cardGUID),side);assert.deepEqual(snapshot(target).captureSides,data.captureSides);}
for(const mutate of[d=>delete d.captureSides,d=>d.captureSides=[],d=>d.captureSides[0][1]='LEFT',d=>d.captureSides.push([owner,'UNDER']),d=>d.captureSides.push([...d.captureSides[0]])]){
  const bad=structuredClone(capturedData);mutate(bad);assert.throws(()=>restore(restoredCapture,bad));assert.deepEqual(snapshot(restoredCapture),capturedData,'方向无效的存档不得部分覆盖现场');
}
const persisted=new Map(),captureStorage={getItem:k=>persisted.get(k),setItem:(k,v)=>persisted.set(k,v)};assert.equal(writeSave(captureStorage,'captured',captured),true);const persistedState=new RuntimeState(p);assert.equal(readSave(captureStorage,'captured',persistedState),true);assert.equal(persistedState.captureSides.get(candidate.cardGUID),'OVER');assert.equal(new LinkModel(p,persistedState).getCaptureCandidate(owner,'OVER')?.cardGUID,candidate.cardGUID);
console.log('捕获存档回归通过：真实window捕获关系/方向完整往返、OVER/UNDER保存、缺失/非法/孤立/重复方向拒绝、失败不污染现场。');
