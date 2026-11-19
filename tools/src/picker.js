(() => {
'use strict';
// Site map. Opens on Nijkerk. 3DBAG buildings, BGT ground and BGT trees load automatically in 500 m tiles once the map is zoomed in
// far enough (radius and zoom scaled to the device). Clicking a neighbourhood focuses it: name, outline and its 3D model.
// The design site is a 100 × 100 m square that can be moved and rotated to follow streets and buildings; it is handed to the
// editor as a 20 × 20 grid of 5 m cells.
const D=NSData, S=D.decode();
const entry=document.createElement('section');entry.id='world-entry';document.body.append(entry);
let m=null,showBuurt=true,showParcel=true,buurten=[],parcels=[],parcelCtl=null;
let gem=S?{...S.gemeente,source:'sample'}:null,focus=null,sel=null,model=null,boundSource='sample',parcelSource=null,message='',nameMarker=null;
const el=s=>entry.querySelector(s), FC=f=>({type:'FeatureCollection',features:f});
const COLORS={road:'#dcded7',green:'#bdd1a7',hedge:'#9bb98d',water:'#99c3ce'};
entry.innerHTML=`<div id="world-map"></div>
<div class="world-header"><div class="world-brand"><i>▦</i> Neighbourhood Studio</div></div>
<section class="world-search"><form><input type="search" autocomplete="off" required><button class="world-primary" type="submit"></button></form>
<div class="world-presets"><button id="preset-gem"></button><button id="preset-sample"></button></div><div class="world-results"></div><div role="status" class="world-status"></div>
<div class="picker-modes" role="group"><button data-layer="buurt" aria-pressed="true">Neighbourhoods</button><button data-layer="parcel" aria-pressed="true">Parcels</button></div><p class="picker-note"></p></section>
<section class="world-card"></section>
<div class="world-legend"></div>
<div class="world-views"><button id="world-flat">2D</button><button id="world-tilt">3D</button><button id="world-aerial" aria-pressed="true" title="Aerial photo">Aerial</button><button id="world-plus">+</button><button id="world-minus">−</button></div>
<div class="world-credit"><a href="https://www.pdok.nl/" target="_blank" rel="noopener">PDOK · Luchtfoto / CBS / BRK / BGT / Locatieserver</a> · <a href="https://3dbag.nl/" target="_blank" rel="noopener">3DBAG · TU Delft / 3DGI · CC BY 4.0</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></div>`;
const btn=(text,cb,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=cb;if(cls)b.className=cls;return b};
const fmtArea=a=>a>=1e4?(a/1e4).toLocaleString('en-GB',{maximumFractionDigits:2})+' ha':Math.round(a).toLocaleString('en-GB')+' m²';
const n=v=>v.toLocaleString('en-GB');
const srcText=s=>s==='live'?'live':s==='sample'?'bundled snapshot':'';
const polysOf=g=>D.polys(g);
const wgsRing=r=>{const a=r.map(([x,y])=>D.geo.toWgs(x,y));if(a.length&&(a[0][0]!==a.at(-1)[0]||a[0][1]!==a.at(-1)[1]))a.push(a[0]);return a};
function octagon([x,y],r){const a=[];for(let i=0;i<=8;i++){const t=i*Math.PI/4+Math.PI/8;a.push(D.geo.toWgs(x+r*Math.cos(t),y+r*Math.sin(t)))}return[a]}

// ---------- device budget for live 3D ----------
// Radius of the area loaded around the map centre and the zoom from which it loads, by device class.
const CAPS=(()=>{const mem=navigator.deviceMemory||4,cores=navigator.hardwareConcurrency||4,coarse=matchMedia('(pointer: coarse)').matches;
 const lvl=mem>=8&&cores>=8&&!coarse?2:(mem<=2||cores<=2)?0:1;return{lvl,R:[400,600,850][lvl],zoom:[15.8,15.4,15][lvl],maxTiles:[24,48,80][lvl]}})();

// ---------- text ----------
function renderText(){
 entry.setAttribute('aria-label','Site map');
 const prompt='City, city + neighbourhood, address or coordinates';
 el('input').placeholder=prompt;el('input').setAttribute('aria-label',prompt);
 el('[type=submit]').textContent='Search';
 el('#preset-gem').textContent='All of Nijkerk';
 el('#preset-sample').textContent='Nijkerk Centrum';
 entry.querySelector('[data-layer=buurt]').setAttribute('aria-pressed',String(showBuurt));entry.querySelector('[data-layer=parcel]').setAttribute('aria-pressed',String(showParcel));
 const z=m?m.getZoom():0,live3d=z>=CAPS.zoom;
 el('.picker-note').textContent=(live3d?`3D buildings load within ${CAPS.R} m of the map centre.`:`3D buildings appear from zoom ${CAPS.zoom.toFixed(1)} (now ${z.toFixed(1)}); click a neighbourhood to see it in 3D.`)
  +(showParcel&&z>=15.5?` BRK parcels: ${n(parcels.length)} · ${srcText(parcelSource)}.`:'');
 el('#world-plus').setAttribute('aria-label','Zoom in');el('#world-minus').setAttribute('aria-label','Zoom out');
 const p=m?m.getPitch()>5:false;el('#world-flat').setAttribute('aria-pressed',String(!p));el('#world-tilt').setAttribute('aria-pressed',String(p));
 el('.world-legend').innerHTML=shownCount?[['building','#f6f6f1','3DBAG blocks'],['road',COLORS.road,'Road'],['green',COLORS.green,'Green'],['water',COLORS.water,'Water'],['tree','#a9c397','Tree']].map(([k,c,t])=>`<span><i style="background:${c}"></i>${t}</span>`).join(''):'';
 renderCard();
}
function statusLine(text){const p=document.createElement('p');p.className='model-status';p.textContent=text;return p}
function renderCard(){
 const card=el('.world-card'),h=document.createElement('h2'),p=document.createElement('p'),kids=[h,p];
 if(sel){
  h.textContent=sel.name;p.textContent=`100 × 100 m site · RD ${Math.round(sel.center[0])}, ${Math.round(sel.center[1])} · rotation ${fmtAngle(sel.angle)}`;
  const rot=document.createElement('div');rot.className='rot-controls';
  const inp=Object.assign(document.createElement('input'),{type:'number',step:'1',min:'-45',max:'45',value:String(Math.round(sel.angle*10)/10)});inp.setAttribute('aria-label','Rotation in degrees');
  inp.onchange=()=>{const v=parseFloat(inp.value);if(Number.isFinite(v))updateSite({angle:v})};
  rot.append(Object.assign(document.createElement('span'),{textContent:'Rotation'}),btn('−5°',()=>updateSite({angle:sel.angle-5})),btn('−1°',()=>updateSite({angle:sel.angle-1})),inp,btn('+1°',()=>updateSite({angle:sel.angle+1})),btn('+5°',()=>updateSite({angle:sel.angle+5})));
  const align=document.createElement('div');align.className='card-actions';
  align.append(btn('Align to buildings',alignToBuildings),btn('Reset 0°',()=>updateSite({angle:0})));
  kids.push(rot,align);
  const pend=siteTilesPending();
  kids.push(statusLine(pend?`Loading site model… ${pend.done}/${pend.total} tiles`:model?`${n(model.buildings.length)} buildings · ${n(model.ground.length)} surfaces · ${n(model.trees.length)} trees around the site · ${srcText(model.source)}`+(model.partial?' (part of this area is outside the bundled Nijkerk snapshot)':''):message||''));
  kids.push(statusLine('Drag the square to move it; drag the round handle to rotate it.'));
  const actions=document.createElement('div');actions.className='card-actions';
  const go=btn('Open editor',enterSite,'world-primary');go.disabled=!!pend||!model;actions.append(go,btn('Remove site',()=>clearSite()));kids.push(actions);
 }else if(focus){
  h.textContent=focus.name;p.textContent=[focus.kindLabel,focus.code,focus.area?fmtArea(focus.area):''].filter(Boolean).join(' · ');
  const pend=tilesPending(focus.keys);
  kids.push(statusLine(focus.tooLarge?'This area is too large to load in 3D at once; zoom in to see its buildings.':pend?`Loading 3D model… ${pend.done}/${pend.total} tiles`:`${n(countInside())} buildings in this neighbourhood · ${srcText(lastSource)}`));
  const actions=document.createElement('div');actions.className='card-actions';
  actions.append(btn('Place site here',()=>placeSiteAt(focusCenter(),{fly:true}),'world-primary'),btn('Clear',()=>setFocus(null)));kids.push(actions);
 }else{
  h.textContent=gem?.name||'Nijkerk';
  p.textContent='Find your area with the search box or the neighbourhood boundaries, then place a 100 × 100 m site. Zoomed in, a click on the map places it there.';
  const actions=document.createElement('div');actions.className='card-actions';actions.append(btn('Place site at map centre',()=>{const c=m.getCenter();placeSiteAt(D.geo.toRd(c.lng,c.lat),{fly:true})},'world-primary'));kids.push(actions);
 }
 if(message&&!sel)kids.push(statusLine(message));
 card.replaceChildren(...kids);
}
function status(msg){el('.world-status').textContent=msg}
const fmtAngle=a=>`${a>0?'+':''}${Math.round(a*10)/10}°`;

// ---------- 3D tiles ----------
// 500 m RD tiles, loaded through NSData.model (live PDOK / 3DBAG, else the bundled snapshot) and kept in a small cache.
const TILE=500,tiles=new Map(),queue=[];let activeLoads=0,wanted=new Set(),shownCount=0,lastSource='',displayTimer=0;
const keysFor=e=>{const k=[];for(let x=Math.floor(e[0]/TILE);x<=Math.floor((e[2]-1e-6)/TILE);x++)for(let y=Math.floor(e[1]/TILE);y<=Math.floor((e[3]-1e-6)/TILE);y++)k.push(x+'_'+y);return k};
function tilesPending(keys){if(!keys?.length)return null;const done=keys.filter(k=>{const t=tiles.get(k);return t&&(t.state==='ready'||t.state==='error')}).length;return done<keys.length?{done,total:keys.length}:null}
function viewportKeys(){
 if(!m||m.getZoom()<CAPS.zoom)return[];
 const c=m.getCenter(),cr=D.geo.toRd(c.lng,c.lat),b=m.getBounds(),pts=[b.getSouthWest(),b.getNorthEast(),b.getNorthWest(),b.getSouthEast()].map(p=>D.geo.toRd(p.lng,p.lat));
 const R=CAPS.R,e=[Math.max(cr[0]-R,Math.min(...pts.map(p=>p[0]))),Math.max(cr[1]-R,Math.min(...pts.map(p=>p[1]))),Math.min(cr[0]+R,Math.max(...pts.map(p=>p[0]))),Math.min(cr[1]+R,Math.max(...pts.map(p=>p[1])))];
 return e[2]>e[0]&&e[3]>e[1]?keysFor(e):[];
}
function updateWanted(){
 const v=viewportKeys(),f=focus?.keys||[],s=sel?.keys||[];
 wanted=new Set([...s,...f,...v]);
 // nearest first: site, focus, then viewport tiles by distance to the centre
 for(const k of [...s,...f,...v])if(!tiles.has(k)){tiles.set(k,{state:'queued'});queue.push(k)}
 pump();
 if(tiles.size>CAPS.maxTiles+wanted.size)for(const [k,t] of tiles){if(tiles.size<=CAPS.maxTiles+wanted.size)break;if(!wanted.has(k)&&t.state!=='loading')tiles.delete(k)}
 scheduleDisplay();
}
function pump(){
 while(activeLoads<2&&queue.length){
  const k=queue.shift(),t=tiles.get(k);if(!t||t.state!=='queued')continue;
  if(!wanted.has(k)){tiles.delete(k);continue}
  t.state='loading';activeLoads++;
  const [tx,ty]=k.split('_').map(Number),ext=[tx*TILE,ty*TILE,(tx+1)*TILE,(ty+1)*TILE];
  D.model(ext).then(r=>{tiles.set(k,{state:'ready',data:r,disp:toDisplay(r)});lastSource=r.source}).catch(()=>tiles.set(k,{state:'error'}))
   .finally(()=>{activeLoads--;scheduleDisplay();if(sel)maybeBuildSiteModel();renderCard();pump()});
 }
}
function toDisplay(r){
 return{
  buildings:r.buildings.map(b=>({id:b.id,c:D.centroid(b.parts[0].rings[0]),feats:b.parts.map(p=>({type:'Feature',properties:{h:p.h,inside:false},geometry:{type:'Polygon',coordinates:p.rings.map(wgsRing)}}))})),
  ground:r.ground.map(g=>({key:g.kind+g.rings[0][0].map(v=>v.toFixed(1)).join(',')+g.rings[0].length,feat:{type:'Feature',properties:{kind:g.kind},geometry:{type:'Polygon',coordinates:g.rings.map(wgsRing)}}})),
  trees:r.trees.map(t=>({key:t[0].toFixed(1)+','+t[1].toFixed(1),crown:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:octagon(t,2.4)}},trunk:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:octagon(t,.28)}}}))};
}
function scheduleDisplay(){clearTimeout(displayTimer);displayTimer=setTimeout(rebuildDisplay,120)}
function highlightGeom(){return sel?.rd||focus?.rd||null}
function rebuildDisplay(){
 if(!m?.getSource('bld'))return;
 const hl=highlightGeom(),hb=hl&&D.bboxOf(hl),B=new Map(),G=new Map(),T=new Map();
 for(const k of wanted){const t=tiles.get(k);if(t?.state!=='ready')continue;
  for(const b of t.disp.buildings)if(!B.has(b.id))B.set(b.id,b);
  for(const g of t.disp.ground)if(!G.has(g.key))G.set(g.key,g.feat);
  for(const tr of t.disp.trees)if(!T.has(tr.key))T.set(tr.key,tr)}
 const bf=[];
 for(const b of B.values()){const ins=!!hl&&b.c[0]>=hb[0]&&b.c[0]<=hb[2]&&b.c[1]>=hb[1]&&b.c[1]<=hb[3]&&D.contains(hl,b.c[0],b.c[1]);for(const f of b.feats){f.properties.inside=ins;bf.push(f)}}
 shownCount=B.size;
 m.getSource('bld').setData(FC(bf));m.getSource('ground').setData(FC([...G.values()]));
 m.getSource('trees').setData(FC([...T.values()].map(t=>t.crown)));m.getSource('trunks').setData(FC([...T.values()].map(t=>t.trunk)));
 m.setPaintProperty('bld-out','fill-extrusion-opacity',hl?.62:.9);m.setPaintProperty('bld-out','fill-extrusion-color',hl?'#dcdfd6':'#eeefe9');
 if(hl){const h=hb,outer=[[h[0]-3000,h[1]-3000],[h[2]+3000,h[1]-3000],[h[2]+3000,h[3]+3000],[h[0]-3000,h[3]+3000],[h[0]-3000,h[1]-3000]].map(([x,y])=>D.geo.toWgs(x,y));
  m.getSource('mask').setData(FC([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[outer,...polysOf(hl).map(p=>wgsRing(p[0]))]}}]))}
 else m.getSource('mask').setData(FC([]));
 renderText();
}
function countInside(){const hl=focus?.rd;if(!hl)return 0;const seen=new Set();let c=0;for(const k of focus.keys){const t=tiles.get(k);if(t?.state!=='ready')continue;for(const b of t.disp.buildings)if(!seen.has(b.id)){seen.add(b.id);if(D.contains(hl,b.c[0],b.c[1]))c++}}return c}

// ---------- neighbourhood focus ----------
function setFocus(f,{fly=true}={}){
 focus=null;nameMarker?.remove();nameMarker=null;
 if(f){
  const rd=D.toRdGeom(f.geometry),b=D.bboxOf(rd),tooLarge=(b[2]-b[0]+200)*(b[3]-b[1]+200)>4e6;
  focus={...f,rd,area:D.area(rd),tooLarge,keys:tooLarge?[]:keysFor([b[0]-100,b[1]-100,b[2]+100,b[3]+100])};
  m?.getSource('focus').setData(FC([{type:'Feature',properties:{},geometry:f.geometry}]));
  const label=document.createElement('div');label.className='focus-label';label.textContent=f.name;
  const c=D.geo.toWgs(...focusCenter());nameMarker=new maplibregl.Marker({element:label}).setLngLat(c).addTo(m);
  if(fly){const w=D.bboxOf(f.geometry);m.fitBounds([[w[0],w[1]],[w[2],w[3]]],{padding:pad({top:90,bottom:90,left:440,right:90}),pitch:45,bearing:-15,maxZoom:17,duration:1200})}
 }else m?.getSource('focus').setData(FC([]));
 updateWanted();renderText();
}
function focusCenter(){
 // a point inside the area: its bbox centre if that is inside, else the centre of the largest ring's first vertices
 const rd=focus.rd,b=D.bboxOf(rd),c=[(b[0]+b[2])/2,(b[1]+b[3])/2];if(D.contains(rd,c[0],c[1]))return c;
 for(let f=.1;f<1;f+=.1)for(const p of [[b[0]+(b[2]-b[0])*f,c[1]],[c[0],b[1]+(b[3]-b[1])*f]])if(D.contains(rd,p[0],p[1]))return p;return c;
}
function buurtAt(lon,lat){return buurten.find(b=>D.contains(b.geometry,lon,lat))}

// ---------- the 100 × 100 m site (movable, rotatable) ----------
const SITE=100;
const normAngle=a=>{a=((a%90)+90)%90;return a>45?a-90:a}; // the square repeats every 90°
function siteCorners(c,angle){const t=angle*Math.PI/180,co=Math.cos(t),si=Math.sin(t);return[[-50,-50],[50,-50],[50,50],[-50,50],[-50,-50]].map(([u,v])=>[c[0]+u*co-v*si,c[1]+u*si+v*co])}
function handlePoint(c,angle){const t=angle*Math.PI/180;return[c[0]-62*Math.sin(t),c[1]+62*Math.cos(t)]}
function siteFeatures(c,angle){
 const ring=siteCorners(c,angle),h=handlePoint(c,angle),t=angle*Math.PI/180,top=[c[0]-50*Math.sin(t),c[1]+50*Math.cos(t)];
 return{square:FC([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring.map(([x,y])=>D.geo.toWgs(x,y))]}}]),
  handle:FC([{type:'Feature',properties:{},geometry:{type:'Point',coordinates:D.geo.toWgs(...h)}},{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[D.geo.toWgs(...top),D.geo.toWgs(...h)]}}])};
}
function drawSite(c,angle){const f=siteFeatures(c,angle);m.getSource('sel').setData(f.square);m.getSource('handle').setData(f.handle)}
function placeSiteAt(center,{fly=false,angle}={}){
 const c=[Math.round(center[0]),Math.round(center[1])],a=normAngle(angle??sel?.angle??0);
 const w=D.geo.toWgs(...c),b=buurtAt(w[0],w[1]);
 const ring=siteCorners(c,a),rd={type:'MultiPolygon',coordinates:[[ring]]},bb=D.bboxOf(rd),ext=[bb[0]-80,bb[1]-80,bb[2]+80,bb[3]+80];
 sel={kind:'site',name:b?`Site · ${b.name}`:'Site',code:b?.code||null,center:c,angle:a,rd,ext,keys:keysFor(ext),geometry:{type:'Polygon',coordinates:[ring.map(([x,y])=>D.geo.toWgs(x,y))]}};
 model=null;message='';drawSite(c,a);
 if(fly&&m){const g=D.bboxOf(sel.geometry);m.fitBounds([[g[0],g[1]],[g[2],g[3]]],{padding:pad({top:160,bottom:160,left:500,right:160}),pitch:50,bearing:-18,maxZoom:18.2,duration:1200})}
 updateWanted();maybeBuildSiteModel();renderText();
}
let siteUpdateTimer=0;
function updateSite({center,angle}){if(!sel)return;const c=center||sel.center,a=angle??sel.angle;drawSite(c,normAngle(a));clearTimeout(siteUpdateTimer);siteUpdateTimer=setTimeout(()=>placeSiteAt(c,{angle:a}),angle!==undefined&&!center?250:0)}
function clearSite(){sel=null;model=null;m?.getSource('sel').setData(FC([]));m?.getSource('handle').setData(FC([]));updateWanted();renderText()}
function siteTilesPending(){return sel?tilesPending(sel.keys):null}
function maybeBuildSiteModel(){
 if(!sel||siteTilesPending()){return}
 const e=sel.ext,B=new Map(),Gk=new Set(),ground=[],trees=new Map();let live=false,fetched='';
 for(const k of sel.keys){const t=tiles.get(k);if(t?.state!=='ready')continue;const r=t.data;live=live||r.source==='live';fetched=r.fetched||fetched;
  for(const b of r.buildings)if(!B.has(b.id)&&D.overlaps(b.bbox||D.bboxOf({type:'MultiPolygon',coordinates:b.parts.map(p=>[p.rings[0]])}),e))B.set(b.id,b);
  for(const g of r.ground){const key=g.kind+g.rings[0][0].join(',')+g.rings[0].length;if(Gk.has(key))continue;Gk.add(key);if(D.overlaps(g.bbox||D.bboxOf({type:'Polygon',coordinates:g.rings}),e))ground.push(g)}
  for(const t of r.trees)if(t[0]>=e[0]&&t[0]<=e[2]&&t[1]>=e[1]&&t[1]<=e[3])trees.set(t[0].toFixed(1)+','+t[1].toFixed(1),t)}
 model={extent:e,source:live?'live':'sample',fetched,partial:sel.keys.some(k=>tiles.get(k)?.state==='error'),buildings:[...B.values()],ground,trees:[...trees.values()]};
 if(!model.buildings.length&&!model.ground.length)message='No 3DBAG / BGT data found here. In the claude.ai preview only Nijkerk is bundled; open the hosted live version for other places.';
}
// Dominant orientation of the building edges around the site (length-weighted histogram of angles modulo 90°).
function alignToBuildings(){
 if(!sel)return;const c=sel.center,hist=new Float64Array(90);
 for(const k of sel.keys){const t=tiles.get(k);if(t?.state!=='ready')continue;
  for(const b of t.data.buildings){const bc=D.centroid(b.parts[0].rings[0]);if(Math.hypot(bc[0]-c[0],bc[1]-c[1])>90)continue;
   for(const p of b.parts){const r=p.rings[0];for(let i=0;i<r.length;i++){const a=r[i],q=r[(i+1)%r.length],len=Math.hypot(q[0]-a[0],q[1]-a[1]);if(len<2)continue;
    const deg=((Math.atan2(q[1]-a[1],q[0]-a[0])*180/Math.PI)%90+90)%90;hist[Math.floor(deg)%90]+=len}}}}
 let best=-1,bi=0;for(let i=0;i<90;i++){let s=0;for(let d=-2;d<=2;d++)s+=hist[(i+d+90)%90]*(3-Math.abs(d));if(s>best){best=s;bi=i}}
 if(best<=0){status('No buildings near the site to align to.');return}
 // refine within the winning bin with a weighted mean
 let sw=0,sa=0;for(let d=-2;d<=2;d++){const i=(bi+d+90)%90,w=hist[i];sw+=w;sa+=w*(bi+d+.5)}
 status('');updateSite({angle:normAngle(sa/sw)});
}
function startDrag(e,kind){
 if(!sel||(e.points&&e.points.length>1))return;
 e.preventDefault();m.dragPan.disable();
 const start=D.geo.toRd(e.lngLat.lng,e.lngLat.lat),c0=sel.center,a0=sel.angle;let cur={center:c0,angle:a0};
 m.getCanvas().style.cursor='grabbing';dragging=true;
 const move=ev=>{const p=D.geo.toRd(ev.lngLat.lng,ev.lngLat.lat);
  if(kind==='rotate'){let a=Math.atan2(p[1]-c0[1],p[0]-c0[0])*180/Math.PI-90;if(ev.originalEvent?.shiftKey)a=Math.round(a/15)*15;else a=Math.round(a);cur={center:c0,angle:normAngle(a)}}
  else cur={center:[Math.round(c0[0]+p[0]-start[0]),Math.round(c0[1]+p[1]-start[1])],angle:a0};
  drawSite(cur.center,cur.angle)};
 const up=()=>{m.off('mousemove',move);m.off('touchmove',move);m.dragPan.enable();dragging=false;dragEnded=performance.now();m.getCanvas().style.cursor='';
  if(cur.center!==c0||cur.angle!==a0)placeSiteAt(cur.center,{angle:cur.angle})};
 m.on('mousemove',move);m.on('touchmove',move);m.once('mouseup',up);m.once('touchend',up);
}
let dragging=false,dragEnded=0;

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
 m.on('pitchend',renderText);
}
function setupLayers(){
 const first=m.getStyle().layers.find(l=>l.type==='symbol')?.id;
 const add=(layer)=>m.addLayer(layer,layer.type==='fill-extrusion'?undefined:first);
 m.addSource('aerial',{type:'raster',tiles:['nsaerial://{z}/{x}/{y}'],tileSize:256,maxzoom:19,attribution:'Luchtfoto © Beeldmateriaal Nederland / PDOK'});
 add({id:'aerial',type:'raster',source:'aerial',paint:{'raster-saturation':-.15,'raster-contrast':.04,'raster-fade-duration':150}});
 for(const id of ['gemeente','buurten','parcels','focus','sel','handle','ground','mask','bld','trees','trunks'])m.addSource(id,{type:'geojson',data:FC([])});
 add({id:'gem-fill',type:'fill',source:'gemeente',paint:{'fill-color':'#ffffff','fill-opacity':.04}});
 add({id:'ground-fill',type:'fill',source:'ground',paint:{'fill-color':['match',['get','kind'],'road',COLORS.road,'green',COLORS.green,'hedge',COLORS.hedge,'water',COLORS.water,'#ddd'],'fill-antialias':false,'fill-opacity':.92}});
 add({id:'mask-fill',type:'fill',source:'mask',paint:{'fill-color':'#f4f6ef','fill-opacity':.4}});
 add({id:'gem-casing',type:'line',source:'gemeente',paint:{'line-color':'#ffffff','line-width':5,'line-opacity':.75}});
 add({id:'gem-line',type:'line',source:'gemeente',paint:{'line-color':'#1f4f3d','line-width':2.2,'line-opacity':.85}});
 add({id:'buurt-fill',type:'fill',source:'buurten',paint:{'fill-color':'#ffffff','fill-opacity':['case',['boolean',['feature-state','hover'],false],.28,.01]}});
 add({id:'buurt-casing',type:'line',source:'buurten',paint:{'line-color':'#ffffff','line-width':3,'line-opacity':.7}});
 add({id:'buurt-line',type:'line',source:'buurten',paint:{'line-color':'#1f4f3d','line-width':1.4,'line-dasharray':[2,1]}});
 if(basemapOnline)add({id:'buurt-label',type:'symbol',source:'buurten',maxzoom:15,layout:{'text-field':['get','name'],'text-size':11,'text-font':['Noto Sans Regular'],'text-max-width':8},paint:{'text-color':'#2d5547','text-halo-color':'#fff','text-halo-width':1.2}});
 add({id:'parcel-fill',type:'fill',source:'parcels',minzoom:15,paint:{'fill-color':'#ffd27a','fill-opacity':0}});
 add({id:'parcel-line',type:'line',source:'parcels',minzoom:15,paint:{'line-color':'#ffe2a6','line-width':1.1,'line-opacity':.95}});
 add({id:'focus-casing',type:'line',source:'focus',paint:{'line-color':'#ffffff','line-width':6,'line-opacity':.8}});
 add({id:'focus-line',type:'line',source:'focus',paint:{'line-color':'#1d5a42','line-width':3}});
 add({id:'sel-fill',type:'fill',source:'sel',paint:{'fill-color':'#ffffff','fill-opacity':.12}});
 add({id:'sel-casing',type:'line',source:'sel',paint:{'line-color':'#ffffff','line-width':6,'line-opacity':.9}});
 add({id:'sel-line',type:'line',source:'sel',paint:{'line-color':'#c2410c','line-width':3}});
 add({id:'handle-line',type:'line',source:'handle',filter:['==','$type','LineString'],paint:{'line-color':'#c2410c','line-width':2,'line-dasharray':[2,1.5]}});
 add({id:'handle-pt',type:'circle',source:'handle',filter:['==','$type','Point'],paint:{'circle-radius':9,'circle-color':'#ffffff','circle-stroke-color':'#c2410c','circle-stroke-width':3}});
 m.addLayer({id:'bld-out',type:'fill-extrusion',source:'bld',filter:['!',['get','inside']],paint:{'fill-extrusion-color':'#eeefe9','fill-extrusion-height':['get','h'],'fill-extrusion-opacity':.9,'fill-extrusion-vertical-gradient':true}});
 m.addLayer({id:'bld-in',type:'fill-extrusion',source:'bld',filter:['get','inside'],paint:{'fill-extrusion-color':'#fbfbf7','fill-extrusion-height':['get','h'],'fill-extrusion-opacity':.97,'fill-extrusion-vertical-gradient':true}});
 m.addLayer({id:'tree-trunk',type:'fill-extrusion',source:'trunks',minzoom:15.5,paint:{'fill-extrusion-color':'#8c8a73','fill-extrusion-height':4.4,'fill-extrusion-base':0}});
 m.addLayer({id:'tree-crown',type:'fill-extrusion',source:'trees',paint:{'fill-extrusion-color':'#a9c397','fill-extrusion-height':7.6,'fill-extrusion-base':4.2,'fill-extrusion-opacity':.95}});
 if(gem)m.getSource('gemeente').setData(FC([{type:'Feature',properties:{},geometry:gem.geometry}]));
 m.on('click',onClick);m.on('mousemove',onHover);m.on('moveend',()=>{loadParcels();updateWanted()});
 m.on('mousedown','handle-pt',e=>startDrag(e,'rotate'));m.on('touchstart','handle-pt',e=>startDrag(e,'rotate'));
 m.on('mousedown','sel-fill',e=>{if(!m.queryRenderedFeatures(e.point,{layers:['handle-pt']}).length)startDrag(e,'move')});
 m.on('touchstart','sel-fill',e=>{if(!m.queryRenderedFeatures(e.point,{layers:['handle-pt']}).length)startDrag(e,'move')});
 loadBoundaries();renderText();updateWanted();
}
let hoverRef=null;
function onHover(e){
 if(dragging)return;
 if(hoverRef)m.setFeatureState(hoverRef,{hover:false});hoverRef=null;
 if(m.queryRenderedFeatures(e.point,{layers:['handle-pt']}).length){m.getCanvas().style.cursor='grab';return}
 if(m.queryRenderedFeatures(e.point,{layers:['sel-fill']}).length){m.getCanvas().style.cursor='move';return}
 const f=showBuurt&&m.getZoom()<15&&m.getLayer('buurt-fill')&&m.queryRenderedFeatures(e.point,{layers:['buurt-fill']})[0];
 if(f){hoverRef={source:f.source,id:f.id};m.setFeatureState(hoverRef,{hover:true})}
 m.getCanvas().style.cursor=f?'pointer':m.getZoom()>=15?'crosshair':'';
}
function onClick(e){
 if(dragging||performance.now()-dragEnded<300)return;
 if(m.queryRenderedFeatures(e.point,{layers:['sel-fill','handle-pt']}).length)return;
 if(m.getZoom()<15){
  const f=showBuurt&&m.queryRenderedFeatures(e.point,{layers:['buurt-fill']})[0],b=f&&buurten[f.properties.i];
  if(b){status('');setFocus({kind:'buurt',name:b.name,code:b.code,kindLabel:'CBS neighbourhood',geometry:b.geometry})}
  else m.flyTo({center:e.lngLat,zoom:16,duration:900});
  return}
 status('');placeSiteAt(D.geo.toRd(e.lngLat.lng,e.lngLat.lat));
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
 if(!m||!showParcel||m.getZoom()<15.5){parcels=[];m?.getSource('parcels').setData(FC([]));renderText();return}
 parcelCtl?.abort();parcelCtl=new AbortController();const b=m.getBounds(),c=m.getCenter(),cr=D.geo.toRd(c.lng,c.lat);
 // tilted views reach the horizon: limit parcels to the device radius around the centre
 const R=CAPS.R,sw=D.geo.toWgs(cr[0]-R,cr[1]-R),ne=D.geo.toWgs(cr[0]+R,cr[1]+R);
 const bb=[Math.max(b.getWest(),sw[0]),Math.max(b.getSouth(),sw[1]),Math.min(b.getEast(),ne[0]),Math.min(b.getNorth(),ne[1])];
 try{const r=await D.parcels(bb,parcelCtl.signal);parcels=r.list;parcelSource=r.source;
  m.getSource('parcels').setData(FC(parcels.map((p,i)=>({type:'Feature',id:i,properties:{i},geometry:p.geometry}))));renderText()}catch{}
}
function setLayer(kind,on){
 if(kind==='buurt'){showBuurt=on;for(const id of ['buurt-fill','buurt-casing','buurt-line','buurt-label'])m?.getLayer(id)&&m.setLayoutProperty(id,'visibility',on?'visible':'none')}
 else{showParcel=on;for(const id of ['parcel-fill','parcel-line'])m?.getLayer(id)&&m.setLayoutProperty(id,'visibility',on?'visible':'none');loadParcels()}
 renderText();
}
entry.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>setLayer(b.dataset.layer,b.getAttribute('aria-pressed')!=='true'));

// ---------- search: city, city + neighbourhood, address, lat/lon or RD x/y ----------
const LS='https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const TYPE_LABEL={gemeente:'municipality',woonplaats:'city / town',wijk:'district',buurt:'neighbourhood',weg:'street',postcode:'postcode',adres:'address'};
async function getJSON(url,ms=6000){const r=await fetch(url,{signal:AbortSignal.timeout(ms)});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}
function parseWKT(w){
 const nums=s=>s.trim().split(',').map(p=>p.trim().split(/\s+/).map(Number));
 if(w.startsWith('POINT'))return{type:'Point',coordinates:nums(w.slice(w.indexOf('(')+1,w.lastIndexOf(')')))[0]};
 const body=w.slice(w.indexOf('(')),polys=[];
 for(const pm of body.matchAll(/\(\(([^()]*(?:\)\s*,\s*\([^()]*)*)\)\)/g))polys.push(pm[1].split(/\)\s*,\s*\(/).map(nums));
 return polys.length?{type:'MultiPolygon',coordinates:polys}:null;
}
function localSearch(q){
 const toks=q.toLocaleLowerCase().split(/[\s,]+/).filter(Boolean),cities=[['nijkerkerveen','Nijkerkerveen'],['hoevelaken','Hoevelaken'],['nijkerk','Nijkerk']];
 const city=cities.find(([k])=>toks.includes(k)),rest=toks.filter(t=>t!==city?.[0]),out=[];
 const inCity=b=>!city||(city[0]==='nijkerk'?!/^(hoevelaken|nijkerkerveen)/i.test(b.name):b.name.toLocaleLowerCase().startsWith(city[0]));
 if(rest.length)for(const b of buurten){const nm=b.name.toLocaleLowerCase();if(inCity(b)&&rest.every(t=>nm.includes(t)))out.push({label:b.name,sub:`neighbourhood · ${b.wijk||'Nijkerk'}`,kind:'buurt',geometry:b.geometry,code:b.code})}
 if(city&&!rest.length){const geoms=city[0]==='nijkerk'?[gem?.geometry]:buurten.filter(inCity).map(b=>b.geometry);out.push({label:city[1],sub:'city / town · Nijkerk',kind:'woonplaats',geometry:{type:'MultiPolygon',coordinates:geoms.filter(Boolean).flatMap(polysOf)}})}
 return out.slice(0,8);
}
function parseCoords(q){
 const mm=q.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*(?:[,;]\s*|\s+)([+-]?\d+(?:\.\d+)?)\s*$/);if(!mm)return null;let a=+mm[1],b=+mm[2];
 if(Math.abs(a)>1000&&Math.abs(b)>1000){if(a>b)[a,b]=[b,a];if(a<-7000||a>300000||b<289000||b>629000)return{error:'RD coordinates outside the Netherlands.'};return{ll:D.geo.toWgs(a,b),label:`RD ${Math.round(a)}, ${Math.round(b)}`}}
 if(Math.abs(a)<=90&&Math.abs(b)<=180){if(a>=0&&a<=20&&b>=40&&b<=70)[a,b]=[b,a];return{ll:[b,a],label:`${a.toFixed(5)}, ${b.toFixed(5)}`}}
 return{error:'Enter latitude, longitude (e.g. 52.22, 5.48) or RD x, y (e.g. 161700, 470560).'};
}
async function goTo(r,{keepList=false}={}){
 if(!keepList)el('.world-results').replaceChildren();
 let geom=r.geometry;
 if(!geom&&r.id&&['buurt','wijk','woonplaats','gemeente'].includes(r.kind)){try{const d=await getJSON(`${LS}/lookup?id=${encodeURIComponent(r.id)}&fl=geometrie_ll`);geom=parseWKT(d.response.docs[0].geometrie_ll)}catch{}}
 if(geom&&geom.type!=='Point'){
  if(r.kind==='buurt'||r.kind==='wijk')setFocus({kind:r.kind,name:r.label,code:r.code||null,kindLabel:TYPE_LABEL[r.kind],geometry:geom});
  else{setFocus(null);const w=D.bboxOf(geom);m.fitBounds([[w[0],w[1]],[w[2],w[3]]],{padding:pad({top:60,bottom:60,left:420,right:60}),pitch:0,bearing:0,maxZoom:15,duration:1200})}
 }else if(r.center)m.flyTo({center:r.center,zoom:r.kind==='adres'||r.kind==='coords'?17.5:16.5,pitch:0,bearing:0,duration:1300});
 status(r.kind==='coords'?'Click on the map, or use “Place site at map centre”, to put the site here.':'');
}
el('form').onsubmit=async e=>{
 e.preventDefault();const q=el('input').value.trim();if(!q)return;const results=el('.world-results');results.replaceChildren();status('');
 const co=parseCoords(q);
 if(co){if(co.error){status(co.error);return}goTo({kind:'coords',label:co.label,center:co.ll});return}
 status('Searching…');let list=[];
 if(D.online!==false){try{
  const d=await getJSON(`${LS}/free?${new URLSearchParams({q,rows:'8',fq:'type:(gemeente OR woonplaats OR wijk OR buurt OR weg OR postcode OR adres)'})}`);
  list=d.response.docs.map(x=>{const c=x.centroide_ll&&parseWKT(x.centroide_ll);return{id:x.id,kind:x.type,label:x.weergavenaam,sub:TYPE_LABEL[x.type]||x.type,center:c?.coordinates}});
  if(!list.length){const g=await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({name:q,count:'5',language:'en',format:'json'})}`);
   list=(g.results||[]).map(c=>({kind:'city',label:c.name,sub:[c.admin1,c.country].filter(Boolean).join(', '),center:[c.longitude,c.latitude]}))}
 }catch{}}
 if(!list.length)list=localSearch(q);
 // rank: labels containing every word first; multi-word queries favour neighbourhoods / addresses, single words favour towns
 const toks=q.toLocaleLowerCase().split(/[\s,]+/).filter(Boolean),multi=toks.length>1;
 const pri=multi?{buurt:6,wijk:5,adres:4,weg:3,postcode:3,woonplaats:2,gemeente:1}:{woonplaats:6,city:6,gemeente:5,buurt:4,wijk:3,weg:2,postcode:2,adres:1};
 list=list.map((r,i)=>({r,s:(toks.every(t=>r.label.toLocaleLowerCase().includes(t))?10:0)+(pri[r.kind]||0)-i*.01})).sort((a,b)=>b.s-a.s).map(x=>x.r);
 status(list.length?'':'No match. Try a city, “city neighbourhood”, an address or coordinates.');
 for(const r of list){const b=btn(r.label,()=>goTo(r));const s=document.createElement('small');s.textContent=r.sub||'';b.append(s);results.append(b)}
 if(list.length)goTo(list[0],{keepList:list.length>1});
};
el('#preset-gem').onclick=()=>{setFocus(null,{fly:false});if(gem&&m){const b=D.bboxOf(gem.geometry);m.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:pad({top:60,bottom:60,left:420,right:60}),pitch:0,bearing:0,duration:1200})}};
el('#preset-sample').onclick=()=>{const b=buurten.find(x=>x.code===(S?.sampleBuurt||'BU02670106'));if(b)setFocus({kind:'buurt',name:b.name,code:b.code,kindLabel:'CBS neighbourhood',geometry:b.geometry})};
el('#world-aerial').onclick=()=>{aerialOn=!aerialOn;m?.getLayer('aerial')&&m.setLayoutProperty('aerial','visibility',aerialOn?'visible':'none');el('#world-aerial').setAttribute('aria-pressed',String(aerialOn))};
el('#world-flat').onclick=()=>m?.easeTo({pitch:0,bearing:0,duration:700});
el('#world-tilt').onclick=()=>m?.easeTo({pitch:55,bearing:-20,duration:700});
el('#world-plus').onclick=()=>m?.zoomTo(m.getZoom()+1,{duration:300});
el('#world-minus').onclick=()=>m?.zoomTo(m.getZoom()-1,{duration:300});

// ---------- hand-off to the editor ----------
async function enterSite(){
 if(!sel||!model)return;
 window.__basemap=null;
 let gridParcels=[];
 try{status('Loading parcel boundaries…');const b=D.bboxOf(sel.rd),sw=D.geo.toWgs(b[0]-10,b[1]-10),ne=D.geo.toWgs(b[2]+10,b[3]+10);gridParcels=(await D.parcels([sw[0],sw[1],ne[0],ne[1]])).list}catch{}
 status('');
 document.body.classList.remove('world-is-open');
 window.dispatchEvent(new CustomEvent('enter-design-site',{detail:{name:sel.name,kind:'site',code:sel.code,geometry:sel.geometry,center:D.geo.toWgs(...sel.center),
  rd:{geometry:sel.rd,center:sel.center,angle:sel.angle,size:SITE},model,parcels:gridParcels,study:false}}));
 entry.classList.add('fading');setTimeout(()=>{entry.hidden=true;entry.classList.remove('fading')},850);
}
window.openWorldMap=()=>{entry.hidden=false;entry.classList.remove('fading');document.body.classList.add('world-is-open');renderText();requestAnimationFrame(()=>m?.resize())};
window.NSPicker={placeSite:(lon,lat,opts={})=>placeSiteAt(D.geo.toRd(lon,lat),opts),rotate:a=>updateSite({angle:a}),align:alignToBuildings,
 focusBuurt:code=>{const b=buurten.find(x=>x.code===code);if(b)setFocus({kind:'buurt',name:b.name,code:b.code,kindLabel:'CBS neighbourhood',geometry:b.geometry})},
 search:q=>{el('input').value=q;el('form').requestSubmit()},setLayer,
 get state(){return{sel,focus,model,message,buurten:buurten.length,parcels:parcels.length,online:D.online,shown:shownCount,tiles:tiles.size,pending:siteTilesPending(),caps:CAPS}},get map(){return m},enterSite};

async function init(){
 renderText();
 try{if(!window.maplibregl)throw Error();const r=await fetch('map-assets/positron.json');if(!r.ok)throw Error();startGL(await prepareStyle(await r.json()))}
 catch{el('#world-map').hidden=true;el('.world-card').replaceChildren(Object.assign(document.createElement('h2'),{textContent:'Nijkerk'}),Object.assign(document.createElement('p'),{textContent:'This browser cannot show the WebGL map, so a site cannot be placed here.'}))}
}
document.body.classList.add('world-is-open');init();
})();
