(() => {
'use strict';
// Site picker: opens on the whole of Nijkerk; pick a CBS buurt, a BRK parcel (Shift for several) or draw a polygon.
// The selected extent loads 3DBAG LoD1.3 buildings, BGT surfaces and BGT trees, shown on the map and handed to the editor.
const D=NSData, S=D.decode();
const entry=document.createElement('section');entry.id='world-entry';document.body.append(entry);
let m=null,mode='buurt',drawing=false,pts=[],buurten=[],parcels=[],parcelCtl=null,modelCtl=null;
let gem=S?{...S.gemeente,source:'sample'}:null,sel=null,model=null,loading=null,boundSource='sample',parcelSource=null,message='';
const el=s=>entry.querySelector(s), FC=f=>({type:'FeatureCollection',features:f});
const COLORS={road:'#dcded7',green:'#bdd1a7',hedge:'#9bb98d',water:'#99c3ce'};
entry.innerHTML=`<div id="world-map"></div>
<div class="world-header"><div class="world-brand"><i>▦</i> Neighbourhood Studio</div></div>
<section class="world-search"><form><input type="search" autocomplete="off" required><button class="world-primary" type="submit"></button></form>
<div class="world-presets"><button id="preset-gem"></button><button id="preset-sample"></button></div><div class="world-results"></div><div role="status" class="world-status"></div>
<div class="picker-modes" role="group"><button data-mode="buurt"></button><button data-mode="parcel"></button><button data-mode="draw"></button></div><p class="picker-note"></p><button id="draw-finish" class="world-primary" hidden></button></section>
<section class="world-card"></section>
<div class="world-legend"></div>
<div class="world-views"><button id="world-flat">2D</button><button id="world-tilt">3D</button><button id="world-aerial" aria-pressed="true" title="Aerial photo">Aerial</button><button id="world-plus">+</button><button id="world-minus">−</button></div>
<div class="world-credit"><a href="https://www.pdok.nl/" target="_blank" rel="noopener">PDOK · Luchtfoto / CBS / BRK / BGT</a> · <a href="https://3dbag.nl/" target="_blank" rel="noopener">3DBAG · TU Delft / 3DGI · CC BY 4.0</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>`;
const btn=(text,cb,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=cb;if(cls)b.className=cls;return b};
const fmtArea=a=>a>=1e4?(a/1e4).toLocaleString('en-GB',{maximumFractionDigits:2})+' ha':Math.round(a).toLocaleString('en-GB')+' m²';
const n=v=>v.toLocaleString('en-GB');
const srcText=s=>s==='live'?'live':s==='sample'?'bundled snapshot':'';

// ---------- text ----------
function renderText(){
 entry.setAttribute('aria-label','Site map');
 const prompt='Search a neighbourhood or enter latitude, longitude';
 el('input').placeholder=prompt;el('input').setAttribute('aria-label',prompt);
 el('[type=submit]').textContent='Search';
 el('#preset-gem').textContent='All of Nijkerk';
 el('#preset-sample').textContent='Nijkerk Centrum';
 for(const b of entry.querySelectorAll('[data-mode]')){b.textContent={buurt:'Neighbourhood',parcel:'Parcel',draw:'Draw polygon'}[b.dataset.mode];b.setAttribute('aria-pressed',String(b.dataset.mode===mode))}
 el('#draw-finish').textContent='Finish polygon';el('#draw-finish').hidden=!(mode==='draw'&&drawing&&pts.length>2);
 const z=m?m.getZoom():0;
 el('.picker-note').textContent=mode==='buurt'?`CBS neighbourhoods 2026 · ${buurten.length} areas · ${srcText(boundSource)}`
  :mode==='parcel'?(z<15.5?'Zoom in to street level to show BRK parcels':`BRK parcels · ${n(parcels.length)} · ${srcText(parcelSource)} · Shift-click to add`)
  :'Click to add vertices; double-click or press Finish';
 el('#world-plus').setAttribute('aria-label','Zoom in');el('#world-minus').setAttribute('aria-label','Zoom out');
 const p=m?m.getPitch()>5:false;el('#world-flat').setAttribute('aria-pressed',String(!p));el('#world-tilt').setAttribute('aria-pressed',String(p));
 el('.world-legend').innerHTML=model?[['building','#f6f6f1','3DBAG blocks'],['road',COLORS.road,'Road'],['green',COLORS.green,'Green'],['water',COLORS.water,'Water'],['tree','#a9c397','Tree']].map(([k,c,t])=>`<span><i style="background:${c}"></i>${t}</span>`).join(''):'';
 renderCard();
}
function renderCard(){
 const card=el('.world-card'),h=document.createElement('h2'),p=document.createElement('p');
 if(!sel){
  h.textContent=gem?.name||'Nijkerk';
  p.textContent='Pick a neighbourhood or parcel as your site, or draw a polygon.';
  card.replaceChildren(h,p);
 }else{
  h.textContent=sel.name;
  p.textContent=[sel.kindLabel,sel.code,fmtArea(sel.area)].filter(Boolean).join(' · ');
  const st=document.createElement('p');st.className='model-status';
  if(loading)st.textContent=`Loading model… ${loading[0]}/${loading[1]}`;
  else if(model){const parts=[`${n(model.buildings.length)} ${'buildings'}`,`${n(model.ground.length)} ${'surfaces'}`,`${n(model.trees.length)} ${'trees'}`];
   st.textContent=parts.join(' · ')+' · '+srcText(model.source)+(model.partial?' (the bundled snapshot covers Nijkerk only; part of this area is outside it)':'');}
  else if(message)st.textContent=message;
  const actions=document.createElement('div');actions.className='card-actions';
  const go=btn('Open editor',enterSite,'world-primary');go.disabled=!!loading;
  actions.append(go,btn('Clear',()=>clearSelection()));
  card.replaceChildren(h,p,st,actions);
 }
 if(message&&!sel){const w=document.createElement('p');w.className='model-status';w.textContent=message;card.append(w)}
}
function status(msg){el('.world-status').textContent=msg}

// ---------- geometry helpers ----------
const polysOf=g=>D.polys(g);
function multi(geoms){return{type:'MultiPolygon',coordinates:geoms.flatMap(polysOf)}}
function extentFor(rdGeom){
 const b=D.bboxOf(rdGeom),cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
 const m=Math.max(80,.15*Math.max(b[2]-b[0],b[3]-b[1])); // context margin around the site
 return[Math.min(b[0],cx-50)-m,Math.min(b[1],cy-50)-m,Math.max(b[2],cx+50)+m,Math.max(b[3],cy+50)+m];
}
function octagon([x,y],r){const a=[];for(let i=0;i<=8;i++){const t=i*Math.PI/4+Math.PI/8;a.push(D.geo.toWgs(x+r*Math.cos(t),y+r*Math.sin(t)))}return[a]}
const wgsRing=r=>{const a=r.map(([x,y])=>D.geo.toWgs(x,y));if(a.length&&(a[0][0]!==a.at(-1)[0]||a[0][1]!==a.at(-1)[1]))a.push(a[0]);return a};

// ---------- aerial imagery ----------
// PDOK Luchtfoto (Actueel_ortho25). Tiles bundled with the page are used first, then the live service; where neither is
// available (e.g. the claude.ai preview outside the sample area) the nearest bundled lower-zoom tile is enlarged.
const AERIAL_URL='https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg';
const SPR=window.__assets.aerialSprites||{groups:{},tiles:[]},aerialIndex=new Set(SPR.tiles);let aerialLive=null,aerialOn=true;
async function fetchBuf(url,signal,timeout=9000){const c=new AbortController(),tm=setTimeout(()=>c.abort(),timeout);signal?.addEventListener('abort',()=>c.abort());try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.arrayBuffer()}finally{clearTimeout(tm)}}
// Bundled tiles are stored as JPEG sprite sheets: one per zoom for z<=14, one per z14 area and zoom above that.
const sprites=new Map();
function groupOf(z,x,y){return z<=14?'z'+z:`14_${x>>(z-14)}_${y>>(z-14)}_z${z}`}
function sprite(name){
 if(!sprites.has(name)){sprites.set(name,fetchBuf(`aerial/${name}.jpg`,null,30000).then(b=>createImageBitmap(new Blob([b],{type:'image/jpeg'}))).catch(e=>{sprites.delete(name);throw e}));
  if(sprites.size>8){const [k,v]=sprites.entries().next().value;sprites.delete(k);v.then(b=>b.close?.()).catch(()=>{})}}
 return sprites.get(name);
}
async function cut(z,x,y,k=0){ // tile z/x/y from the bundled sprite of its ancestor k levels up, enlarged 2^k times
 const pz=z-k,px=x>>k,py=y>>k,name=groupOf(pz,px,py),g=SPR.groups[name],bmp=await sprite(name),n=1<<k,s=256/n;
 const cv=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(256,256):Object.assign(document.createElement('canvas'),{width:256,height:256}),ctx=cv.getContext('2d');
 ctx.imageSmoothingQuality='high';ctx.drawImage(bmp,(px-g[1])*256+(x-px*n)*s,(py-g[2])*256+(y-py*n)*s,s,s,0,0,256,256);
 const blob=cv.convertToBlob?await cv.convertToBlob({type:'image/jpeg',quality:.85}):await new Promise(r=>cv.toBlob(r,'image/jpeg',.85));return await blob.arrayBuffer();
}
if(window.maplibregl)maplibregl.addProtocol('nsaerial',async(params,abort)=>{
 const [z,x,y]=params.url.replace('nsaerial://','').split('/').map(Number),signal=abort?.signal;
 if(aerialLive!==true&&aerialIndex.has(`${z}/${x}/${y}`)){try{return{data:await cut(z,x,y)}}catch{}}
 if(aerialLive!==false){try{const data=await fetchBuf(AERIAL_URL.replace('{z}',z).replace('{x}',x).replace('{y}',y),signal);aerialLive=true;return{data}}catch(e){if(signal?.aborted)throw e;if(aerialLive===null&&(e instanceof TypeError||e.name==='AbortError'))aerialLive=false}}
 for(let k=1;k<=10&&z-k>=0;k++)if(aerialIndex.has(`${z-k}/${x>>k}/${y>>k}`))return{data:await cut(z,x,y,k)};
 throw new Error('no aerial tile');
});

// ---------- map ----------
// Map padding that keeps the fitted area clear of the floating panels; phones get top/bottom space instead of a left column.
const pad=desk=>{const w=innerWidth,h=innerHeight;return w<700?{top:Math.round(Math.min(270,h*.3)),bottom:Math.round(Math.min(300,h*.34)),left:14,right:72}:desk};
let basemapOnline=true;
async function prepareStyle(style){
 // Without the OpenFreeMap tile index MapLibre never fires 'load' (e.g. inside the claude.ai preview), so fall back to a basemap-free style.
 const src=Object.values(style.sources).find(x=>x.type==='vector'&&x.url);
 try{if(src){const r=await fetch(src.url,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error()}}
 catch{basemapOnline=false;const ids=new Set(Object.entries(style.sources).filter(([,x])=>x.type==='vector').map(([k])=>k));
  for(const k of ids)delete style.sources[k];style.layers=style.layers.filter(l=>!ids.has(l.source));delete style.sprite;}
 return style;
}
function startGL(style){
 style.sources.worldOutline={type:'geojson',data:window.__assets.world};
 const base=style.layers.find(l=>l.type==='background');if(base)base.paint={'background-color':'#d7e8eb'};
 style.layers.splice(base?1:0,0,{id:'local-land',type:'fill',source:'worldOutline',paint:{'fill-color':'#e7ebdc','fill-outline-color':'#c6d0be'}});
 style.layers=style.layers.filter(l=>l['source-layer']!=='building');
 const b=gem?D.bboxOf(gem.geometry):[5.37,52.15,5.62,52.27];
 m=new maplibregl.Map({container:el('#world-map'),style,bounds:[[b[0],b[1]],[b[2],b[3]]],fitBoundsOptions:{padding:pad({top:60,bottom:60,left:420,right:60})},maxZoom:20,attributionControl:false,canvasContextAttributes:{antialias:true,preserveDrawingBuffer:true}});
 m.boxZoom.disable();m.on('load',setupLayers);
 m.on('pitchend',renderText);m.on('zoomend',renderText);
}
function setupLayers(){
 const first=m.getStyle().layers.find(l=>l.type==='symbol')?.id;
 const add=(layer)=>m.addLayer(layer,layer.type==='fill-extrusion'?undefined:first);
 m.addSource('aerial',{type:'raster',tiles:['nsaerial://{z}/{x}/{y}'],tileSize:256,maxzoom:19,attribution:'Luchtfoto © Beeldmateriaal Nederland / PDOK'});
 add({id:'aerial',type:'raster',source:'aerial',paint:{'raster-saturation':-.15,'raster-contrast':.04,'raster-fade-duration':150}});
 for(const id of ['gemeente','buurten','parcels','sel','draft','ground','mask','bld','trees','trunks'])m.addSource(id,{type:'geojson',data:FC([])});
 add({id:'gem-fill',type:'fill',source:'gemeente',paint:{'fill-color':'#ffffff','fill-opacity':.04}});
 add({id:'ground-fill',type:'fill',source:'ground',paint:{'fill-color':['match',['get','kind'],'road',COLORS.road,'green',COLORS.green,'hedge',COLORS.hedge,'water',COLORS.water,'#ddd'],'fill-antialias':false}});
 add({id:'mask-fill',type:'fill',source:'mask',paint:{'fill-color':'#f4f6ef','fill-opacity':.45}});
 add({id:'gem-casing',type:'line',source:'gemeente',paint:{'line-color':'#ffffff','line-width':5,'line-opacity':.75}});
 add({id:'gem-line',type:'line',source:'gemeente',paint:{'line-color':'#1f4f3d','line-width':2.2,'line-opacity':.85}});
 add({id:'buurt-fill',type:'fill',source:'buurten',paint:{'fill-color':'#ffffff','fill-opacity':['case',['boolean',['feature-state','hover'],false],.28,.01]}});
 add({id:'buurt-casing',type:'line',source:'buurten',paint:{'line-color':'#ffffff','line-width':3,'line-opacity':.7}});
 add({id:'buurt-line',type:'line',source:'buurten',paint:{'line-color':'#1f4f3d','line-width':1.4,'line-dasharray':[2,1]}});
 if(basemapOnline)add({id:'buurt-label',type:'symbol',source:'buurten',layout:{'text-field':['get','name'],'text-size':11,'text-font':['Noto Sans Regular'],'text-max-width':8},paint:{'text-color':'#2d5547','text-halo-color':'#fff','text-halo-width':1.2}});
 add({id:'parcel-fill',type:'fill',source:'parcels',minzoom:15,paint:{'fill-color':'#ffd27a','fill-opacity':['case',['boolean',['feature-state','hover'],false],.35,.02]}});
 add({id:'parcel-line',type:'line',source:'parcels',minzoom:15,paint:{'line-color':'#ffe2a6','line-width':1.1,'line-opacity':.95}});
 add({id:'sel-fill',type:'fill',source:'sel',paint:{'fill-color':'#ffffff','fill-opacity':.1}});
 add({id:'sel-casing',type:'line',source:'sel',paint:{'line-color':'#ffffff','line-width':6,'line-opacity':.85}});
 add({id:'sel-line',type:'line',source:'sel',paint:{'line-color':'#145c40','line-width':3}});
 add({id:'draft-fill',type:'fill',source:'draft',filter:['==','$type','Polygon'],paint:{'fill-color':'#b8864b','fill-opacity':.2}});
 add({id:'draft-line',type:'line',source:'draft',paint:{'line-color':'#b8864b','line-width':2.5}});
 add({id:'draft-pt',type:'circle',source:'draft',filter:['==','$type','Point'],paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-color':'#b8864b','circle-stroke-width':2}});
 m.addLayer({id:'bld-out',type:'fill-extrusion',source:'bld',filter:['!',['get','inside']],paint:{'fill-extrusion-color':'#dcdfd6','fill-extrusion-height':['get','h'],'fill-extrusion-opacity':.6,'fill-extrusion-vertical-gradient':true}});
 m.addLayer({id:'bld-in',type:'fill-extrusion',source:'bld',filter:['get','inside'],paint:{'fill-extrusion-color':'#fbfbf7','fill-extrusion-height':['get','h'],'fill-extrusion-opacity':.96,'fill-extrusion-vertical-gradient':true}});
 m.addLayer({id:'tree-trunk',type:'fill-extrusion',source:'trunks',minzoom:15,paint:{'fill-extrusion-color':'#8c8a73','fill-extrusion-height':4.4,'fill-extrusion-base':0}});
 m.addLayer({id:'tree-crown',type:'fill-extrusion',source:'trees',paint:{'fill-extrusion-color':'#a9c397','fill-extrusion-height':7.6,'fill-extrusion-base':4.2,'fill-extrusion-opacity':.95}});
 if(gem)m.getSource('gemeente').setData(FC([{type:'Feature',properties:{},geometry:gem.geometry}]));
 m.on('click',onClick);m.on('dblclick',e=>{if(mode==='draw'&&drawing){e.preventDefault();finishDraw()}});
 m.on('mousemove',onHover);m.on('moveend',()=>{if(mode==='parcel')loadParcels()});
 loadBoundaries();renderText();
}
let hoverRef=null;
function onHover(e){
 if(mode==='draw'){m.getCanvas().style.cursor='crosshair';return}
 const layer=mode==='parcel'?'parcel-fill':'buurt-fill',f=m.getLayer(layer)&&m.queryRenderedFeatures(e.point,{layers:[layer]})[0];
 if(hoverRef)m.setFeatureState(hoverRef,{hover:false});hoverRef=null;
 if(f){hoverRef={source:f.source,id:f.id};m.setFeatureState(hoverRef,{hover:true})}
 m.getCanvas().style.cursor=f?'pointer':'';
}
async function loadBoundaries(){
 const [g,b]=await Promise.all([D.gemeente(),D.buurten()]);
 if(g){gem=g;m?.getSource('gemeente').setData(FC([{type:'Feature',properties:{},geometry:g.geometry}]))}
 buurten=b.list;boundSource=b.source;
 m?.getSource('buurten').setData(FC(buurten.map((f,i)=>({type:'Feature',id:i,properties:{name:f.name,i},geometry:f.geometry}))));
 if(D.online===false)message=`PDOK / 3DBAG cannot be reached here (for example in the claude.ai preview), so the page uses its bundled snapshot of all of Nijkerk (${window.__assets?.nijkerkTiles?.fetched||''}).`;
 renderText();
}
async function loadParcels(){
 if(!m||m.getZoom()<15.5){parcels=[];m?.getSource('parcels').setData(FC([]));renderText();return}
 parcelCtl?.abort();parcelCtl=new AbortController();const b=m.getBounds();
 try{const r=await D.parcels([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],parcelCtl.signal);parcels=r.list;parcelSource=r.source;
  m.getSource('parcels').setData(FC(parcels.map((p,i)=>({type:'Feature',id:i,properties:{i},geometry:p.geometry}))));renderText()}catch{}
}
function setMode(next){
 mode=next;drawing=next==='draw';pts=[];drawDraft();
 if(m){next==='draw'?m.doubleClickZoom.disable():m.doubleClickZoom.enable();
  for(const id of ['buurt-fill','buurt-casing','buurt-line','buurt-label'])m?.getLayer(id)&&m.setLayoutProperty(id,'visibility',next==='buurt'?'visible':'none');
  for(const id of ['parcel-fill','parcel-line'])m.getLayer(id)&&m.setLayoutProperty(id,'visibility',next==='parcel'?'visible':'none');
  if(next==='parcel'){if(m.getZoom()<15.5)m.easeTo({zoom:16.2,duration:700});else loadParcels()}}
 renderText();
}
entry.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
el('#draw-finish').onclick=()=>finishDraw();
function drawDraft(){
 const f=[];if(pts.length>2)f.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...pts,pts[0]]]}});
 if(pts.length>1)f.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:pts}});
 pts.forEach(p=>f.push({type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}}));m?.getSource('draft')?.setData(FC(f));
}
function finishDraw(){
 const q=pts.filter((p,i)=>!i||Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1])>1e-8);
 if(q.length<3){status('At least 3 vertices are needed.');return}
 status('');drawing=false;pts=[];drawDraft();
 select({kind:'draw',name:'Custom area',kindLabel:'Drawn polygon',geometry:{type:'Polygon',coordinates:[[...q,q[0]]]}});
 drawing=true;renderText();
}
function onClick(e){
 if(mode==='draw'){pts.push([e.lngLat.lng,e.lngLat.lat]);drawDraft();renderText();return}
 if(mode==='parcel'){
  const f=m.queryRenderedFeatures(e.point,{layers:['parcel-fill']})[0];if(!f)return;const p=parcels[f.properties.i];if(!p)return;
  let list=[p];
  if(e.originalEvent.shiftKey&&sel?.kind==='parcel'){const has=sel.items.some(x=>x.id===p.id);list=has?sel.items.filter(x=>x.id!==p.id):[...sel.items,p];if(!list.length){clearSelection();return}}
  const name=list.length===1?'Parcel '+p.label:`${list.length} parcels`;
  select({kind:'parcel',items:list,name,code:list.length===1?'BRK':'BRK · '+list.map(x=>x.label.split(' ').slice(-1)[0]).join(', ').slice(0,60),kindLabel:'BRK cadastral parcel',geometry:multi(list.map(x=>x.geometry))},{fly:false});
  return;
 }
 const f=m.queryRenderedFeatures(e.point,{layers:['buurt-fill']})[0];if(!f)return;const b=buurten[f.properties.i];if(b)selectBuurt(b);
}
function selectBuurt(b){select({kind:'buurt',name:b.name,code:b.code,kindLabel:'CBS neighbourhood',geometry:b.geometry})}
function clearSelection(){modelCtl?.abort();sel=null;model=null;loading=null;message=D.online===false?message:'';showModel(null);m?.getSource('sel').setData(FC([]));renderText()}
async function select(s,{fly=true}={}){
 const rd=D.toRdGeom(s.geometry),area=D.area(rd),b=D.bboxOf(rd),centerRd=[(b[0]+b[2])/2,(b[1]+b[3])/2];
 sel={...s,rd,area,centerRd,center:D.geo.toWgs(...centerRd)};
 m?.getSource('sel').setData(FC([{type:'Feature',properties:{},geometry:s.geometry}]));
 if(fly&&m){const w=D.bboxOf(s.geometry);m.fitBounds([[w[0],w[1]],[w[2],w[3]]],{padding:pad({top:90,bottom:90,left:440,right:90}),pitch:50,bearing:-18,maxZoom:18,duration:1200})}
 await loadModel();
}
async function loadModel(){
 modelCtl?.abort();modelCtl=new AbortController();const mine=modelCtl,ext=extentFor(sel.rd);
 model=null;showModel(null);
 if((ext[2]-ext[0])*(ext[3]-ext[1])>D.MAX_AREA){loading=null;message='Area too large (bounding box over 4 km² with its surroundings); the model was not loaded. Choose a smaller neighbourhood, parcel or drawn area.';renderText();return}
 message='';loading=[0,1];renderText();
 try{const r=await D.model(ext,(a,b)=>{if(mine===modelCtl){loading=[a,b];renderCard()}},mine.signal);if(mine!==modelCtl)return;model=r;loading=null;showModel(r);
  if(r.source==='sample'&&!r.buildings.length&&!r.ground.length)message='This area is outside Nijkerk, which is all the bundled snapshot covers. Open the hosted live version to load any area in the Netherlands.';
 }catch(e){if(mine!==modelCtl)return;loading=null;message='Model could not be loaded: '+e.message}
 renderText();
}
function showModel(r){
 if(!m?.getSource('bld'))return;
 if(!r){for(const id of ['ground','mask','bld','trees','trunks'])m.getSource(id).setData(FC([]));return}
 const inside=b=>{const ring=b.parts[0].rings[0],[x,y]=D.centroid(ring);return D.contains(sel.rd,x,y)};
 m.getSource('bld').setData(FC(r.buildings.flatMap(b=>{const ins=inside(b);return b.parts.map(p=>({type:'Feature',properties:{h:p.h,inside:ins,id:b.id},geometry:{type:'Polygon',coordinates:p.rings.map(wgsRing)}}))})));
 m.getSource('ground').setData(FC(r.ground.map(g=>({type:'Feature',properties:{kind:g.kind},geometry:{type:'Polygon',coordinates:g.rings.map(wgsRing)}}))));
 m.getSource('trees').setData(FC(r.trees.map(t=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:octagon(t,2.4)}}))));
 m.getSource('trunks').setData(FC(r.trees.map(t=>({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:octagon(t,.28)}}))));
 const e=r.extent,outer=[[e[0]-400,e[1]-400],[e[2]+400,e[1]-400],[e[2]+400,e[3]+400],[e[0]-400,e[3]+400],[e[0]-400,e[1]-400]].map(([x,y])=>D.geo.toWgs(x,y));
 m.getSource('mask').setData(FC([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[outer,...polysOf(sel.geometry).map(p=>p[0])]}}]));
}

// ---------- search ----------
el('form').onsubmit=async e=>{
 e.preventDefault();const q=el('input').value.trim();if(!q)return;const results=el('.world-results');results.replaceChildren();status('');
 const nums=q.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:[,;]\s*|\s+)([+-]?\d+(?:\.\d+)?)$/);
 if(nums){const lat=+nums[1],lon=+nums[2];if(Math.abs(lat)>85||Math.abs(lon)>180){status('Coordinates out of range.');return}m?.flyTo({center:[lon,lat],zoom:17,duration:1400});return}
 const key=q.toLocaleLowerCase(),hits=buurten.filter(b=>b.name.toLocaleLowerCase().includes(key)||b.code.toLowerCase()===key).slice(0,6);
 for(const b of hits){const x=btn(b.name,()=>{results.replaceChildren();setMode('buurt');selectBuurt(b)});const s=document.createElement('small');s.textContent=b.wijk||b.code;x.append(s);results.append(x)}
 if(!hits.length)status('No Nijkerk neighbourhood matches.');
};
el('#preset-gem').onclick=()=>{clearSelection();if(gem&&m){const b=D.bboxOf(gem.geometry);m.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:pad({top:60,bottom:60,left:420,right:60}),pitch:0,bearing:0,duration:1200})}};
el('#preset-sample').onclick=()=>{setMode('buurt');const b=buurten.find(x=>x.code===(S?.sampleBuurt||'BU02670106'));if(b)selectBuurt(b)};
el('#world-aerial').onclick=()=>{aerialOn=!aerialOn;m?.getLayer('aerial')&&m.setLayoutProperty('aerial','visibility',aerialOn?'visible':'none');el('#world-aerial').setAttribute('aria-pressed',String(aerialOn))};
el('#world-flat').onclick=()=>m?.easeTo({pitch:0,bearing:0,duration:700});
el('#world-tilt').onclick=()=>m?.easeTo({pitch:55,bearing:-20,duration:700});
el('#world-plus').onclick=()=>m?.zoomTo(m.getZoom()+1,{duration:300});
el('#world-minus').onclick=()=>m?.zoomTo(m.getZoom()-1,{duration:300});

// ---------- hand-off to the editor ----------
function capture(center){return new Promise(res=>{
 const c=m.getCanvas(),w=c.clientWidth,h=c.clientHeight,mpp=200/(.8*Math.min(w,h)),z=Math.min(19,Math.log2(40075016.686*Math.cos(center[1]*Math.PI/180)/(512*mpp)));
 const hide=['sel-fill','sel-casing','sel-line','buurt-fill','buurt-casing','buurt-line','buurt-label','gem-casing','parcel-fill','parcel-line','draft-fill','draft-line','draft-pt','mask-fill'].filter(id=>m.getLayer(id));
 m.stop();hide.forEach(id=>m.setLayoutProperty(id,'visibility','none'));m.jumpTo({center,zoom:z,pitch:0,bearing:0});let done=false,timer;
 const snap=()=>{if(done)return;done=true;clearTimeout(timer);let v=null;try{const S=Math.round(200/mpp*c.width/w),o=document.createElement('canvas');o.width=o.height=Math.min(1024,S);o.getContext('2d').drawImage(c,(c.width-S)/2,(c.height-S)/2,S,S,0,0,o.width,o.height);v={url:o.toDataURL('image/jpeg',.85),size:o.width}}catch{}
  hide.forEach(id=>m.setLayoutProperty(id,'visibility','visible'));setMode(mode);res(v)};
 m.once('idle',snap);timer=setTimeout(snap,2200)})}
async function enterSite(){
 if(!sel||loading)return;
 window.__basemap=null;
 const hasModel=model&&(model.buildings.length||model.ground.length);
 if(!hasModel&&m){status('Preparing base map…');window.__basemap=await capture(sel.center);status('')}
 // BRK parcels covering the 100 × 100 m design window, shown as locked outlines in the editor
 let gridParcels=[];
 try{status('Loading parcel boundaries…');const r=D.bboxOf(sel.rd),[cx,cy]=sel.centerRd,a=D.geo.toWgs(Math.min(r[0],cx-55)-10,Math.min(r[1],cy-55)-10),b=D.geo.toWgs(Math.max(r[2],cx+55)+10,Math.max(r[3],cy+55)+10);gridParcels=(await D.parcels([a[0],a[1],b[0],b[1]])).list}catch{}
 status('');
 document.body.classList.remove('world-is-open');
 window.dispatchEvent(new CustomEvent('enter-design-site',{detail:{name:sel.name,kind:sel.kind,code:sel.code||null,geometry:sel.geometry,center:sel.center,rd:{geometry:sel.rd,center:sel.centerRd},model:hasModel?model:null,parcels:gridParcels,study:false}}));
 entry.classList.add('fading');setTimeout(()=>{entry.hidden=true;entry.classList.remove('fading')},850);
}
window.openWorldMap=()=>{entry.hidden=false;entry.classList.remove('fading');document.body.classList.add('world-is-open');renderText();requestAnimationFrame(()=>m?.resize())};
window.NSPicker={select:s=>select(s),selectBuurt:code=>{const b=buurten.find(x=>x.code===code);if(b)selectBuurt(b)},setMode,get state(){return{mode,sel,model,loading,message,buurten:buurten.length,parcels:parcels.length,online:D.online}},get map(){return m},enterSite};

async function init(){
 renderText();
 try{if(!window.maplibregl)throw Error();const r=await fetch('map-assets/positron.json');if(!r.ok)throw Error();startGL(await prepareStyle(await r.json()))}
 catch{el('#world-map').hidden=true;const card=el('.world-card');card.replaceChildren(Object.assign(document.createElement('h2'),{textContent:'Nijkerk'}),Object.assign(document.createElement('p'),{textContent:'This browser cannot show the WebGL map. You can open the bundled sample area directly.'}),btn('Open sample area',async()=>{const b=(await D.buurten()).list.find(x=>x.code===S?.sampleBuurt);if(b){await select({kind:'buurt',name:b.name,code:b.code,kindLabel:'CBS',geometry:b.geometry},{fly:false});enterSite()}},'world-primary'))}
}
document.body.classList.add('world-is-open');init();
})();
