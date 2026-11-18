import { AudioBank } from './engine/audio.js';
import { SoundtrackDirector } from './engine/soundtrack.js';
import { planTransition, sampleTransition, hotspotRegion } from './engine/navigation.js';
import { readSave, writeSave } from './engine/storage.js';
import { resolveHoleContent } from './engine/holes.js';
import { LinkModel } from './engine/links.js';
import { BOARD_INSET, BOARD_SIZE, CELLS, centerCard, cellPosition, currentStoryPhase, nextStoryPhase, chapterOpening, chapterClosing, beginCardDrag, cancelCardDrag, planCardDrop, sampleCardDrop, finishCardDrop } from './engine/board.js';
import { loadChapterCheckpoint, loadProject } from './engine/project.js';
import { SceneRenderer, reportTextureUrls } from './engine/renderer.js';
import { RuntimeState } from './engine/state.js';
import { ProjectScripts } from './engine/scripts.js';
import { EndingScreen } from './engine/ending.js';
import { EndingCredits } from './engine/credits.js';
import { StartupScreen } from './engine/startup.js';
import { CARD_SIZE } from './engine/camera.js';
import { languages, supportsLanguage, translate } from './engine/ui-language.js';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),hotspots=document.getElementById('hotspots'),loading=document.getElementById('loading'),notice=document.getElementById('notice');
const boardFrame=document.createElement('canvas');
boardFrame.width=boardFrame.height=BOARD_SIZE*2;
const frameContext=boardFrame.getContext('2d');
const board=document.getElementById('board'),hint=document.getElementById('hint');
const endingCanvas=document.getElementById('ending');
const soundButton = document.getElementById('sound');
const pauseButton = document.getElementById('pause');
const menu = document.getElementById('game-menu');
const menuControls = document.getElementById('menu-controls');
const chapterPanel = document.getElementById('chapter-panel');
const chapterList = document.getElementById('chapter-list');
const confirmation = document.getElementById('menu-confirm');
const confirmButton = document.getElementById('menu-ok');
const cancelButton = document.getElementById('menu-cancel');
const languagePanel = document.getElementById('language-panel');
const titlePanel = document.getElementById('title-panel');
const menuCredits = document.getElementById('settings-credits');
const hintToggle = document.getElementById('show-hints');
const fullscreenToggle = document.getElementById('game-fullscreen');
const settingsStatus = document.getElementById('settings-status');
const soundBank = new AudioBank({ baseUrl: document.baseURI });
const startupButton=document.getElementById('startup');
const gameShell=document.getElementById('game-shell');
const startup=new StartupScreen(startupButton,soundBank,document.baseURI);
let bootReady=false;
soundButton.disabled = true;
let soundDirector, audioFocus, lastCardsInPlay;
const read=async file=>{const response=await fetch(new URL(file,document.baseURI));if(!response.ok)throw new Error(`资源加载失败 (${response.status})`);return response.json();};
const SAVE_KEY='gorogoa-web-progress-v1';let saveStorage;try{saveStorage=globalThis.localStorage;}catch{}let lastSavedVersion=-1;
const CHAPTER_KEY='gorogoa-web-unlocked-chapter';
const SOUND_KEY='gorogoa-web-sound';
const LANGUAGE_KEY='gorogoa-web-language';
const HINTS_KEY='gorogoa-web-visual-hints';
let language='zh-CN', showHints=true, soundLabel='soundOn';
try {
  const savedLanguage=saveStorage?.getItem(LANGUAGE_KEY);
  if(supportsLanguage(savedLanguage))language=savedLanguage;
  showHints=saveStorage?.getItem(HINTS_KEY)!=='off';
} catch {}
const t=(key, number)=>translate(language,key,number);
let maxChapter=1, chapterMilestones=[], margins=[], activeMargin=null, pausedAt=null, pendingChapter=null, confirmReturn;
try { maxChapter=Math.max(1,Math.min(6,Number(saveStorage?.getItem(CHAPTER_KEY))||1)); } catch {}
let soundMuted=false;
try { soundMuted=saveStorage?.getItem(SOUND_KEY)==='off'; } catch {}
for(const channel of ['music','effects']){
  const slider=document.getElementById(`volume-${channel}`);
  const key=`gorogoa-web-volume-${channel}`;
  let volume=1;
  try { volume=Number(saveStorage?.getItem(key)??1); } catch {}
  if(!Number.isFinite(volume)||volume<0||volume>1)volume=1;
  slider.value=String(volume);
  soundBank.setChannelVolume(channel,volume);
  slider.addEventListener('input',()=>{
    soundBank.setChannelVolume(channel,Number(slider.value));
    try { saveStorage?.setItem(key,slider.value); } catch {}
  });
}
let project,state,links,scripts,renderer,manifest,epoch=performance.now(),viewChange=null,dirty=true,drag=null,press=null,opening=null,closing=null,flight=null,lastHotspotKey='',lastStateVersion=-1;
let blockedCards=new Set();
let endingScreen,endingStarted=null,titleFadeStarted=null,creditsPredicate,creditsScreen,creditsData,creditsRequest;
const graphicTimes=new Map(),layerStatus=new Map();
const directionAngle={LEFT_BUTTON:90,RIGHT_BUTTON:-90,UP_BUTTON:180,DOWN_BUTTON:0};
const hotspotLabel={BACK_BUTTON:'retreat',LEFT_BUTTON:'left',RIGHT_BUTTON:'right',UP_BUTTON:'up',DOWN_BUTTON:'down'};
const now=()=> startup.active?0:((pausedAt??performance.now())-epoch)/1000;
const showNotice=message=>{notice.textContent=message;notice.hidden=!message;};
const showGrid=()=>state.storyPhase==='CHAPTERS'||Boolean(closing);
const inputBusy=()=>startup.active||pausedAt!==null||Boolean(viewChange||drag||flight||opening||closing);
const canMove=guid=>!blockedCards.has(guid);
function cards(){
  const front=drag?.draggedGUID||flight?.drag.draggedGUID||closing?.guid;
  return [...state.inPlay].filter(guid=>guid===front||guid===opening?.guid||state.coords.has(guid)).sort((a,b)=>Number(a===front)-Number(b===front)).map(guid=>({guid,location:state.locations.get(guid),coords:state.coords.get(guid)}));
}
function placement(card){
  if(drag?.draggedGUID===card.guid)return drag.topLeft;
  if(flight?.drag.draggedGUID===card.guid)return flight.sample.dragged;
  if(flight?.plan.shuffle?.guid===card.guid)return flight.sample.shuffled;
  if(opening?.guid===card.guid)return opening.sample.position;
  if(closing?.guid===card.guid)return closing.sample.position;
  return showGrid()?cellPosition(card.coords):centerCard();
}
function displayCoords(guid){
  let pixels;
  if(drag?.draggedGUID===guid)pixels=drag.topLeft;
  else if(flight?.drag.draggedGUID===guid)pixels=flight.sample.dragged;
  else if(flight?.plan.shuffle?.guid===guid)pixels=flight.sample.shuffled;
  else if(opening?.guid===guid)pixels=opening.sample.position;
  return pixels?pixels.map(value=>(value-BOARD_INSET)/CARD_SIZE):state.coords.get(guid);
}
function logicalPoint(event){const rect=canvas.getBoundingClientRect();return [(event.clientX-rect.left)/rect.width*BOARD_SIZE,(event.clientY-rect.top)/rect.height*BOARD_SIZE];}
function hitCard(point){return cards().reverse().find(card=>{const[x,y]=placement(card);return point[0]>=x&&point[0]<x+CARD_SIZE&&point[1]>=y&&point[1]<y+CARD_SIZE;});}
function activeTransitions(card){return state.getTransitions(card.guid).filter(t=>t.attrs.hotspotStyle!=='NONE');}
function updateButtons(){
  const visible=inputBusy()?[]:cards().filter(card=>canMove(card.guid)).flatMap(card=>activeTransitions(card).map(transition=>({card,transition})));
  const key=visible.map(({card,transition})=>transition.attrs.guid+':'+placement(card).join(',')).join('|');
  if(key===lastHotspotKey)return;lastHotspotKey=key;hotspots.replaceChildren();
  const size=BOARD_SIZE;for(const {card,transition} of visible){
    const style=transition.attrs.hotspotStyle,button=document.createElement('button'),[cx,cy]=placement(card);let rect;
    try{rect=hotspotRegion(transition);}catch{continue;}
    if(style.endsWith('_BUTTON')){
      rect=[rect[0],rect[1],40/CARD_SIZE,40/CARD_SIZE];button.className='hotspot back';button.textContent={BACK_BUTTON:'↙',UP_BUTTON:'↑',DOWN_BUTTON:'↓',LEFT_BUTTON:'←',RIGHT_BUTTON:'→'}[style]||'↙';
    }else button.className='hotspot';
    if(style.endsWith('_BUTTON')){
      const name=style==='BACK_BUTTON'?'hs_back_button':'hs_button';
      const normal=manifest.textures.find(t=>t.name===name),over=manifest.textures.find(t=>t.name===name+'_over');
      if(normal){
        const imageUrl=texture=>`url("${new URL(texture.url,document.baseURI).href}")`;
        button.textContent='';button.style.background=`transparent ${imageUrl(normal)} center/contain no-repeat`;
        button.style.border='0';button.style.boxShadow='none';
        if(directionAngle[style])button.style.transform=`rotate(${directionAngle[style]}deg)`;
        if(over){button.addEventListener('pointerenter',()=>button.style.backgroundImage=imageUrl(over));button.addEventListener('pointerleave',()=>button.style.backgroundImage=imageUrl(normal));}
      }
    }
    button.setAttribute('aria-label',t(hotspotLabel[style]||'explore'));button.style.left=`${(cx+rect[0]*CARD_SIZE)/size*100}%`;button.style.top=`${(cy+rect[1]*CARD_SIZE)/size*100}%`;button.style.width=`${rect[2]*CARD_SIZE/size*100}%`;button.style.height=`${rect[3]*CARD_SIZE/size*100}%`;button.addEventListener('click',()=>navigate(card,transition));hotspots.append(button);
  }
}
function navigate(card,transition){
  if(inputBusy())return;
  if(transition.attrs.hotspotStyle!=='NONE'&&!canMove(card.guid))return;
  if(!state.getTransitions(card.guid).includes(transition))return;
  try{const plan=planTransition(project,transition);state.targets.set(card.guid,transition.attrs.guid);if(plan.durationSeconds>0)audioFocus=card.guid;viewChange={card:card.guid,destination:plan.destination.attrs.guid,plan,started:now()};board.dataset.cursor='wait';dirty=true;showNotice('');}
  catch(error){showNotice(t('transitionError'));console.warn(error);}
}
function followCapturedTransitions(){
  if(!viewChange)return;
  const target=state.targets.get(viewChange.card);
  for(const guid of state.captors.keys()){
    const transition=state.getTransitions(guid).find(candidate=>{
      if(candidate.attrs.hotspotStyle!=='NONE'||candidate.attrs.transitionDuration!=='0')return false;
      const predicate=project.container(candidate,'predicate')[0];
      return project.container(predicate,'predicates').some(condition=>condition.attrs.subject===target);
    });
    if(transition)state.setLocation(guid,transition.attrs.destLocation);
  }
}
function setHover(event){if(!state)return;const card=hitCard(logicalPoint(event)),old=[...state.hovered].join(',');state.hovered.clear();if(card)state.hovered.add(card.guid);if(old!==[...state.hovered].join(','))dirty=true;updateBoardCursor();}
let waitingForBoardTextures=false;
function updateBoardCursor() {
  const hovered=[...state.hovered][0];
  const waiting=waitingForBoardTextures||viewChange||flight||opening||closing||(hovered&&!canMove(hovered));
  const canDrag=hovered&&state.coords.has(hovered)&&showGrid();
  board.dataset.cursor=drag?'move':waiting?'wait':canDrag?'hand':'default';
}
board.addEventListener('pointerdown',event=>{
  if(!state||inputBusy()||!event.isPrimary||event.button!==0)return;
  setHover(event);
  if(state.storyPhase!=='CHAPTERS')return;
  const point=logicalPoint(event),card=hitCard(point);
  if(!card?.coords||!canMove(card.guid))return;
  const origin=placement(card);
  press={guid:card.guid,id:event.pointerId,clientX:event.clientX,clientY:event.clientY,offset:point.map((v,i)=>v-origin[i])};
});
board.addEventListener('pointermove',event=>{
  if(!state||!event.isPrimary)return;
  if(press&&event.pointerId===press.id&&!event.buttons&&!drag)press=null;
  if(press&&event.pointerId===press.id&&!drag&&!inputBusy()&&canMove(press.guid)&&Math.hypot(event.clientX-press.clientX,event.clientY-press.clientY)>7){
    drag={...beginCardDrag(links,press.guid),offset:press.offset,id:press.id};
    if(drag.direction==='OVER'){
      lastCardsInPlay.add(drag.draggedGUID);
      audioFocus=drag.revealedGUID;
    }
    board.setPointerCapture(event.pointerId);
    soundDirector?.playInterface('int_lift_card');
    press=null;
  }
  if(drag&&event.pointerId===drag.id){
    drag.topLeft=logicalPoint(event).map((v,i)=>v-drag.offset[i]);
    dirty=true;
    updateBoardCursor();
  }else setHover(event);
});
board.addEventListener('pointerleave',()=>{if(state&&!drag){press=null;state.hovered.clear();dirty=true;updateBoardCursor();}});
board.addEventListener('pointerup',event=>{
  if(event.pointerId===press?.id)press=null;
  if(event.pointerId!==drag?.id)return;
  const current=drag;drag=null;
  const topLeft=logicalPoint(event).map((v,i)=>v-current.offset[i]);
  const plan=planCardDrop(links,current,topLeft,canMove);
  if(plan)flight={drag:current,plan,started:now(),sample:sampleCardDrop(plan,0)};
  else cancelCardDrag(links,current);
  dirty=true;
});
function abandonPointer(event){
  if(event.pointerId===press?.id)press=null;
  if(event.pointerId!==drag?.id)return;
  cancelCardDrag(links,drag);drag=null;dirty=true;
}
board.addEventListener('pointercancel',abandonPointer);
board.addEventListener('lostpointercapture',abandonPointer);
function restart({restoreSaved=false,checkpoint=null}={}){
  if(!project)return;
  soundDirector?.stop();epoch=performance.now();graphicTimes.clear();layerStatus.clear();blockedCards.clear();
  viewChange=drag=press=opening=closing=flight=null;
  scripts=new ProjectScripts(project);
  state=new RuntimeState(project,{scriptEvaluator:(definition,predicate)=>scripts.evaluate(definition,predicate),animationComplete:container=>{const cached=layerStatus.get(container.attrs.guid);return cached?(cached.state===state.states.get(container.attrs.guid)?cached.complete:null):true;},onChange:change=>{dirty=true;if(change.kind==='state'&&change.container.type==='SceneLayer'){layerStatus.set(change.container.attrs.guid,{state:change.state.attrs.guid,complete:null});for(const guid of graphicTimes.keys())if(project.owner(project.get(guid),'LocationLayer')?.attrs.sceneLayer===change.container.attrs.guid)graphicTimes.delete(guid);}}});
  state.coords.set(project.tree.attrs.staringCard,[0,0]);
  if(checkpoint)state.applyCheckpoint(checkpoint);
  else if(restoreSaved&&saveStorage)readSave(saveStorage,SAVE_KEY,state);
  else if(saveStorage){try{saveStorage.removeItem(SAVE_KEY);}catch{}}
  state.storyPhase=currentStoryPhase(state);
  endingStarted=state.storyPhase==='ENDING'?-1.6:null;
  titleFadeStarted=null;
  endingCanvas.hidden=true;
  creditsScreen?.reset();
  lastSavedVersion=-1;links=new LinkModel(project,state);links.refresh();lastCardsInPlay=new Set(state.inPlay);audioFocus=[...state.inPlay].at(-1);
  renderer.isSatisfied=node=>state.isSatisfied(node);dirty=true;lastHotspotKey=null;showNotice('');
}
function textureUrl(name) {
  const texture=manifest?.textures.find(entry=>entry.name===name);
  return texture&&new URL(texture.url,document.baseURI).href;
}
function menuPage(page) {
  const settings=page===menuControls||page===chapterPanel;
  for(const panel of [menuControls,chapterPanel,confirmation,languagePanel,titlePanel,menuCredits]){
    if(panel)panel.hidden=panel!==page&&!(settings&&(panel===menuControls||panel===chapterPanel));
  }
  if(settingsStatus){settingsStatus.hidden=true;settingsStatus.textContent='';}
}
function showMenu(open) {
  if(startup.active)return;
  if(!state||open===(pausedAt!==null))return;
  if(open) {
    if(drag){cancelCardDrag(links,drag);drag=null;dirty=true;}
    press=null;
    pausedAt=performance.now();
    showChapters();
  } else {
    epoch+=performance.now()-pausedAt;
    pausedAt=null;
  }
  board.inert=open;
  menu.hidden=!open;
  pauseButton.setAttribute('aria-expanded',String(open));
  pauseButton.setAttribute('aria-label',t(open?'resume':'pause'));
  updateAudioPause().catch(error=>console.warn('声音暂停状态更新失败',error));
  updateButtons();
  pauseButton.focus?.();
}
function confirmMenu(chapter, from) {
  pendingChapter=chapter;
  confirmReturn=from;
  document.getElementById('menu-action').textContent=t(chapter===0?'restartQuestion':'loadQuestion');
  menuPage(confirmation);
  cancelButton.focus?.();
}
function showChapters() {
  chapterList.replaceChildren();
  for(let chapter=1;chapter<=maxChapter;chapter++){
    const option=document.createElement('button');
    option.type='button';
    const label=chapter===1?t('restart'):chapter===6?t('ending'):t('chapter',chapter);
    const name=chapter===1?'new_game_select':`chapter${chapter-1}_end_select`;
    const url=textureUrl(name);
    if(url){
      const image=document.createElement('img');
      image.src=url;image.alt='';
      option.append(image);
    }
    option.setAttribute('aria-label',label);
    if(!url)option.append(label);
    option.addEventListener('click',()=>confirmMenu(chapter===1?0:chapter,chapterPanel));
    chapterList.append(option);
  }
  if(menuCredits){
    const button=document.createElement('button');
    button.type='button';
    button.setAttribute('aria-label',t('credits'));
    const image=document.createElement('img');
    image.src=textureUrl('credits_select');
    image.alt='';
    button.append(image);
    button.addEventListener('click',showMenuCredits);
    chapterList.append(button);
  }
  menuPage(chapterPanel);
}
async function showMenuCredits(){
  menuPage(menuCredits);
  const container=document.getElementById('settings-credits-lines');
  if(container.children.length)return;
  try{
    const {pages}=await read('assets/data/credits.json');
    for(const {lines} of pages){
      for(const {text} of lines){
        const line=document.createElement('p');
        line.textContent=text;
        container.append(line);
      }
    }
  }catch{
    if(!menuCredits.hidden)settingsError(t('loadError'));
  }
}
function settingsError(message){
  settingsStatus.textContent=message;
  settingsStatus.hidden=false;
}
function refreshLanguage(){
  if(document.documentElement)document.documentElement.lang=language;
  menu.dir=language==='ar'?'rtl':'ltr';
  for(const element of document.querySelectorAll?.('[data-text]')??[])element.textContent=t(element.dataset.text);
  for(const [element,key] of [[menu,'menu'],[board,'board'],[canvas,'board'],[hotspots,'hotspots'],[pauseButton,pausedAt===null?'pause':'resume'],
    [startupButton,'startup'],[document.getElementById('credits'),'credits'],
    [document.getElementById('credits-prev'),'previous'],[document.getElementById('credits-next'),'next']]){
    element?.setAttribute('aria-label',t(key));
  }
  if(!bootReady)loading.textContent=t('loading');
  hint.textContent=t(state?.storyPhase==='CHAPTERS'?'boardTip':'prologueTip');
  soundButton.textContent=t(soundLabel);
  soundButton.setAttribute('aria-label',t(soundLabel));
  lastHotspotKey=null;
}
function openLanguages(){
  const list=document.getElementById('language-list');
  list.replaceChildren();
  for(const [code,label] of Object.entries(languages)){
    const button=document.createElement('button');
    button.type='button';
    button.lang=code;
    button.textContent=label;
    button.setAttribute('aria-pressed',String(code===language));
    button.addEventListener('click',()=>{
      language=code;
      try { saveStorage?.setItem(LANGUAGE_KEY,code); } catch {}
      refreshLanguage();
      showChapters();
      document.getElementById('language-open').focus?.();
    });
    list.append(button);
  }
  menuPage(languagePanel);
  list.querySelector('[aria-pressed="true"]')?.focus();
}
function setHintVisibility(){
  if(hintToggle)hintToggle.checked=showHints;
  board.dataset.hints=showHints?'on':'off';
}
setHintVisibility();
refreshLanguage();
hintToggle?.addEventListener('change',()=>{
  showHints=hintToggle.checked;
  setHintVisibility();
  try { saveStorage?.setItem(HINTS_KEY,showHints?'on':'off'); } catch {}
});
function syncFullscreen(){
  if(fullscreenToggle)fullscreenToggle.checked=Boolean(document.fullscreenElement);
}
if(fullscreenToggle){
  document.addEventListener('fullscreenchange',syncFullscreen);
  document.addEventListener('fullscreenerror',syncFullscreen);
  fullscreenToggle.addEventListener('change',async ()=>{
    settingsStatus.hidden=true;
    try{
      if(document.fullscreenElement)await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }catch{settingsError(t('fullscreenError'));}
    finally{syncFullscreen();}
  });
  syncFullscreen();
}
document.getElementById('language-open')?.addEventListener('click',openLanguages);
document.getElementById('language-back')?.addEventListener('click',showChapters);
document.getElementById('settings-credits-back')?.addEventListener('click',showChapters);
document.getElementById('exit-game')?.addEventListener('click',()=>{
  menuPage(titlePanel);
  document.getElementById('title-resume').focus?.();
});
document.getElementById('title-resume')?.addEventListener('click',()=>showMenu(false));
function updateMargin() {
  const next=margins.find(({predicate})=>predicate&&state.isSatisfied(predicate)===true)??null;
  if(next===activeMargin)return;
  activeMargin=next;
  gameShell.dataset.margins=next?'visible':'hidden';
  if(!next)return;
  for(const [side,property] of [['l','left'],['r','right'],['t','top'],['b','bottom']]){
    const name=next.attrs[`${property}ImageFilename`]?.replace(/\.png$/i,'');
    const url=textureUrl(name);
    gameShell.style.setProperty?.(`--margin-${side}`,url?`url("${url}")`:'none');
  }
}
function unlockChapters() {
  const reached=chapterMilestones.findLastIndex(predicate=>state.isSatisfied(predicate)===true)+1;
  if(reached<=maxChapter)return;
  maxChapter=reached;
  try { saveStorage?.setItem(CHAPTER_KEY,String(reached)); } catch {}
}
pauseButton.addEventListener('click',()=>showMenu(pausedAt===null));
document.getElementById('resume')?.addEventListener('click',()=>showMenu(false));
document.getElementById('chapter-select')?.addEventListener('click',showChapters);
document.getElementById('chapter-back')?.addEventListener('click',()=>menuPage(menuControls));
document.getElementById('restart')?.addEventListener('click',()=>confirmMenu(0,menuControls));
cancelButton.addEventListener('click',()=>menuPage(confirmReturn));
confirmButton.addEventListener('click',async ()=>{
  if(confirmButton.disabled||pendingChapter===null)return;
  confirmButton.disabled=true;
  const chapter=pendingChapter;
  try {
    const checkpoint=chapter?await loadChapterCheckpoint(chapter===6?'end':chapter):null;
    showMenu(false);
    restart({checkpoint});
  } catch(error) {
    console.warn('章节载入失败',error);
    showMenu(false);
    showNotice(t('chapterError'));
  } finally {
    pendingChapter=null;
    confirmButton.disabled=false;
  }
});
document.body.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!state||state.storyPhase==='ENDING')return;
  event.preventDefault();
  if(pausedAt===null)showMenu(true);
  else if(!confirmation.hidden)menuPage(confirmReturn);
  else if((languagePanel&&!languagePanel.hidden)||(menuCredits&&!menuCredits.hidden))showChapters();
  else showMenu(false);
});
function syncSoundtrack() {
  for (const guid of state.inPlay) if (!lastCardsInPlay.has(guid)) audioFocus = guid;
  lastCardsInPlay = new Set(state.inPlay);
  if (audioFocus && !state.inPlay.has(audioFocus)) audioFocus = undefined;
  const moving = viewChange && viewChange.card === audioFocus && viewChange.plan.durationSeconds > 0;
  const location = moving ? viewChange.destination : state.locations.get(audioFocus);
  soundDirector?.syncLocation(location, moving ? viewChange.plan.durationSeconds : audioFocus ? .01 : 1);
  soundDirector?.syncScore?.(state,viewChange);
}
function navigationView(time){if(!viewChange)return null;const move=viewChange,sample=sampleTransition(move.plan,time-move.started);if(sample.complete){state.setLocation(move.card,move.destination);viewChange=null;dirty=true;return null;}return sample.viewpoint;}
function updateBoardMotion(time){
  if(flight){
    flight.sample=sampleCardDrop(flight.plan,time-flight.started);dirty=true;
    if(flight.sample.complete){
      const {drag:drop,plan}=flight;
      const lowerCard=[...state.coords].find(([,point])=>point[0]===plan.cell[0]&&point[1]===plan.cell[1])?.[0];
      if(finishCardDrop(links,drop,plan)){
        if(state.captors.get(lowerCard)===drop.draggedGUID&&state.captureSides.get(lowerCard)==='UNDER')audioFocus=drop.draggedGUID;
        soundDirector?.playInterface('int_drop_card');
      }
      flight=null;
    }
  }
  if(opening){
    opening.sample=chapterOpening(time-opening.started);dirty=true;
    if(opening.sample.complete){links.place(opening.guid,opening.cell);opening=null;}
  }
  if(closing){
    closing.sample=chapterClosing(closing.cell,time-closing.started);dirty=true;
    if(closing.sample.complete){links.place(closing.guid,CELLS[0]);closing=null;}
  }
}
function advanceStory(time){
  const phase=nextStoryPhase(state,state.storyPhase);
  if(phase===state.storyPhase||(phase!=='ENDING'&&inputBusy()))return;
  state.storyPhase=phase;state.version++;dirty=true;
  if(phase==='ENDING')endingStarted=viewChange?.started??time;
  if(phase==='CHAPTERS'){
    const guid=project.tree.attrs.staringCard,cell=state.coords.get(guid);
    if(cell){opening={guid,cell,started:time,sample:chapterOpening(0)};state.coords.delete(guid);}
  }else if(phase==='EPILOGUE'){
    const cell=CELLS.find(point=>[...state.coords.values()].some(at=>point[0]===at[0]&&point[1]===at[1]));
    const guid=cell&&[...state.coords].find(([,at])=>at[0]===cell[0]&&at[1]===cell[1])?.[0];
    if(guid){closing={guid,cell,started:time,sample:chapterClosing(cell,0)};state.coords.delete(guid);}
  }
}
function paintEnding(time) {
  if (state.storyPhase!=='EPILOGUE'&&state.storyPhase!=='ENDING') return;
  creditsRequest??=read('assets/data/credits.json').then(data=>{creditsData=data;}).catch(error=>console.warn('片尾名单载入失败',error));
  if (endingScreen===undefined) {
    endingScreen=null;
    try {
      const screen=new EndingScreen(endingCanvas,manifest,project,document.baseURI);
      if(screen.gl){
        endingScreen=screen;
        screen.ready.catch(error=>{endingScreen=null;console.warn('结局画面载入失败',error);});
      }
    } catch(error) {
      console.warn('结局画面暂不可用',error);
    }
  }
  if(endingStarted===null)return;
  if(titleFadeStarted===null&&creditsPredicate&&state.isSatisfied(creditsPredicate)===true)titleFadeStarted=time;
  const fade=titleFadeStarted===null?1:Math.max(0,1-(time-titleFadeStarted)/.5);
  endingCanvas.hidden=!endingScreen?.loaded;
  endingScreen?.draw(time-endingStarted,fade);
  if(titleFadeStarted!==null&&creditsData&&!creditsScreen.data)creditsScreen.start(creditsData,titleFadeStarted);
  creditsScreen.update(time);
}
function paintGrid(ctx,progress,scale=1,alpha=1){
  const lo=BOARD_INSET,hi=lo+2*CARD_SIZE,mid=lo+CARD_SIZE;
  ctx.save();
  if(scale!==1){ctx.translate(mid,mid);ctx.scale(scale,scale);ctx.translate(-mid,-mid);}
  ctx.globalAlpha=progress*alpha;
  ctx.fillStyle='#f2f2f0';
  ctx.fillRect(lo,lo,hi-lo,hi-lo);
  ctx.strokeStyle='#c8c8c8';
  ctx.strokeRect(lo+.5,lo+.5,hi-lo-1,hi-lo-1);
  ctx.globalAlpha=alpha;
  const fraction=start=>Math.max(0,Math.min(1,(progress-start)/(1-start)));
  ctx.beginPath();
  ctx.moveTo(hi,mid+.5);ctx.lineTo(hi-(hi-lo)*fraction(.375),mid+.5);
  ctx.moveTo(mid+.5,lo);ctx.lineTo(mid+.5,lo+(hi-lo)*fraction(.125));
  ctx.stroke();
  ctx.restore();
}
async function frame(){
  if(startup.active){
    startup.update(performance.now()/1000,bootReady&&loading.hidden);
    if(!startup.active){
      epoch=performance.now();
      gameShell.inert=false;
      pauseButton.disabled=false;
      if(startup.audioRequested&&!soundMuted)setSound(true);
    }else if(!bootReady||!startup.showingLast){
      requestAnimationFrame(frame);
      return;
    }
  }
  if(!bootReady)return;
  if(pausedAt!==null){requestAnimationFrame(frame);return;}
  try{
    const time=now(),viewpoint=navigationView(time);if(canvas.width!==BOARD_SIZE*2){canvas.width=canvas.height=BOARD_SIZE*2;dirty=true;}
    updateBoardMotion(time);
    if(scripts.update(state,time,{displayCoords}))dirty=true;
    if(state.version!==lastStateVersion){dirty=true;lastStateVersion=state.version;}
    followCapturedTransitions();
    const linkChanges=links.refresh();const changes=state.step();if(changes.length||linkChanges.changed)dirty=true;if(changes.length)links.refresh();
    unlockChapters();
    updateMargin();
    advanceStory(time);
    if(!inputBusy()){for(const card of cards()){const auto=state.getTransitions(card.guid).find(t=>t.attrs.hotspotStyle==='NONE');if(auto){navigate(card,auto);break;}}}
    syncSoundtrack();
    let reports=cards().map(card=>({card,report:renderer.buildDrawList(card.location,{timeSeconds:time,graphicTimes,transitionLocations:viewChange?.card===card.guid?viewChange.plan.locations:undefined,viewpoint:viewChange?.card===card.guid?viewpoint:undefined})}));
    let newClock=false;const active=new Set();for(const{report}of reports)for(const animation of report.animations||[]){active.add(animation.guid);if(!graphicTimes.has(animation.guid)){graphicTimes.set(animation.guid,time);soundDirector?.playGraphic(project.get(animation.guid),state,viewChange);newClock=true;}}
    for(const guid of graphicTimes.keys())if(!active.has(guid))graphicTimes.delete(guid);
    if(newClock)reports=reports.map(({card})=>({card,report:renderer.buildDrawList(card.location,{timeSeconds:time,graphicTimes,transitionLocations:viewChange?.card===card.guid?viewChange.plan.locations:undefined,viewpoint:viewChange?.card===card.guid?viewpoint:undefined})}));
    const hasAnimations=reports.some(({report})=>(report.animations||[]).some(a=>!a.complete));
    blockedCards=new Set(reports.filter(({card,report})=>report.animations.some(a=>!a.complete&&project.get(a.guid)?.attrs.interactiveWhenAnimating!=='true'&&project.owner(project.get(a.guid),'Card')?.attrs.guid===card.guid)).map(({card})=>card.guid));
    updateBoardCursor();
    // A layer that no longer has an enabled graphic must stop gating state transitions.
    // Combine all reports: a linked or stacked view can show the same layer as another card.
    layerStatus.clear();
    const record=(guid,complete)=>{
      if(!guid)return;
      const previous=layerStatus.get(guid)?.complete;
      layerStatus.set(guid,{state:state.states.get(guid),complete:complete===false||previous===false?false:complete===null||previous===null?null:true});
    };
    for(const{report}of reports){
      for(const animation of report.animations)record(animation.sceneLayerGUID,animation.complete);
      for(const item of report.unsupported){
        if(['PlayListGraphic','MotionKeyframesGraphic','SpriteSequenceGraphic'].includes(item.type)&&/时长|动画|关键帧|逐帧/.test(item.reason)){
          record(project.owner(project.get(item.guid),'LocationLayer')?.attrs.sceneLayer,null);
        }
      }
    }
    if(dirty||hasAnimations||viewChange||newClock){
      dirty=false;
      const frameState=state;
      // Decoding a card can yield to the browser. Keep the last finished board visible until every card is painted.
      frameContext.setTransform(1,0,0,1,0,0);
      frameContext.clearRect(0,0,boardFrame.width,boardFrame.height);
      frameContext.scale(2,2);
      if(showGrid())paintGrid(frameContext,opening?.sample.progress??1,closing?.sample.scale,closing?.sample.alpha);
      const activeTextureUrls=reportTextureUrls(reports.map(entry=>entry.report));
      waitingForBoardTextures=[...activeTextureUrls].some(url=>!renderer.atlas.images.has(url));
      updateBoardCursor();
      const entries=reports.map(({card,report})=>({card,report,position:placement(card)}));
      for(const{card,report,position:[x,y]}of entries){
        frameContext.save();
        frameContext.translate(x,y);
        frameContext.fillStyle='#f2f2f0';
        frameContext.fillRect(0,0,CARD_SIZE,CARD_SIZE);
        try{await renderer.render(frameContext,card.location,{activeTextureUrls,report});}finally{frameContext.restore();}
      }
      waitingForBoardTextures=false;
      if(state!==frameState){requestAnimationFrame(frame);return;}
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(boardFrame,0,0);
      updateBoardCursor();
      loading.hidden=true;
    }
    canvas.dataset.locations=cards().map(card=>card.location).join('|');
    canvas.dataset.phase=state.storyPhase;
    paintEnding(time);
    const tip=t(state.storyPhase==='CHAPTERS'?'boardTip':'prologueTip');
    if(hint.textContent!==tip)hint.textContent=tip;
    updateButtons();
    if(saveStorage&&!inputBusy()&&!hasAnimations&&state.version!==lastSavedVersion){if(writeSave(saveStorage,SAVE_KEY,state))lastSavedVersion=state.version;}
  }catch(error){waitingForBoardTextures=false;updateBoardCursor();console.error(error);showNotice(t('renderError'));loading.hidden=true;}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
try{
  const[{project:loaded},loadedManifest,atlases]=await Promise.all([loadProject(),read('assets/manifest.json'),read('assets/data/atlases.json')]);project=loaded;manifest=loadedManifest;renderer=new SceneRenderer(project,manifest,atlases,{baseUrl:document.baseURI,holeContent:node=>resolveHoleContent(project,state,node),scriptGraphics:(graphic,matrix,options)=>scripts.graphics(graphic,matrix,options),scriptDurationMillis:graphic=>scripts.durationMillis(graphic)});restart({restoreSaved:true});
  const paper=textureUrl('PaperTex1_tile');
  if(paper)document.body.style.setProperty?.('--paper',`url("${paper}")`);
  for(const name of ['scrollbox_back','scrollbox_border_small','scrollbox_scr_back','button_border','checkbox','hotspots_reveal_check','ping_image_on',
    'volume_slider_background','volume_slider_handle','volume_min_icon','volume_max_icon',
    'music_min_icon','music_max_icon','cursor_default_instruct','cursor_hand','cursor_move','hourglass']){
    const url=textureUrl(name);
    if(url)document.body.style.setProperty?.(`--${name.toLowerCase().replaceAll('_','-')}`,`url("${url}")`);
  }
  const milestones=project.all('Milestone').filter(node=>project.owner(node,'MilestoneSequence')?.attrs.id==='chapters');
  chapterMilestones=['chapter1','chapter2','chapter3','chapter4','chapter5','end'].map(id=>
    project.container(milestones.find(node=>node.attrs.id===id),'predicate')[0]
  );
  margins=project.container(project.tree,'marginGraphics','MarginGraphics').map(definition=>({
    attrs:definition.attrs,
    predicate:project.container(definition,'predicate')[0],
  }));
  const credits=milestones.find(node=>node.attrs.id==='credits');
  creditsPredicate=project.container(credits,'predicate')[0];
  creditsScreen=new EndingCredits(...['credits','credits-page','credits-prev','credits-next'].map(id=>document.getElementById(id)),{
    previous:textureUrl('credits_back'),next:textureUrl('credits_forward')
  });
  const corner=textureUrl('corner_flip_button');
  if(corner){pauseButton.style.backgroundImage=`url("${corner}")`;pauseButton.textContent='';}
  bootReady=true;
  soundButton.disabled = false;
}catch(error){startup.finish();gameShell.inert=false;loading.textContent=t('loadError');console.error(error);showNotice(t('loadError'));}













// 用户手势启用原版声音，同时核对实际浏览器解码结果；不把容器识别当作可播放。

async function updateAudioPause() {
  if(!soundDirector)return;
  if(soundMuted||pausedAt!==null)await soundDirector.suspend();
  else {
    await soundDirector.resume();
    syncSoundtrack();
  }
}

async function setSound(enabled, remember=false) {
  if(soundButton.disabled)return;
  soundButton.disabled = true;
  try {
    if (enabled) {
      // Chrome requires the context to be resumed during the click, before any fetch.
      if (!soundDirector) {
        await soundBank.resume();
        const { events } = await read('assets/audio/events.json');
        soundDirector = new SoundtrackDirector(project, events, soundBank);
      }
    }
    soundMuted=!enabled;
    await updateAudioPause();
    if(remember){try { saveStorage?.setItem(SOUND_KEY,enabled?'on':'off'); } catch {}}
    soundLabel = soundDirector&&!soundMuted ? 'soundOff' : 'soundOn';
    soundButton.textContent = t(soundLabel);
    soundButton.setAttribute('aria-label', t(soundLabel));
  } catch (error) {
    soundLabel='retrySound';
    soundButton.textContent = t(soundLabel);
    soundButton.setAttribute('aria-label', t(soundLabel));
    console.warn('声音暂未就绪', error);
  } finally {
    soundButton.disabled = false;
  }
}
soundButton.addEventListener('click',()=>setSound(!soundDirector||soundMuted,true));
startupButton.addEventListener('click',()=>{
  if(!soundMuted&&(globalThis.AudioContext||globalThis.webkitAudioContext))startup.enableMusic();
});
board.addEventListener('pointerdown',()=>{
  if(!soundMuted&&!soundDirector&&(globalThis.AudioContext||globalThis.webkitAudioContext))setSound(true);
});
