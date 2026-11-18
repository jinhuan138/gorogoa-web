import { CARD_SIZE } from './camera.js';
import { clamp01, interpFraction, rangeFraction } from './animation.js';

// PlayingGridLayout uses an 8-unit inset around a 2×2 grid of touching cells.
export const BOARD_INSET = 8;
export const BOARD_SIZE = 2 * CARD_SIZE + 2 * BOARD_INSET;
export const CELLS = Object.freeze([[0,0],[1,0],[0,1],[1,1]].map(Object.freeze));
export const STORY_PHASES = Object.freeze(['PROLOGUE','CHAPTERS','EPILOGUE','ENDING']);
export const centerCard = () => [(BOARD_SIZE-CARD_SIZE)/2,(BOARD_SIZE-CARD_SIZE)/2];
export const cellPosition = ([col,row]) => [BOARD_INSET+col*CARD_SIZE,BOARD_INSET+row*CARD_SIZE];
const equal = (a,b) => Boolean(a&&b&&a[0]===b[0]&&a[1]===b[1]);
const flightPosition = (a,b,f) => a.map((v,i)=>Math.trunc(v+(b[i]-v)*interpFraction(i===0?'TO_SINE':'FROM_SINE',f)));

export function currentStoryPhase(state) {
  if(STORY_PHASES.includes(state.storyPhase)) return state.storyPhase;
  // Older browser saves have no phase. Their stable end-state or board layout still identifies CHAPTERS.
  const end = state.project.tree.attrs.prologueEndState;
  return (end&&[...state.states.values()].includes(end))||
    state.inPlay.size>1||state.captors.size>0||
    [...state.coords.values()].some(p=>!equal(p,CELLS[0])) ? 'CHAPTERS' : 'PROLOGUE';
}

export function nextStoryPhase(state,phase) {
  const field = {PROLOGUE:'prologueEndState',CHAPTERS:'epilogueBeginState',EPILOGUE:'endingTransitionState'}[phase];
  const guid = state.project.tree.attrs[field];
  const owner = state.stateOwners.get(guid);
  return owner&&state.states.get(owner.attrs.guid)===guid ? STORY_PHASES[STORY_PHASES.indexOf(phase)+1] : phase;
}

export function chapterOpening(elapsed) {
  // GridInitAnimation and mode 3 CardFlightAnimation both last two seconds.
  const progress = clamp01(elapsed/2);
  return { complete:progress===1, progress, position:flightPosition(centerCard(),cellPosition(CELLS[0]),clamp01(rangeFraction(progress,0.6,1))) };
}

export function chapterClosing(cell,elapsed) {
  // GridFinalAnimation and mode 4 CardFlightAnimation both last three seconds.
  const progress=clamp01(elapsed/3),eased=interpFraction('SINE',progress);
  const center=centerCard(),from=cellPosition(cell),dx=from[0]-center[0],dy=from[1]-center[1];
  const radius=Math.hypot(dx,dy)*(1-interpFraction('TO_SINE',eased));
  // Unity measures positive angles in its upward Y axis; canvas Y points down.
  const angle=Math.atan2(dy,dx)-Math.PI*1.5*eased;
  const position=progress===0?from:progress===1?center:[center[0]+radius*Math.cos(angle),center[1]+radius*Math.sin(angle)];
  return {complete:progress===1,position,scale:1-.5*eased,alpha:1-eased};
}

// Unity tests the dragged rectangle's center, then takes the closest cell center if outside.
export function dropCell(topLeft) {
  const center = topLeft.map(v=>v+CARD_SIZE/2);
  const inside = center.every(v=>v>=BOARD_INSET&&v<BOARD_SIZE-BOARD_INSET);
  if(inside) return CELLS.find(cell=>cell.every((v,i)=>v===Math.floor((center[i]-BOARD_INSET)/CARD_SIZE)));
  let closest=CELLS[0],distance=Infinity;
  for(const cell of CELLS){
    const pos=cellPosition(cell), squared=pos.reduce((sum,value,i)=>sum+(center[i]-value-CARD_SIZE/2)**2,0);
    if(squared<distance){distance=squared;closest=cell;}
  }
  return closest;
}

export function beginCardDrag(links,guid) {
  const state=links.state;
  const before={ coords:new Map(state.coords), inPlay:new Set(state.inPlay), captors:new Map(state.captors), sides:new Map(links.captureSides) };
  return {...links.release(guid),before};
}

export function cancelCardDrag(links,drag) {
  const s=links.state,{coords,inPlay,captors,sides}=drag.before;
  s.coords=coords;s.inPlay=inPlay;s.captors=captors;
  links.captureSides.clear();
  for(const [guid,side] of sides) links.captureSides.set(guid,side);
  s.version++;
  links.refresh();
}

const cardAt=(state,cell)=>[...state.coords].find(([,point])=>equal(point,cell))?.[0];
const firstEmpty=state=>CELLS.find(cell=>!cardAt(state,cell));
function canStack(links,dragged,occupant) {
  return links.enabled.some(link=>{
    const owner=links.cardOf(link)?.attrs.guid;
    return link.attrs.direction==='UNDER'&&owner===dragged&&link.attrs.otherCard===occupant||
      link.attrs.direction==='OVER'&&owner===occupant&&link.attrs.otherCard===dragged;
  });
}

export function planCardDrop(links,drag,topLeft,canMove=()=>true) {
  const s=links.state,guid=drag.draggedGUID;
  let cell=dropCell(topLeft),occupant=cardAt(s,cell),shuffle=null;
  links.refresh();
  if(occupant&&!canStack(links,guid,occupant)){
    const under=links.active.some(l=>links.cardOf(l)?.attrs.guid===occupant&&l.attrs.direction==='UNDER');
    // GridViewerPanel.shuffleCard only moves an interactive occupant with no attached lower card.
    if(canMove(occupant)&&!under&&drag.from&&!equal(drag.from,cell)&&!cardAt(s,drag.from)){
      shuffle={guid:occupant,from:cell,to:drag.from};
    }else{
      cell=drag.from;
      occupant=cell&&cardAt(s,cell);
      if(!cell||occupant&&!canStack(links,guid,occupant)) cell=firstEmpty(s);
    }
  }
  if(!cell) return null;
  const destination=cellPosition(cell);
  let ms=Math.max(100,Math.min(350,Math.trunc(2*Math.hypot(destination[0]-topLeft[0],destination[1]-topLeft[1]))));
  if(shuffle) {
    const a=cellPosition(shuffle.from),b=cellPosition(shuffle.to);
    ms=Math.max(100,Math.min(350,Math.trunc(2*Math.hypot(b[0]-a[0],b[1]-a[1]))));
  }
  return {cell,shuffle,topLeft,destination,duration:ms/1000};
}

export function sampleCardDrop(plan,elapsed) {
  const progress=clamp01(elapsed/plan.duration);
  const positions={dragged:flightPosition(plan.topLeft,plan.destination,interpFraction('SINE',progress))};
  if(plan.shuffle) positions.shuffled=flightPosition(cellPosition(plan.shuffle.from),cellPosition(plan.shuffle.to),progress);
  return {complete:progress===1,...positions};
}

export function finishCardDrop(links,drag,plan) {
  const s=links.state,guid=drag.draggedGUID;
  if(plan.shuffle){
    const moved=plan.shuffle;
    if(cardAt(s,moved.from)===moved.guid&&!cardAt(s,moved.to)&&links.place(moved.guid,moved.to)){
      if(links.place(guid,plan.cell)) return true;
      links.place(moved.guid,moved.from);
    }
  }else if(links.place(guid,plan.cell)) return true;
  if(drag.from&&links.place(guid,drag.from)) return true;
  const empty=firstEmpty(s);
  if(empty&&links.place(guid,empty)) return true;
  cancelCardDrag(links,drag);
  return false;
}
