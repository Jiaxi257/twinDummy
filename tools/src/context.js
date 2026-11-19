// Converts a loaded site model (RD metres) into the editor's grid coordinates (5 m cells, x east, y south).
// The 20 × 20 design grid is centred on the selection; the surrounding context covers a 200 × 200 m window (-10…30 cells).
const NSContext=(()=>{
 'use strict';
 const CELL=5,LO=-10,HI=30;
 function clip(ring,lo=LO,hi=HI){ // Sutherland–Hodgman against a square window
  let out=ring;
  for(const [axis,limit,keepAbove] of [[0,lo,true],[0,hi,false],[1,lo,true],[1,hi,false]]){
   const input=out;out=[];if(!input.length)break;
   const inside=p=>keepAbove?p[axis]>=limit:p[axis]<=limit;
   for(let i=0;i<input.length;i++){
    const a=input[i],b=input[(i+1)%input.length],ia=inside(a),ib=inside(b);
    if(ia)out.push(a);
    if(ia!==ib){const t=(limit-a[axis])/(b[axis]-a[axis]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])}
   }
  }
  return out.length>2?out:null;
 }
 const r2=v=>Math.round(v*1000)/1000;
 function apply(detail){
  const ctx=[],ground=[],trees=[];
  const [cx,cy]=detail.rd.center,x0=Math.round(cx-50),y0=Math.round(cy+50);
  const toGrid=([x,y])=>[r2((x-x0)/CELL),r2((y0-y)/CELL)];
  const inGrid=([x,y])=>x>=0&&x<=20&&y>=0&&y<=20;
  const m=detail.model;
  if(m){
   for(const b of m.buildings){
    const gp=b.parts.map(p=>({h:p.h,ring:p.rings[0].map(toGrid)}));
    const all=gp.flatMap(p=>p.ring),c=[all.reduce((s,p)=>s+p[0],0)/all.length,all.reduce((s,p)=>s+p[1],0)/all.length];
    if(inGrid(c))continue; // existing buildings inside the design window are left out of the context
    for(const p of gp){const ring=clip(p.ring);if(ring)ctx.push({id:b.id,ring,height:p.h})}
   }
   for(const g of m.ground){const rings=g.rings.map(r=>clip(r.map(toGrid))).filter(Boolean);if(rings.length)ground.push({kind:g.kind,rings})}
   for(const t of m.trees){const p=toGrid(t);if(p[0]>LO&&p[0]<HI&&p[1]>LO&&p[1]<HI&&!inGrid(p))trees.push(p)}
  }
  // BRK parcels: locked outlines in grid coordinates, clipped to the design grid
  const parcels=[];
  for(const p of detail.parcels||[])for(const poly of NSData.polys(p.geometry)){const ring=clip(poly[0].map(([lon,lat])=>toGrid(NSData.geo.toRd(lon,lat))),0,20);if(ring&&ring.length>2)parcels.push({id:String(p.id),label:p.label||'',area:p.area??null,ring:ring.map(q=>[r2(q[0]),r2(q[1])])})}
  SITE_DATA.context=ctx;SITE_DATA.origin=[x0,y0];SITE_DATA.parcels=parcels;
  LANDSCAPE_DATA.ground=ground;LANDSCAPE_DATA.trees=trees;LANDSCAPE_DATA.bbox=[x0-50,y0-150,x0+150,y0+50];
  LANDSCAPE_DATA.source=m?(m.source==='live'?'PDOK BGT / 3DBAG (live)':'PDOK BGT / 3DBAG (bundled snapshot '+(m.fetched||'')+')'):'none';
  return {origin:[x0,y0],buildings:ctx.length,ground:ground.length,trees:trees.length};
 }
 // Cells whose centre lies inside the selected polygon become built-up (1); the rest stay unassigned (0).
 function mask(detail,cells){
  const [cx,cy]=detail.rd.center,x0=Math.round(cx-50),y0=Math.round(cy+50);
  for(let r=0;r<20;r++)for(let c=0;c<20;c++)cells[r*20+c]=NSData.contains(detail.rd.geometry,x0+c*CELL+2.5,y0-r*CELL-2.5)?1:0;
 }
 // Existing site: BGT road / plant / water become grid cells (and so road, plant and water entities); 3DBAG buildings and
 // BGT trees inside the site become editable objects that keep their real footprint and position. Returns a validated model.
 const KIND_CODE={road:2,green:3,hedge:3,water:4};
 function existing(detail){
  const G=GridModel,m=G.blank(),[cx,cy]=detail.rd.center,x0=Math.round(cx-50),y0=Math.round(cy+50);
  const toGrid=([x,y])=>[r2((x-x0)/CELL),r2((y0-y)/CELL)],inSite=(gx,gy)=>NSData.contains(detail.rd.geometry,x0+gx*CELL,y0-gy*CELL);
  const ground=LANDSCAPE_DATA.ground.map(g=>({code:KIND_CODE[g.kind],rings:g.rings,b:g.rings[0].reduce((a,[x,y])=>[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)],[Infinity,Infinity,-Infinity,-Infinity])}));
  const S=4;
  for(let r=0;r<20;r++)for(let c=0;c<20;c++){
   if(!inSite(c+.5,r+.5))continue;
   const votes={2:0,3:0,4:0};
   for(let i=0;i<S;i++)for(let j=0;j<S;j++){const x=c+(i+.5)/S,y=r+(j+.5)/S;
    for(const g of ground){if(x<g.b[0]||x>g.b[2]||y<g.b[1]||y>g.b[3])continue;if(G.inRing(x,y,g.rings[0])&&!g.rings.slice(1).some(h=>G.inRing(x,y,h))){votes[g.code]++;break}}}
   const best=[2,3,4].sort((a,b)=>votes[b]-votes[a])[0];
   m.cells[r*20+c]=votes[best]*2>=S*S?best:1; // mostly road / green / water, otherwise built-up land
  }
  const stats={buildings:0,trees:0,skippedTrees:0};
  const buildings=[];
  for(const b of detail.model?.buildings||[]){
   const parts=b.parts.map(p=>({h:p.h,ring:p.rings[0].map(toGrid)}));
   const pts=parts.flatMap(p=>p.ring),gx=pts.reduce((s,p)=>s+p[0],0)/pts.length,gy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
   if(gx<0||gy<0||gx>20||gy>20||!inSite(gx,gy))continue;
   const ox=Math.min(...pts.map(p=>p[0])),oy=Math.min(...pts.map(p=>p[1])),h=Math.max(3,Math.min(60,Math.round((b.h||Math.max(...parts.map(p=>p.h)))*10)/10));
   buildings.push({id:'B'+String(buildings.length+1).padStart(3,'0'),type:'building',shape:'footprint',x:r2(ox),y:r2(oy),parts:parts.map(p=>({h:p.h,ring:p.ring.map(([x,y])=>[r2(x-ox),r2(y-oy)])})),
    height:h,storeys:Math.max(1,Math.min(20,Math.round(h/3))),use:'residential',roof:'lightroof',facade:'brick',sourceId:b.id,floorBasis:'estimated',useBasis:'assumed',year:b.year??null});
  }
  // cells under a footprint are built-up land, so roads / plant cover never run underneath a building
  for(const b of buildings)for(const i of G.cellsFor(b))m.cells[i]=1;
  G.syncGround(m);
  m.entities.push(...buildings);stats.buildings=buildings.length;
  let n=0;
  for(const t of detail.model?.trees||[]){
   const [x,y]=toGrid(t);if(x<=0||y<=0||x>=20||y>=20||!inSite(x,y))continue;
   const e={id:'T'+String(++n).padStart(3,'0'),type:'tree',x,y,anchor:'free',radius:2.4,height:6,species:'deciduous',basis:'BGT'};
   if(m.entities.length>=500||G.placementError(m,e)){stats.skippedTrees++;n--;continue}
   m.entities.push(e);stats.trees++;
  }
  m.parcels=SITE_DATA.parcels;
  G.validate(m);
  return{model:m,stats};
 }
 return{apply,mask,existing};
})();
