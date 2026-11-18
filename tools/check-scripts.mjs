import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ProjectModel} from '../src/engine/project.js';
import {RuntimeState} from '../src/engine/state.js';
import {ProjectScripts} from '../src/engine/scripts.js';

const project = new ProjectModel(JSON.parse(readFileSync(new URL('../public/assets/data/runtime-project.json',import.meta.url),'utf8')));
const script = project.all('Script').find(node=>node.attrs.id==='NeedleScript');
const variables = new Map(project.direct(project.container(script,'varTable','StringMap')[0],'entry').map(node=>[node.attrs.key,project.get(node.attrs.value)]));
const scriptCard = project.owner(script,'Card');
const targetLocation = variables.get('trackLocation');
const targetCard = project.owner(targetLocation,'Card');
const enclosingState = variables.get('compassDirContainer');
const rendered = project.all('ScriptedGraphic').find(node=>node.attrs.script===script.attrs.guid);
const predicateByDirection = new Map(project.all('AtomicPredicate').filter(node=>node.attrs.subject===script.attrs.guid).map(node=>[project.get(project.owner(node,'StateTransition').attrs.destinationState).attrs.id,node]));
assert.equal(predicateByDirection.size,8);

function runScenario(own, target, {enable=true,inPlay=true,transition=false,lock=false}={}) {
  const scripts = new ProjectScripts(project);
  const state = new RuntimeState(project,{scriptEvaluator:(script,predicate)=>scripts.evaluate(script,predicate),animationComplete:()=>true});
  const enabling = variables.get('enablingState');
  const enablingOwner = state.stateOwners.get(enabling.attrs.guid);
  state.setState(enablingOwner,enable?enabling:project.container(enablingOwner,'states').find(node=>node!==enabling));
  state.setLocation(targetCard.attrs.guid,targetLocation.attrs.guid);
  state.containers=[enclosingState];
  state.coords.set(scriptCard.attrs.guid,own);
  state.coords.set(targetCard.attrs.guid,target);
  if(!lock)state.inPlay.add(scriptCard.attrs.guid);
  if(inPlay)state.inPlay.add(targetCard.attrs.guid);
  if(transition)state.targets.set(targetCard.attrs.guid,'test-active-transition');
  let moved = false;
  for(let time=0;time<=3000;time+=16) {
    moved = scripts.update(state,time/1000) || moved;
  }
  const direction=[...predicateByDirection].filter(([,predicate])=>state.isSatisfied(predicate)===true).map(([name])=>name);
  assert.equal(direction.length,1);
  state.step();
  assert.equal(project.get(state.states.get(enclosingState.attrs.guid)).attrs.id,direction[0]);
  return {direction:direction[0],moved,scripts};
}

const inputs = [
  ['north',[0,1],[0,0]],['northeast',[0,1],[1,0]],['east',[0,0],[1,0]],['southeast',[0,0],[1,1]],
  ['south',[0,0],[0,1]],['southwest',[1,0],[0,1]],['west',[1,0],[0,0]],['northwest',[1,1],[0,0]],
];
for(const [expected,own,target] of inputs) {
  const result=runScenario(own,target);
  assert.equal(result.direction,expected);
  assert.equal(result.moved,expected!=='north');
}
for(const opts of [{enable:false},{inPlay:false},{transition:true},{lock:true}]) {
  const result=runScenario([0,0],[1,0],opts);
  assert.equal(result.direction,'north');
  assert.equal(result.moved,false);
}
const lockedSave = new RuntimeState(project);
const southeast = project.container(enclosingState,'states').find(node=>node.attrs.id==='southeast');
lockedSave.setState(enclosingState,southeast);
const restoredScripts = new ProjectScripts(project);
restoredScripts.update(lockedSave,0);
restoredScripts.update(lockedSave,2);
assert.equal(lockedSave.states.get(enclosingState.attrs.guid),southeast.attrs.guid,'重新载入后保留锁在叠层中的指南针方向');

const {scripts}=runScenario([0,0],[1,0]);
const layers=scripts.graphics(rendered,[2,0,0,2,17,21]);
assert.deepEqual(layers.map(layer=>layer.node.attrs.id),['_needle_shadow','_needle']);
const [a,b,c,d,x,y]=layers[1].matrix;
assert.ok(Math.abs(a)<1e-6&&Math.abs(d)<1e-6);
assert.ok(Math.abs(b-2)<1e-6&&Math.abs(c+2)<1e-6);
assert.ok(Math.abs(a*175+c*175+x-367)<1e-6);
assert.ok(Math.abs(b*175+d*175+y-371)<1e-6);
assert.ok(Math.abs(layers[0].matrix[5]-y-3.5)<1e-6);
console.log(`真实原版 CompassDirection 八向校验通过，目标门控、原图及阴影变换通过 (${scriptCard.attrs.id} → ${targetCard.attrs.id})`);

// 固定随机值隔离 Unity 的随机种子差异，检查实际原版轨迹、时间和几何输出。
const effects=new ProjectScripts(project,{random:()=>0.1});
const matrix=[1,0,0,1,0,0];
const graphicsByClass=new Map();
for(const graphic of project.all('ScriptedGraphic')) {
  const definition=project.get(graphic.attrs.script);
  const className=definition.attrs.className.split('.').at(-1);
  graphicsByClass.set(className,(graphicsByClass.get(className)||0)+1);
  if(className==='TwinkleScript') {
    assert.equal(effects.durationMillis(graphic),1000);
    assert.deepEqual(effects.graphics(graphic,matrix,{fraction:0.5}),[]);
  }
  if(className!=='FireScript')continue;
  assert.equal(effects.durationMillis(graphic),7500);
  assert.deepEqual(effects.graphics(graphic,matrix,{fraction:0}),[]);
  assert.deepEqual(effects.graphics(graphic,matrix,{fraction:1}),[]);
  const output=effects.graphics(graphic,matrix,{fraction:0.35});
  assert.ok(output.length>0,`${definition.attrs.id} 必须从原版路径生成火焰轮廓`);
  for(const flame of output) {
    assert.strictEqual(flame.matrix,matrix);
    assert.ok(flame.polygon.length>=4);
    assert.ok(flame.polygon.every(point=>point.length===2&&point.every(value=>Number.isFinite(value)&&value>=-350&&value<=700)));
    assert.ok(flame.color.every(value=>Number.isInteger(value)&&value>=0&&value<=255));
  }
  assert.deepEqual(effects.graphics(graphic,matrix,{fraction:0.35}),output);
  assert.notDeepEqual(effects.graphics(graphic,matrix,{fraction:0.36}),output);
}
assert.deepEqual(Object.fromEntries(graphicsByClass),{TwinkleScript:2,FireScript:3,NeedleScript:1});
console.log('三个原版火焰脚本与两个原版星光脚本时长、粒子轮廓和颜色校验通过');
