// Data layer: live PDOK / 3DBAG requests with a bundled Nijkerk sample as the offline fallback.
// Model coordinates are RD New (EPSG:28992) metres; boundary geometries for the map are WGS84.
const NSData=(()=>{
 'use strict';
 const RD='http://www.opengis.net/def/crs/EPSG/0/28992';
 const CBS='https://api.pdok.nl/cbs/wijken-en-buurten-2026/ogc/v1/collections';
 const BRK='https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1/collections/perceel/items';
 const BGT='https://api.pdok.nl/lv/bgt/ogc/v1/collections';
 const BAG3D='https://api.3dbag.nl/collections/pand/items';
 const GM='GM0267', MAX_AREA=1.5e6;
 const BGT_COLLS=['wegdeel','ondersteunendwegdeel','waterdeel','ondersteunendwaterdeel','begroeidterreindeel','vegetatieobject_punt'];
 const geo=RDGEO;
 let online=null, sample=null;
 const raw=()=>window.__assets?.nijkerk;

 // ---- generic helpers -------------------------------------------------------
 const qs=(u,p)=>u+(u.includes('?')?'&':'?')+new URLSearchParams(p);
 async function getJSON(url,{signal,timeout=20000}={}){
  if(online===false)throw new Error('offline');
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeout);
  signal?.addEventListener('abort',()=>ctl.abort());
  try{const r=await fetch(url,{signal:ctl.signal});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();online=true;return d}
  catch(e){if(signal?.aborted)throw e;if(online!==true&&(e instanceof TypeError||e.name==='AbortError'))online=false;throw e}
  finally{clearTimeout(timer)}
 }
 async function paged(url,opts,limitPages=30){
  let out=[],d=await getJSON(url,opts),n=1;
  while(true){out=out.concat(d.features||[]);const next=(d.links||[]).find(l=>l.rel==='next');if(!next||n>=limitPages)return out;d=await getJSON(next.href,opts);n++}
 }
 async function pool(items,size,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k],k)}}));return out}
 const polys=g=>!g?[]:g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 function bboxOf(g){let a=[Infinity,Infinity,-Infinity,-Infinity];for(const p of polys(g))for(const[x,y]of p[0]){if(x<a[0])a[0]=x;if(y<a[1])a[1]=y;if(x>a[2])a[2]=x;if(y>a[3])a[3]=y}return a}
 const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
 function ringArea(r){let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=(r[j][0]+r[i][0])*(r[j][1]-r[i][1]);return Math.abs(s/2)}
 function inRing(x,y,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const[xi,yi]=r[i],[xj,yj]=r[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
 function contains(g,x,y){return polys(g).some(p=>inRing(x,y,p[0])&&!p.slice(1).some(h=>inRing(x,y,h)))}
 const mapCoords=(g,f)=>({type:'MultiPolygon',coordinates:polys(g).map(p=>p.map(r=>r.map(c=>f(c[0],c[1]))))});
 const toRdGeom=g=>mapCoords(g,(x,y)=>geo.toRd(x,y));
 const toWgsGeom=g=>mapCoords(g,(x,y)=>geo.toWgs(x,y));
 function area(gRd){return polys(gRd).reduce((s,p)=>s+ringArea(p[0])-p.slice(1).reduce((a,h)=>a+ringArea(h),0),0)}
 function centroid(r){let x=0,y=0;for(const p of r){x+=p[0];y+=p[1]}return[x/r.length,y/r.length]}

 // ---- bundled sample ---------------------------------------------------------
 function decode(){
  if(sample||!raw())return sample;
  const s=raw();sample={fetched:s.fetched,gemeente:s.gemeente,buurten:s.buurten,sampleBuurt:s.sampleBuurt};
  return sample;
 }
 // ---- bundled municipality-wide data tiles (1 km RD tiles: data/<tx>_<ty>.json), loaded on demand ---------------
 const KINDS=['road','green','hedge','water'],tileCache=new Map();
 const tileIndex=()=>{const t=window.__assets?.nijkerkTiles;if(!t)return null;if(!t.set)t.set=new Set(t.tiles.map(([x,y])=>x+'_'+y));return t};
 function tileKeys(ext){const t=tileIndex();if(!t)return{keys:[],missing:1};const S=t.size,keys=[];let missing=0;
  for(let x=Math.floor(ext[0]/S);x<=Math.floor(ext[2]/S);x++)for(let y=Math.floor(ext[1]/S);y<=Math.floor(ext[3]/S);y++){const k=x+'_'+y;if(t.set.has(k))keys.push(k);else missing++}
  return{keys,missing}}
 function loadTile(k){
  if(!tileCache.has(k))tileCache.set(k,fetch(`data/${k}.json`).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(d=>{
   const[ox,oy]=d.origin,ring=f=>{const r=[];for(let i=0;i<f.length;i+=2)r.push([ox+f[i]/10,oy+f[i+1]/10]);return r};
   const buildings=d.buildings.map(([id,h,year,parts])=>({id:'NL.IMBAG.Pand.'+id,h,year,parts:parts.map(([ph,...rings])=>({h:ph,rings:rings.map(ring)}))}));
   for(const b of buildings)b.bbox=bboxOf({type:'MultiPolygon',coordinates:b.parts.map(p=>[p.rings[0]])});
   const ground=d.ground.map(([k,rings])=>{const g={kind:KINDS[k],rings:rings.map(ring)};g.bbox=bboxOf({type:'Polygon',coordinates:g.rings});return g});
   const trees=[];for(let i=0;i<d.trees.length;i+=2)trees.push([ox+d.trees[i]/10,oy+d.trees[i+1]/10]);
   const parcels=d.parcels.map(([id,label,area,polys])=>{const rd={type:'MultiPolygon',coordinates:polys.map(p=>p.map(ring))};return{id,label,area,rdBbox:bboxOf(rd),rd,_wgs:null}});
   return{buildings,ground,trees,parcels};
  }).catch(e=>{tileCache.delete(k);throw e}));
  if(tileCache.size>40)tileCache.delete(tileCache.keys().next().value);
  return tileCache.get(k);
 }
 async function bundledModel(ext){
  const pad=[ext[0]-300,ext[1]-300,ext[2]+300,ext[3]+300],{keys,missing}=tileKeys(pad),t=tileIndex();
  const tiles=await Promise.all(keys.map(loadTile)),m={extent:ext,source:'sample',partial:!keys.length||missing>0&&tileKeys(ext).missing>0,fetched:t?.fetched,buildings:[],ground:[],trees:[]};
  for(const d of tiles){for(const b of d.buildings)if(overlaps(b.bbox,ext))m.buildings.push(b);for(const g of d.ground)if(overlaps(g.bbox,ext))m.ground.push(g);
   for(const p of d.trees)if(p[0]>=ext[0]&&p[0]<=ext[2]&&p[1]>=ext[1]&&p[1]<=ext[3])m.trees.push(p)}
  return m;
 }
 async function bundledParcels(b){
  const c=[geo.toRd(b[0],b[1]),geo.toRd(b[2],b[3]),geo.toRd(b[0],b[3]),geo.toRd(b[2],b[1])],ext=[Math.min(...c.map(p=>p[0])),Math.min(...c.map(p=>p[1])),Math.max(...c.map(p=>p[0])),Math.max(...c.map(p=>p[1]))];
  const {keys}=tileKeys(ext);if(keys.length>9)return[];
  const out=[];for(const d of await Promise.all(keys.map(loadTile)))for(const p of d.parcels)if(overlaps(p.rdBbox,ext)){if(!p._wgs)p._wgs=toWgsGeom(p.rd);out.push({id:p.id,label:p.label,area:p.area,geometry:p._wgs})}
  return out;
 }

 // ---- boundaries ---------------------------------------------------------------
 async function gemeente(){
  try{const d=await getJSON(qs(`${CBS}/gemeenten/items`,{f:'json',gm_code:GM,water:'NEE',limit:5}),{timeout:9000});const f=d.features[0];return{name:f.properties.gm_naam,code:GM,geometry:f.geometry,source:'live'}}
  catch{const s=decode();return s?{...s.gemeente,source:'sample'}:null}
 }
 async function buurten(){
  try{
   const w=await getJSON(qs(`${CBS}/wijken/items`,{f:'json',gm_code:GM,limit:100}),{timeout:9000});
   const lists=await Promise.all(w.features.map(f=>getJSON(qs(`${CBS}/buurten/items`,{f:'json',wk_code:f.properties.wk_code,limit:200}))));
   return{source:'live',list:lists.flatMap(d=>d.features).map(f=>({code:f.properties.bu_code,name:f.properties.bu_naam,wijk:f.properties.wk_naam,water:f.properties.water,geometry:f.geometry}))};
  }catch{const s=decode();return{source:'sample',list:s?s.buurten:[]}}
 }
 async function parcels(b,signal){
  try{
   const fs=await paged(qs(BRK,{f:'json',limit:1000,bbox:b.join(',')}),{signal},5);
   return{source:'live',list:fs.map(f=>{const p=f.properties;return{id:p.identificatie_lokaal_id,label:[p.akr_kadastrale_gemeente_code_waarde,p.sectie,p.perceelnummer].filter(v=>v!=null).join(' '),area:p.kadastrale_grootte_waarde,geometry:f.geometry}})};
  }catch(e){if(signal?.aborted)throw e;try{return{source:'sample',list:await bundledParcels(b)}}catch{return{source:'sample',list:[]}}}
 }

 // ---- 3DBAG (CityJSON features) -> LoD1.3 block parts --------------------------
 function parse3dbag(page){
  if(!page?.features?.length||!page.metadata?.transform)return[];
  const {scale:sc,translate:tr}=page.metadata.transform,out=[];
  for(const f of page.features||[]){
   const V=f.vertices.map(v=>[v[0]*sc[0]+tr[0],v[1]*sc[1]+tr[1],v[2]*sc[2]+tr[2]]),objs=f.CityObjects;
   const b=Object.values(objs).find(o=>o.type==='Building');if(!b)continue;
   const a=b.attributes||{};if(['Pand gesloopt','Niet gerealiseerd pand','Bouwvergunning verleend'].includes(a.status))continue;
   const z0=a.b3_h_maaiveld||0,parts=[];
   for(const cid of b.children||[]){
    const o=objs[cid],gs=o?.geometry||[],g=gs.find(x=>String(x.lod)==='1.3')||gs.find(x=>String(x.lod)==='1.2');if(!g)continue;
    const surf=g.semantics.surfaces,vals=g.semantics.values[0];
    g.boundaries[0].forEach((s,i)=>{if(vals[i]==null||surf[vals[i]].type!=='RoofSurface')return;const outer=s[0].map(k=>V[k]);
     const h=Math.round((outer.reduce((t,p)=>t+p[2],0)/outer.length-z0)*10)/10;if(h<1)return;
     parts.push({h,rings:s.map(r=>r.map(k=>[V[k][0],V[k][1]]))})});
   }
   const h70=Math.round(((a.b3_h_dak_70p||0)-z0)*10)/10;
   if(!parts.length){const l0=(b.geometry||[]).find(x=>String(x.lod)==='0');if(l0&&h70>1)parts.push({h:h70,rings:l0.boundaries[0].map(r=>r.map(k=>[V[k][0],V[k][1]]))})}
   if(parts.length)out.push({id:f.id,h:h70,year:a.oorspronkelijkbouwjaar,parts});
  }
  return out;
 }
 function bgtKind(c,p){
  if(c==='wegdeel')return'road';if(c==='ondersteunendwegdeel')return p.fysiek_voorkomen==='groenvoorziening'?'green':'road';
  if(c==='waterdeel')return'water';if(c==='ondersteunendwaterdeel')return'green';
  if(c==='begroeidterreindeel')return['heesters','bosplantsoen'].includes(p.plus_fysiek_voorkomen)?'hedge':'green';
 }
 async function liveModel(ext,progress,signal){
  const bbox=ext.map(v=>Math.round(v)).join(','),now=new Date().toISOString().replace(/\.\d+Z$/,'Z');
  let done=0,total=BGT_COLLS.length+1;const tick=()=>progress?.(++done,total);
  const bgtJob=Promise.all(BGT_COLLS.map(c=>paged(qs(`${BGT}/${c}/items`,{f:'json',limit:1000,bbox,'bbox-crs':RD,crs:RD,datetime:now}),{signal}).then(fs=>{tick();return[c,fs]})));
  bgtJob.catch(()=>{});
  const first=await getJSON(qs(BAG3D,{bbox,limit:50}),{signal});
  const offsets=[];for(let o=51;o<=(first.numberMatched||0);o+=50)offsets.push(o);total+=offsets.length;tick();
  const pages=[first].concat(await pool(offsets,6,o=>getJSON(qs(BAG3D,{bbox,limit:50,offset:o}),{signal}).then(d=>{tick();return d})));
  const seen=new Set(),buildings=[];for(const p of pages)for(const b of parse3dbag(p))if(!seen.has(b.id)){seen.add(b.id);buildings.push(b)}
  const ground=[],trees=[];
  for(const[c,fs]of await bgtJob)for(const f of fs){const p=f.properties||{};if(p.eind_registratie||+(p.relatieve_hoogteligging||0)<0||!f.geometry)continue;
   if(c==='vegetatieobject_punt'){if(p.plus_type==='boom')trees.push(f.geometry.coordinates.slice(0,2));continue}
   for(const poly of polys(f.geometry))ground.push({kind:bgtKind(c,p),rings:poly.map(r=>r.slice(0,-1).map(q=>[q[0],q[1]]))});
  }
  return{extent:ext,source:'live',partial:false,buildings,ground,trees};
 }
 async function model(ext,progress,signal){
  if((ext[2]-ext[0])*(ext[3]-ext[1])>MAX_AREA)throw new Error('tooLarge');
  try{return await liveModel(ext,progress,signal)}catch(e){if(signal?.aborted)throw e;try{return await bundledModel(ext)}catch{return{extent:ext,source:'none',partial:true,buildings:[],ground:[],trees:[]}}}
 }
 return{gemeente,buurten,parcels,model,decode,contains,bboxOf,area,centroid,toRdGeom,toWgsGeom,polys,overlaps,MAX_AREA,get online(){return online},set online(v){online=v},geo};
})();
