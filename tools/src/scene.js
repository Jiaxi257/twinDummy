// Canvas scene for the editor. The SVG #scene stays on top for pointer input, selection outlines and drag ghosts;
// everything else is drawn on a canvas underneath, using the SVG's own viewBox → screen transform.
// Grid coordinates are cells (x east, y south); heights are metres.
const cam={cx:10,cy:10};
let sceneKey='',sceneHits=[],modelRev=0,sceneCanvas=null,panState=null,wheelState=null;
function bump(){modelRev++}
const gridC=()=>model.grid.columns,gridR=()=>model.grid.rows,gridS=()=>model.grid.cellSize;
const mScale=()=>5/gridS(); // metres → the 5 m reference the original drawing constants were tuned for
function project(x,y,z=0){const{a,b,c,d}=basis;return[410+zoom*(a*(x-cam.cx)+b*(y-cam.cy)),325+zoom*(-9-42*tilt+c*(x-cam.cx)+d*(y-cam.cy)-z*3.5*mScale()*tilt)]}
function unproject(x,y){const{a,b,c,d}=basis,det=a*d-b*c,u=(x-410)/zoom,v=(y-325)/zoom+9+42*tilt;return[cam.cx+(d*u-b*v)/det,cam.cy+(a*v-c*u)/det]}
function fitZoom(){const M=showContext?(SITE_DATA.layout?.margin??10):1.5;return 24/(Math.max(gridC(),gridR())+M)}
function zoomLimits(){const f=fitZoom();return[Math.min(f*.5,.3),Math.max(3,f)]}
function resetCamera(){cam.cx=gridC()/2;cam.cy=gridR()/2;zoom=fitZoom()}
function zoomAt(f,sx=410,sy=325){const p=unproject(sx,sy),[lo,hi]=zoomLimits();zoom=Math.min(hi,Math.max(lo,zoom*f));const q=unproject(sx,sy);cam.cx+=p[0]-q[0];cam.cy+=p[1]-q[1]}
function zoomBy(f){zoomAt(f);renderScene()}
function fitView(){resetCamera();renderScene()}
function svgXY(ev){const s=$('#scene'),p=s.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;const q=p.matrixTransform(s.getScreenCTM().inverse());return[q.x,q.y]}

// ---------- drawing ----------
function ensureCanvas(){
 if(sceneCanvas)return sceneCanvas;
 sceneCanvas=document.createElement('canvas');sceneCanvas.id='sceneCanvas';
 sceneCanvas.style.cssText='position:absolute;pointer-events:none;transform-origin:0 0';
 $('#canvasWrap').insertBefore(sceneCanvas,$('#scene'));
 return sceneCanvas;
}
function inside2(pt,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)c=!c}return c}
function pickAt(sx,sy){for(let i=sceneHits.length-1;i>=0;i--){const h=sceneHits[i];if(sx<h.b[0]||sx>h.b[2]||sy<h.b[1]||sy>h.b[3])continue;if(inside2([sx,sy],h.p))return h.id}return null}
function pickEvent(ev){const[x,y]=svgXY(ev);return pickAt(x,y)}
function hitPolysFor(id){return sceneHits.filter(h=>h.id===id).map(h=>h.p)}

function renderScene(){
 const svg=$('#scene'),cv=ensureCanvas(),wrap=$('#canvasWrap').getBoundingClientRect(),r=svg.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
 if(!r.width||!r.height){renderGhost();return}
 const W=Math.round(r.width*dpr),H=Math.round(r.height*dpr);
 if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
 Object.assign(cv.style,{left:(r.left-wrap.left)+'px',top:(r.top-wrap.top)+'px',width:r.width+'px',height:r.height+'px'});
 renderGridText();
 const key=[modelRev,phase()===1,tilt.toFixed(3),zoom.toFixed(4),cam.cx.toFixed(3),cam.cy.toFixed(3),showContext,W,H,lang].join('|');
 if(key!==sceneKey){sceneKey=key;drawScene(cv,svg,r,dpr)}
 renderOverlay();renderGhost();
}
function drawScene(cv,svg,rect,dpr){
 const ctx=cv.getContext('2d'),m=svg.getScreenCTM();
 ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,cv.width,cv.height);
 ctx.setTransform(m.a*dpr,0,0,m.d*dpr,(m.e-rect.left)*dpr,(m.f-rect.top)*dpr);
 const vx0=(rect.left-m.e)/m.a-40,vy0=(rect.top-m.f)/m.d-40,vx1=(rect.right-m.e)/m.a+40,vy1=(rect.bottom-m.f)/m.d+40;
 const C=gridC(),R=gridR(),z3=tilt>0.001,hits=[];sceneHits=hits;
 const P=(x,y,z=0)=>project(x,y,z);
 const visible=pts=>{let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const p of pts){if(p[0]<a)a=p[0];if(p[1]<b)b=p[1];if(p[0]>c)c=p[0];if(p[1]>d)d=p[1]}return c>=vx0&&a<=vx1&&d>=vy0&&b<=vy1?[a,b,c,d]:null};
 const path=pts=>{ctx.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]);ctx.closePath()};
 const fillPts=(pts,fill,stroke,lw,alpha=1)=>{ctx.beginPath();path(pts);if(alpha!==1)ctx.globalAlpha=alpha;if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke()}if(alpha!==1)ctx.globalAlpha=1};
 const hit=(id,pts)=>{const b=visible(pts);if(b)hits.push({id,p:pts,b})};
 const px=1/m.a; // one screen pixel in viewBox units

 // 1 · terrain and context ground
 const win=LANDSCAPE_DATA.window||[-10,-10,C+10,R+10];
 if(showContext){
  fillPts([P(win[0],win[1]),P(win[2],win[1]),P(win[2],win[3]),P(win[0],win[3])],'#f0f1ea','#d4d9cc',1);
  const colors={road:'#dcded7',green:'#bdd1a7',hedge:'#9bb98d',water:'#99c3ce'};
  for(const k of Object.keys(colors)){ctx.beginPath();let any=false;
   for(const g of LANDSCAPE_DATA.ground){if(g.kind!==k)continue;const rings=g.rings.map(rg=>rg.map(q=>P(q[0],q[1])));if(!visible(rings[0]))continue;for(const rg of rings)path(rg);any=true}
   if(any){ctx.fillStyle=colors[k];ctx.fill('evenodd')}}
 }
 // 2 · grid slab and cells (one path per land-use code)
 if(z3){fillPts([P(0,R),P(C,R),P(C,R,-1.5),P(0,R,-1.5)],'#bbc8ae');fillPts([P(C,0),P(C,R),P(C,R,-1.5),P(C,0,-1.5)],'#aebb9f')}
 for(const code of [0,1,2,3,4]){ctx.beginPath();let any=false;
  for(let y=0;y<R;y++){let x=0;while(x<C){if(model.cells[y*C+x]!==code){x++;continue}let x1=x;while(x1<C&&model.cells[y*C+x1]===code)x1++;const q=[P(x,y),P(x1,y),P(x1,y+1),P(x,y+1)];if(visible(q)){path(q);any=true}x=x1}}
  if(any){ctx.fillStyle=zoneColors[code];ctx.globalAlpha=code===0?(showContext?.42:1):1;ctx.fill();ctx.globalAlpha=1}}
 // 3 · grid lines and labels
 const cellPx=zoom*23*m.a,major=C*R>1600?10:5;
 ctx.beginPath();
 for(let n=0;n<=C;n++){if(cellPx<7&&n%major&&n!==C)continue;const a=P(n,0),b=P(n,R);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}
 for(let n=0;n<=R;n++){if(cellPx<7&&n%major&&n!==R)continue;const a=P(0,n),b=P(C,n);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}
 ctx.strokeStyle=cellPx<7?'rgba(167,184,153,.9)':'rgba(189,201,177,.75)';ctx.lineWidth=(cellPx<7?.8:.6)*px*Math.min(1.5,Math.max(.7,m.a));ctx.stroke();
 if(cellPx>=7){ctx.beginPath();for(let n=0;n<=C;n+=major){const a=P(n,0),b=P(n,R);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}for(let n=0;n<=R;n+=major){const a=P(0,n),b=P(C,n);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}ctx.strokeStyle='#a7b899';ctx.lineWidth=.9*px;ctx.stroke()}
 fillPts([P(0,0),P(C,0),P(C,R),P(0,R)],null,'#93a785',1.4*px);
 const step=Math.max(1,[1,5,10,20,50,100].find(s=>s*cellPx>=34)||100),fs=Math.max(8,Math.min(13,9*zoom*m.a))*px;
 ctx.fillStyle='#91a180';ctx.font=`${fs}px Inter,Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
 for(let n=step;n<=C;n+=step){const a=P(n-.5,-.6);ctx.fillText(String(n),a[0],a[1])}
 for(let n=step;n<=R;n+=step){const a=P(-.6,n-.5);ctx.fillText(String(n),a[0],a[1])}
 // site outline
 if(SITE_DATA.outline?.length){ctx.beginPath();for(const rg of SITE_DATA.outline)path(rg.map(q=>P(q[0],q[1])));ctx.setLineDash([6*px,4*px]);ctx.strokeStyle='#2c674b';ctx.lineWidth=1.6*px;ctx.stroke();ctx.setLineDash([])}
 // 4 · flat entities
 const faded=phase()===1;
 for(const e of model.entities){if(e.type==='tree'||e.type==='building')continue;
  const q=[P(e.x,e.y),P(e.x+e.w,e.y),P(e.x+e.w,e.y+e.d),P(e.x,e.y+e.d)];if(!visible(q))continue;
  const fill=e.type==='road'?materialColors[e.material]:e.type==='water'?'#9dbec0':plantColors[e.plantType];
  fillPts(q,fill,'#f5f7ee',.7*px,faded?.18:1);hit(e.id,q)}
 // 5 · parcel boundaries (locked)
 if(model.parcels?.length){ctx.beginPath();for(const p of model.parcels)path(p.ring.map(q=>P(q[0],q[1])));ctx.setLineDash([5*px,3*px]);ctx.strokeStyle='rgba(154,106,50,.85)';ctx.lineWidth=Math.min(1.6,Math.max(.8,1.1*zoom*m.a))*px;ctx.stroke();ctx.setLineDash([])}
 // 6 · solids: context buildings and trees plus entity buildings and trees, back to front
 const items=[],ms=mScale();
 const walls=(ring,h,colorFor,stroke,lw,id)=>{
  let a2=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a2+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];
  const sgn=a2>0?1:-1,es=[];
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ey=b[1]-a[1],nx=sgn*ey,ny=-sgn*ex;if(nx+ny<=0)continue;es.push([a,b,Math.abs(nx)>Math.abs(ny)])}
  es.sort((u,v)=>(u[0][0]+u[0][1]+u[1][0]+u[1][1])-(v[0][0]+v[0][1]+v[1][0]+v[1][1]));
  for(const[a,b,east]of es){const q=[P(a[0],a[1]),P(b[0],b[1]),P(b[0],b[1],h),P(a[0],a[1],h)];fillPts(q,colorFor(east),stroke,lw);if(id)hit(id,q)}
 };
 if(showContext){
  for(const c of SITE_DATA.context){const ring=c.ring;let dep=-Infinity;for(const p of ring)if(p[0]+p[1]>dep)dep=p[0]+p[1];
   items.push({d:dep,f:()=>{const top=ring.map(q=>P(q[0],q[1],z3?c.height:0));if(!visible(top))return;if(z3)walls(ring,c.height,e=>e?'#ccd1c9':'#e2e3dd','#c2c8be',.45*px);fillPts(top,'#fafaf7','#b8c0b4',.7*px)}})}
  for(const t of LANDSCAPE_DATA.trees)items.push({d:t[0]+t[1],f:()=>{const g=P(t[0],t[1]),c=P(t[0],t[1],z3?6:0),rr=(z3?3.7:5.2)*2.4*zoom*ms;if(c[0]<vx0||c[0]>vx1||c[1]<vy0||c[1]>vy1)return;
   if(z3){ctx.beginPath();ctx.moveTo(g[0],g[1]);ctx.lineTo(c[0],c[1]);ctx.strokeStyle='#8c8a73';ctx.lineWidth=1.8*zoom*ms;ctx.stroke()}
   ctx.beginPath();ctx.arc(c[0],c[1],rr,0,Math.PI*2);ctx.fillStyle='#a9c397';ctx.fill();ctx.strokeStyle='#95b286';ctx.lineWidth=.5*px;ctx.stroke()}})}
 for(const e of model.entities){
  if(e.type==='tree'){items.push({d:e.x+e.y,f:()=>{const g=P(e.x,e.y),c=P(e.x,e.y,z3?e.height:0),rr=e.radius*(z3?3.7:5.2)*zoom*ms;if(c[0]<vx0-rr||c[0]>vx1+rr||c[1]<vy0-rr||c[1]>vy1+rr)return;
   ctx.beginPath();ctx.arc(g[0],g[1],2*zoom*ms,0,Math.PI*2);ctx.fillStyle='#65815b';ctx.fill();
   if(z3){ctx.beginPath();ctx.moveTo(g[0],g[1]);ctx.lineTo(c[0],c[1]);ctx.strokeStyle='#7c8266';ctx.lineWidth=2*zoom*ms;ctx.stroke()}
   if(e.species==='conifer'&&z3){fillPts([[c[0],c[1]-rr],[c[0]+rr,c[1]+rr*.7],[c[0]-rr,c[1]+rr*.7]],'#6e915c','#648251',.6*px)}
   else{ctx.beginPath();ctx.arc(c[0],c[1],rr,0,Math.PI*2);ctx.fillStyle='#87a66e';ctx.fill();ctx.strokeStyle='#77955f';ctx.lineWidth=.7*px;ctx.stroke()}
   const o=[];for(let i=0;i<10;i++){const a=i/10*Math.PI*2;o.push([c[0]+Math.cos(a)*Math.max(rr,4*px),c[1]+Math.sin(a)*Math.max(rr,4*px)])}hit(e.id,o)}});continue}
  if(e.type!=='building')continue;
  const col=useColors[e.use];
  if(G.isFoot(e)){const rings=G.footRings(e),b=G.footBox(e);
   items.push({d:b[2]+b[3],f:()=>{if(!visible([P(b[0],b[1]),P(b[2],b[1]),P(b[2],b[3]),P(b[0],b[3]),P(b[0],b[1],z3?e.height*1.5:0)]))return;
    const parts=e.parts.map((p,i)=>({h:p.h,ring:rings[i],d:Math.max(...rings[i].map(q=>q[0]+q[1]))})).sort((u,v)=>u.d-v.d||u.h-v.h);
    for(const p of parts){if(z3)walls(p.ring,p.h,east=>shade(col,east?.81:.94),'#f3eee2',.35*px,e.id);const top=p.ring.map(q=>P(q[0],q[1],z3?p.h:0));fillPts(top,col,'#f8f4e9',.6*px);hit(e.id,top)}}})}
  else{const{x,y,w,d,height:h}=e;
   items.push({d:x+y+d,f:()=>{const top=[P(x,y,z3?h:0),P(x+w,y,z3?h:0),P(x+w,y+d,z3?h:0),P(x,y+d,z3?h:0)];
    if(z3){const s1=[P(x+w,y),P(x+w,y+d),P(x+w,y+d,h),P(x+w,y,h)],s2=[P(x,y+d),P(x+w,y+d),P(x+w,y+d,h),P(x,y+d,h)];fillPts(s1,shade(col,.81));fillPts(s2,shade(col,.94));hit(e.id,s1);hit(e.id,s2)}
    fillPts(top,col,'#f8f4e9',.7*px);hit(e.id,top)}})}
 }
 items.sort((a,b)=>a.d-b.d);for(const it of items)it.f();
}
// Selection outline on the SVG overlay (cheap to redraw without repainting the canvas)
function renderOverlay(){
 const e=selected();let out='';
 if(e){
  const z3=view==='3d';
  if(e.type==='tree'){const[a,b]=project(e.x,e.y,z3?e.height:0),r=e.radius*(z3?3.7:5.2)*zoom*mScale();out=`<circle cx="${a}" cy="${b}" r="${r+3}" fill="none" stroke="#2b6946" stroke-width="1.8" stroke-dasharray="3 2"/>`}
  else if(G.isFoot(e)){for(const [i,r] of G.footRings(e).entries())out+=poly(r.map(q=>[...q,z3?e.parts[i].h:0]),'none','stroke="#2c674b" stroke-width="1.8"')+poly(r,'none','stroke="#2c674b" stroke-width="1.3" stroke-dasharray="4 2"')}
  else if(e.type==='building'){const z=z3?e.height:0;out=poly(corners(e,z),'none','stroke="#2c674b" stroke-width="2.2"')+poly(corners(e),'none','stroke="#2c674b" stroke-width="1.5" stroke-dasharray="4 2"')}
  else out=poly(corners(e),'none','stroke="#286543" stroke-width="2.2"');
 }
 $('#map').innerHTML=`<g pointer-events="none">${out}</g>`;
}
// Grid size labels around the canvas
function renderGridText(){
 const g=model.grid,c=g.cellSize;
 // north arrow: RD north expressed in grid coordinates (the site may be rotated), projected to the screen
 const ar=$('.north span');if(ar){const t=(SITE_DATA.angle||0)*Math.PI/180,cx=g.columns/2,cy=g.rows/2,p0=project(cx,cy),p1=project(cx+Math.sin(t)*4,cy-Math.cos(t)*4);ar.style.display='inline-block';ar.style.transform=`rotate(${Math.atan2(p1[0]-p0[0],-(p1[1]-p0[1]))*180/Math.PI}deg)`}
 const badge=$('.canvas-top .badge');if(badge)badge.textContent=`${g.columns} × ${g.rows}`;
 const meta=$('.canvas-meta strong');if(meta)meta.textContent=`${Math.round(g.columns*c)} × ${Math.round(g.rows*c)} m`;
 const cs=$('[data-i=cellSize]');if(cs)cs.textContent=`${c} × ${c} m per cell`;
 const sn=$('[data-i=summaryNote]');if(sn)sn.textContent=`${(g.columns*g.rows).toLocaleString('en-GB')} cells · ${c*c} m² each`;
}

// ---------- pan and zoom ----------
// Drag empty space (select tool), middle / right drag, or two fingers to pan; wheel or pinch to zoom. While a gesture runs
// the last frame is moved with a CSS transform, and the scene is redrawn once at the end.
(function(){
 const scene=document.querySelector('#scene'),pointers=new Map();
 const cssOf=()=>{const m=scene.getScreenCTM();return m.a};
 function begin(){const cv=ensureCanvas();$('#map').innerHTML='';$('#ghost').replaceChildren();return cv}
 function commitPan(){
  const p=panState;panState=null;const cv=ensureCanvas();cv.style.transform='';
  if(!p||!p.moved)return;const k=cssOf(),r=scene.getBoundingClientRect();
  // translate + scale (pinch) applied in screen space → camera update in viewBox space
  const sx=(p.ox-r.left),sy=(p.oy-r.top);
  const m=scene.getScreenCTM(),toVB=(cx,cy)=>[(cx-m.e)/m.a,(cy-m.f)/m.d];
  const before=toVB(p.ox,p.oy),after=toVB(p.ox+p.dx,p.oy+p.dy);
  if(p.scale!==1)zoomAt(p.scale,...after);
  const a=unproject(...before),b=unproject(...after);cam.cx+=a[0]-b[0];cam.cy+=a[1]-b[1];
  renderScene();
 }
 scene.addEventListener('contextmenu',e=>e.preventDefault());
 scene.addEventListener('pointerdown',ev=>{
  pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
  if(pointers.size===2){ // pinch
   const[p1,p2]=[...pointers.values()];panState={pinch:true,ox:(p1.x+p2.x)/2,oy:(p1.y+p2.y)/2,dist:Math.hypot(p1.x-p2.x,p1.y-p2.y),dx:0,dy:0,scale:1,moved:true};
   gesture=null;begin();ev.stopImmediatePropagation();return}
  const empty=ev.button===0&&['select','inspect'].includes(tool)&&!pickEvent(ev);
  if(ev.button===1||ev.button===2||empty){panState={ox:ev.clientX,oy:ev.clientY,dx:0,dy:0,scale:1,moved:false,pointer:ev.pointerId,forced:ev.button!==0};
   if(ev.button!==0){ev.stopImmediatePropagation();ev.preventDefault()}}
 },true);
 scene.addEventListener('pointermove',ev=>{
  if(pointers.has(ev.pointerId))pointers.set(ev.pointerId,{x:ev.clientX,y:ev.clientY});
  if(!panState)return;
  if(panState.pinch){const ps=[...pointers.values()];if(ps.length<2)return;const[p1,p2]=ps,mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
   panState.dx=mx-panState.ox;panState.dy=my-panState.oy;panState.scale=Math.hypot(p1.x-p2.x,p1.y-p2.y)/panState.dist;}
  else{if(ev.pointerId!==panState.pointer)return;panState.dx=ev.clientX-panState.ox;panState.dy=ev.clientY-panState.oy;
   if(!panState.moved&&Math.hypot(panState.dx,panState.dy)<5)return;
   if(!panState.moved){panState.moved=true;begin();try{scene.setPointerCapture(ev.pointerId)}catch{}}}
  const cv=ensureCanvas(),r=scene.getBoundingClientRect(),ox=panState.ox-r.left,oy=panState.oy-r.top,s=panState.scale;
  cv.style.transformOrigin=`${ox}px ${oy}px`;cv.style.transform=`translate(${panState.dx}px,${panState.dy}px) scale(${s})`;
  ev.stopImmediatePropagation();
 },true);
 const end=ev=>{pointers.delete(ev.pointerId);if(!panState)return;if(panState.pinch){if(pointers.size<2){ev.stopImmediatePropagation();commitPan()}return}
  if(ev.pointerId!==panState.pointer)return;if(panState.moved)ev.stopImmediatePropagation();commitPan()};
 scene.addEventListener('pointerup',end,true);scene.addEventListener('pointercancel',end,true);
 scene.addEventListener('wheel',ev=>{
  ev.preventDefault();const f=Math.exp(-ev.deltaY*(ev.ctrlKey?.01:.0018));
  if(!wheelState){wheelState={x:ev.clientX,y:ev.clientY,scale:1};begin()}
  wheelState.scale*=f;const cv=ensureCanvas(),r=scene.getBoundingClientRect();
  cv.style.transformOrigin=`${wheelState.x-r.left}px ${wheelState.y-r.top}px`;cv.style.transform=`scale(${wheelState.scale})`;
  clearTimeout(wheelState.t);wheelState.t=setTimeout(()=>{const w=wheelState;wheelState=null;cv.style.transform='';const m=scene.getScreenCTM();zoomAt(w.scale,(w.x-m.e)/m.a,(w.y-m.f)/m.d);renderScene()},140);
 },{passive:false});
 new ResizeObserver(()=>{if(document.body.classList.contains('design-open'))renderScene()}).observe(document.querySelector('#canvasWrap'));
})();
