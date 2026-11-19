(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GridModel=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// Grid size is per model (columns × rows, cell size in metres); use(m) makes a model's grid current.
let C=20,R=20,CELL=5;const SIZE=20,USES=['residential','commercial','public'],TYPES=['building','road','water','plant','tree'];
const GROUND=['asphalt','concrete','permeable','gravel'];const ROOF=['lightroof','tile','metal','concrete'];const FACADE=['brick','concrete','timber','metal'];const PLANTS=['grass','meadow','shrubs'];const TREES=['deciduous','conifer'];
const clone=o=>JSON.parse(JSON.stringify(o));const fail=k=>{throw new Error(k)};
const CELL_SIZES=[2.5,5,10,20,25],MAX_CELLS=60000,MAX_ENTITIES=20000;
function use(m){if(m&&m.grid){C=m.grid.columns;R=m.grid.rows;CELL=m.grid.cellSize}return m}
function dims(){return{columns:C,rows:R,cellSize:CELL}}
function blank(columns=20,rows=20,cellSize=5){const m={version:3,grid:{columns,rows,cellSize,units:'m'},cells:Array(columns*rows).fill(0),entities:[],workflow:{level:1,finished:false}};use(m);return m}
// Buildings imported from 3DBAG keep their real footprint: shape 'footprint', parts [{h, ring:[[x,y],…]}] relative to (x, y), in cell units.
const isFoot=e=>e&&e.type==='building'&&e.shape==='footprint';
function footRings(e){return e.parts.map(p=>p.ring.map(([x,y])=>[x+e.x,y+e.y]))}
function inRing(x,y,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
function ringArea(r){let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=(r[j][0]+r[i][0])*(r[j][1]-r[i][1]);return Math.abs(s/2)}
function footArea(e){return footRings(e).reduce((s,r)=>s+ringArea(r),0)}
const footCache=new WeakMap();
function footCells(e){const key=e.x+','+e.y+','+C+','+R,hit=footCache.get(e);if(hit&&hit.key===key&&hit.parts===e.parts)return hit.cells;
 const rings=footRings(e),out=[];let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const r of rings)for(const[x,y]of r){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
 for(let y=Math.max(0,Math.floor(y0));y<=Math.min(R-1,Math.floor(y1));y++)for(let x=Math.max(0,Math.floor(x0));x<=Math.min(C-1,Math.floor(x1));x++)if(rings.some(r=>inRing(x+.5,y+.5,r)))out.push(y*C+x);
 footCache.set(e,{key,parts:e.parts,cells:out});return out}
function cellsFor(e){const a=[];if(e.type==='tree')return a;if(isFoot(e))return footCells(e);for(let y=e.y;y<e.y+e.d;y++)for(let x=e.x;x<e.x+e.w;x++)a.push(y*C+x);return a}
function rectangle(a,b){return{x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(a[0]-b[0])+1,d:Math.abs(a[1]-b[1])+1}}
function treeInside(t,e){if(isFoot(e))return footRings(e).some(r=>inRing(t.x,t.y,r));return t.x>e.x&&t.x<e.x+e.w&&t.y>e.y&&t.y<e.y+e.d}
function validNumber(n,lo,hi){return typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi}
function nearTree(t,o){if(isFoot(o)){const b=footBox(o);return t.x>=b[0]&&t.x<=b[2]&&t.y>=b[1]&&t.y<=b[3]}return t.x>=o.x&&t.x<=o.x+o.w&&t.y>=o.y&&t.y<=o.y+o.d}
const boxCache=new WeakMap();function footBox(e){const k=e.x+','+e.y,h=boxCache.get(e);if(h&&h.k===k&&h.p===e.parts)return h.b;let b=[Infinity,Infinity,-Infinity,-Infinity];for(const r of footRings(e))for(const[x,y]of r){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)}boxCache.set(e,{k,p:e.parts,b});return b}
function validParts(e){return Array.isArray(e.parts)&&e.parts.length>0&&e.parts.length<=80&&e.parts.every(p=>p&&validNumber(p.h,0,250)&&Array.isArray(p.ring)&&p.ring.length>=3&&p.ring.length<=400&&p.ring.every(q=>Array.isArray(q)&&q.length===2&&validNumber(q[0],-400,400)&&validNumber(q[1],-400,400)))}
function shapeError(e){
 if(e.type==='tree'){
  if(!validNumber(e.x,0,C)||!validNumber(e.y,0,R))return 'outside';
  const centered=e.anchor==='center'&&e.x%1===.5&&e.y%1===.5;
  const node=e.anchor==='intersection'&&Number.isInteger(e.x)&&Number.isInteger(e.y);
  if(!centered&&!node&&e.anchor!=='free')return 'treeSnap';
  return null;
 }
 if(isFoot(e)){if(!validNumber(e.x,-400,C+400)||!validNumber(e.y,-400,R+400)||!validParts(e))return 'outside';const rs=footRings(e),n=rs.reduce((s,r)=>s+r.length,0),cx=rs.reduce((s,r)=>s+r.reduce((t,p)=>t+p[0],0),0)/n,cy=rs.reduce((s,r)=>s+r.reduce((t,p)=>t+p[1],0),0)/n;return cx<0||cy<0||cx>C||cy>R?'outside':null}
 if(![e.x,e.y,e.w,e.d].every(Number.isInteger)||e.x<0||e.y<0||e.w<1||e.d<1||e.x+e.w>C||e.y+e.d>R)return 'outside';
 return null;
}
function placementError(m,e,moving=false){use(m);const shape=shapeError(e);if(shape)return shape;if(e.type==='tree'){
 if(m.entities.some(o=>o.id!==e.id&&o.type==='tree'&&o.x===e.x&&o.y===e.y))return 'treeExists';
 if(m.entities.some(o=>(o.type==='building'||o.type==='water')&&nearTree(e,o)&&treeInside(e,o)))return 'treeBlocked';
 return null;
 }
 const taken=new Set(cellsFor(e));
 const code=landCode[e.type]; if([...taken].some(i=>m.cells[i]!==0&&m.cells[i]!==code&&!(moving&&m.cells[i]===1)))return 'landConflict';
 if(taken.size&&m.entities.some(o=>o.id!==e.id&&o.type!=='tree'&&cellsFor(o).some(i=>taken.has(i))))return 'occupiedError';
 if(['building','water'].includes(e.type)&&m.entities.some(o=>o.type==='tree'&&nearTree(o,e)&&treeInside(o,e)))return 'treeBlocked';
 return null;
}
const landCode={building:1,road:2,plant:3,water:4};
function syncGround(m) {
 use(m);
 const keep=m.entities.filter(e=>e.type==='tree'||cellsFor(e).every(i=>m.cells[i]===landCode[e.type]));
 const used=new Set(keep.flatMap(cellsFor));const ids=new Set(keep.map(e=>e.id)),counters={};
 const N=C*R;
 for(let i=0;i<N;i++){
  const code=m.cells[i];if(code<2||used.has(i))continue;
  const x=i%C,y=Math.floor(i/C),free=j=>m.cells[j]===code&&!used.has(j);
  let w=1,d=1;while(x+w<C&&free(i+w))w++;
  while(y+d<R&&Array.from({length:w},(_,k)=>free(i+d*C+k)).every(Boolean))d++;
  const type=['','','road','plant','water'][code],pre=type[0].toUpperCase();let id;
  do{id=pre+String(counters[pre]=(counters[pre]||0)+1).padStart(2,'0')}while(ids.has(id));
  const e={id,type,x,y,w,d};if(type==='road')e.material='asphalt';if(type==='plant')e.plantType='grass';
  keep.push(e);ids.add(id);cellsFor(e).forEach(j=>used.add(j));
 }
 m.entities=keep;
}
function mark(m,indices,value){use(m);if(![0,1,2,3,4].includes(value))fail('invalid');const unique=[...new Set(indices)];if(unique.some(i=>!Number.isInteger(i)||i<0||i>=C*R))fail('invalid');const buildingCells=new Set(m.entities.filter(e=>e.type==='building').flatMap(cellsFor));if(value!==1&&unique.some(i=>buildingCells.has(i)))fail('buildingProtected');unique.forEach(i=>m.cells[i]=value);syncGround(m);m.workflow.finished=false}
function add(m,e){use(m);if(m.entities.length>=MAX_ENTITIES)fail('tooMany');const err=placementError(m,e);if(err)fail(err);cellsFor(e).forEach(i=>m.cells[i]=landCode[e.type]);m.entities.push(e);m.workflow.finished=false}
function patch(m,id,props){use(m);const e=m.entities.find(o=>o.id===id);if(!e)fail('invalid');const candidate={...e,...props};const moving=props.x!==undefined||props.y!==undefined;const err=placementError(m,candidate,moving);if(err)fail(err);if(moving&&e.type!=='tree'){if(e.type!=='building')cellsFor(e).forEach(i=>m.cells[i]=0);cellsFor(candidate).forEach(i=>m.cells[i]=landCode[e.type]);}if(isFoot(e)&&props.height!==undefined&&props.height!==e.height&&e.height>0){const k=props.height/e.height;props={...props,parts:e.parts.map(p=>({...p,h:Math.round(p.h*k*10)/10}))}}Object.assign(e,props);m.workflow.finished=false}
function metrics(m){use(m);const buildings=m.entities.filter(e=>e.type==='building');return{cells:C*R,cellArea:CELL*CELL,buildable:m.cells.filter(c=>c===1).length,nonbuildable:m.cells.filter(c=>c===2).length,unassigned:m.cells.filter(c=>c===0).length,occupied:new Set(m.entities.filter(e=>e.type!=='tree').flatMap(cellsFor)).size,buildings:buildings.length,trees:m.entities.filter(e=>e.type==='tree').length,building_footprint:buildings.reduce((s,e)=>s+(isFoot(e)?footArea(e):e.w*e.d)*CELL*CELL,0)}}
function advance(m){if(m.workflow.level===1){m.workflow.level=2}else if(m.workflow.level===2){if(!m.entities.length)fail('placeFirst');m.workflow.level=3}else m.workflow.finished=true}
function validate(m){const g=m?.grid;if(!m||m.version!==3||!g||!Number.isInteger(g.columns)||!Number.isInteger(g.rows)||g.columns<1||g.rows<1||g.columns*g.rows>MAX_CELLS||!CELL_SIZES.includes(g.cellSize)||g.units!=='m'||!Array.isArray(m.cells)||m.cells.length!==g.columns*g.rows||m.cells.some(c=>c!==0&&c!==1&&c!==2&&c!==3&&c!==4)||!Array.isArray(m.entities)||m.entities.length>MAX_ENTITIES)fail('invalid');use(m);if(!m.workflow||![1,2,3].includes(m.workflow.level)||typeof m.workflow.finished!=='boolean'||(m.workflow.level===3&&!m.entities.length)||(m.workflow.finished&&m.workflow.level!==3))fail('invalid');const ids=new Set();for(const e of m.entities){if(!e||typeof e.id!=='string'||!/^[A-Z][A-Z0-9]{1,20}$/.test(e.id)||ids.has(e.id)||!TYPES.includes(e.type))fail('invalid');ids.add(e.id);if(e.type==='tree'){if(!validNumber(e.radius,1,8)||!validNumber(e.height,2,20)||!TREES.includes(e.species))fail('invalid')}if(e.type==='building'&&(!Number.isInteger(e.storeys)||!validNumber(e.storeys,1,20)||!validNumber(e.height,3,60)||!USES.includes(e.use)||!ROOF.includes(e.roof)||!FACADE.includes(e.facade)))fail('invalid');if(e.type==='road'&&!GROUND.includes(e.material))fail('invalid');if(e.type==='plant'&&!PLANTS.includes(e.plantType))fail('invalid');if(isFoot(e)&&e.shape!=='footprint')fail('invalid');const err=shapeError(e);if(err)fail(err);if(cellsFor(e).some(i=>m.cells[i]!==landCode[e.type]))fail('landConflict')}
 const owner=new Map(),anchors=new Set();
 // imported 3DBAG footprints may overlap their neighbours slightly; that is real data, not an editing error
 for(const e of m.entities){if(e.type==='tree')continue;for(const i of cellsFor(e)){const o=owner.get(i);if(o){if(isFoot(o)&&isFoot(e))continue;fail('occupiedError')}owner.set(i,e)}}
 for(const e of m.entities){if(e.type!=='tree')continue;const k=e.x+','+e.y;if(anchors.has(k))fail('treeExists');anchors.add(k);
  const cx=Math.floor(e.x),cy=Math.floor(e.y),near=new Set();for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=cx+dx,Y=cy+dy;if(X>=0&&Y>=0&&X<C&&Y<R){const o=owner.get(Y*C+X);if(o&&(o.type==='building'||o.type==='water'))near.add(o)}}
  for(const o of near)if(treeInside(e,o))fail('treeBlocked')}
 return m}
return{use,dims,CELL_SIZES,MAX_CELLS,MAX_ENTITIES,footBox,isFoot,footRings,footArea,inRing,syncGround,landCode,SIZE,CELL,USES,TYPES,GROUND,ROOF,FACADE,PLANTS,TREES,blank,clone,cellsFor,rectangle,treeInside,placementError,mark,add,patch,metrics,advance,validate};
});