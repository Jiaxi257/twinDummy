// Converts a loaded site model (RD metres) into the editor's grid coordinates (x east, y south, in cells).
// The grid covers the whole selected site (at least 100 × 100 m); its cell size is chosen per site. The surrounding context
// is drawn in a margin around the grid.
const NSContext=(()=>{
 'use strict';
 const MIN_SPAN=100;
 const r3=v=>Math.round(v*1000)/1000;
 // ---- grid layout ---------------------------------------------------------------------------------------------
 function layout(detail,cell){
  const b=NSData.bboxOf(detail.rd.geometry),cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
  const minx=Math.min(b[0],cx-MIN_SPAN/2),maxx=Math.max(b[2],cx+MIN_SPAN/2),miny=Math.min(b[1],cy-MIN_SPAN/2),maxy=Math.max(b[3],cy+MIN_SPAN/2);
  const x0=Math.floor(minx/cell)*cell,y0=Math.ceil(maxy/cell)*cell;
  const columns=Math.max(1,Math.ceil((maxx-x0)/cell)),rows=Math.max(1,Math.ceil((y0-miny)/cell));
  const margin=Math.max(60,0.12*Math.max(columns,rows)*cell)/cell; // context margin, in cells
  return{x0,y0,cell,columns,rows,margin,width:columns*cell,height:rows*cell};
 }
 // Cell size options for a site: the finest size keeping the grid workable, plus the alternatives.
 function cellOptions(detail){
  return GridModel.CELL_SIZES.filter(s=>s>=5).map(s=>{const L=layout(detail,s);return{cell:s,columns:L.columns,rows:L.rows,cells:L.columns*L.rows,ok:L.columns*L.rows<=GridModel.MAX_CELLS}});
 }
 function autoCell(detail){const o=cellOptions(detail);return(o.find(x=>x.cells<=12000)||o.find(x=>x.ok)||o[o.length-1]).cell}

 function clip(ring,lo,hix,hiy){ // Sutherland–Hodgman against a rectangle
  let out=ring;
  for(const [axis,limit,keepAbove] of [[0,lo[0],true],[0,hix,false],[1,lo[1],true],[1,hiy,false]]){
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
 function centroidOf(rings){let x=0,y=0,n=0;for(const r of rings)for(const p of r){x+=p[0];y+=p[1];n++}return[x/n,y/n]}

 // ---- context: everything around and under the grid that is not part of the design ----------------------------------
 function apply(detail,cell){
  const L=layout(detail,cell),{x0,y0}=L,M=L.margin,lo=[-M,-M],hx=L.columns+M,hy=L.rows+M;
  const toGrid=([x,y])=>[r3((x-x0)/cell),r3((y0-y)/cell)];
  const inSite=(x,y)=>NSData.contains(detail.rd.geometry,x,y); // RD
  const ctx=[],ground=[],trees=[],m=detail.model;
  if(m){
   for(const b of m.buildings){
    const [cx,cy]=centroidOf(b.parts.map(p=>p.rings[0]));
    if(inSite(cx,cy))continue; // buildings inside the site are design material, not context
    for(const p of b.parts){const ring=clip(p.rings[0].map(toGrid),lo,hx,hy);if(ring)ctx.push({id:b.id,ring,height:p.h})}
   }
   for(const g of m.ground){const rings=g.rings.map(r=>clip(r.map(toGrid),lo,hx,hy)).filter(Boolean);if(rings.length)ground.push({kind:g.kind,rings})}
   for(const t of m.trees){if(inSite(t[0],t[1]))continue;const p=toGrid(t);if(p[0]>lo[0]&&p[0]<hx&&p[1]>lo[1]&&p[1]<hy)trees.push(p)}
  }
  const parcels=[];
  for(const p of detail.parcels||[])for(const poly of NSData.polys(p.geometry)){const ring=clip(poly[0].map(([lon,lat])=>toGrid(NSData.geo.toRd(lon,lat))),[0,0],L.columns,L.rows);if(ring)parcels.push({id:String(p.id),label:p.label||'',area:p.area??null,ring:ring.map(q=>[r3(q[0]),r3(q[1])])})}
  const outline=NSData.polys(detail.rd.geometry).map(p=>p[0].map(toGrid));
  SITE_DATA.context=ctx;SITE_DATA.origin=[x0,y0];SITE_DATA.parcels=parcels;SITE_DATA.layout=L;SITE_DATA.outline=outline;
  LANDSCAPE_DATA.ground=ground;LANDSCAPE_DATA.trees=trees;LANDSCAPE_DATA.window=[lo[0],lo[1],hx,hy];
  LANDSCAPE_DATA.source=m?(m.source==='live'?'PDOK BGT / 3DBAG (live)':'PDOK BGT / 3DBAG (bundled snapshot '+(m.fetched||'')+')'):'none';
  return{origin:[x0,y0],cell,columns:L.columns,rows:L.rows,buildings:ctx.length,ground:ground.length,trees:trees.length};
 }
 // Cells whose centre lies inside the selected polygon become built-up (1); the rest stay unassigned (0).
 function mask(detail,model){
  const L=SITE_DATA.layout,{x0,y0,cell,columns:C,rows:R}=L;
  for(let r=0;r<R;r++)for(let c=0;c<C;c++)model.cells[r*C+c]=NSData.contains(detail.rd.geometry,x0+(c+.5)*cell,y0-(r+.5)*cell)?1:0;
 }
 // Existing site: BGT road / plant / water become grid cells (and so road, plant and water entities); 3DBAG buildings and
 // BGT trees inside the site become editable objects that keep their real footprint and position. Returns a validated model.
 const KIND_CODE={road:2,green:3,hedge:3,water:4};
 function existing(detail){
  const G=GridModel,L=SITE_DATA.layout,{x0,y0,cell,columns:C,rows:R}=L,m=G.blank(C,R,cell);
  const toGrid=([x,y])=>[r3((x-x0)/cell),r3((y0-y)/cell)],inSite=(gx,gy)=>NSData.contains(detail.rd.geometry,x0+gx*cell,y0-gy*cell);
  // bucket BGT polygons by cell so each sample only tests nearby polygons
  const buckets=new Map(),B=4; // bucket = 4 × 4 cells
  for(const g of detail.model?.ground||[]){
   const rings=g.rings.map(r=>r.map(toGrid)),bb=rings[0].reduce((a,[x,y])=>[Math.min(a[0],x),Math.min(a[1],y),Math.max(a[2],x),Math.max(a[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
   if(bb[2]<0||bb[3]<0||bb[0]>C||bb[1]>R)continue;const item={code:KIND_CODE[g.kind],rings,bb};
   for(let by=Math.max(0,Math.floor(bb[1]/B));by<=Math.min(Math.floor((R-1)/B),Math.floor(bb[3]/B));by++)for(let bx=Math.max(0,Math.floor(bb[0]/B));bx<=Math.min(Math.floor((C-1)/B),Math.floor(bb[2]/B));bx++){const k=bx+','+by;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(item)}
  }
  const S=cell<=5?4:cell<=10?5:6;
  for(let r=0;r<R;r++)for(let c=0;c<C;c++){
   if(!inSite(c+.5,r+.5))continue;
   const list=buckets.get(Math.floor(c/B)+','+Math.floor(r/B))||[],votes={2:0,3:0,4:0};
   for(let i=0;i<S;i++)for(let j=0;j<S;j++){const x=c+(i+.5)/S,y=r+(j+.5)/S;
    for(const g of list){if(x<g.bb[0]||x>g.bb[2]||y<g.bb[1]||y>g.bb[3])continue;if(G.inRing(x,y,g.rings[0])&&!g.rings.slice(1).some(h=>G.inRing(x,y,h))){votes[g.code]++;break}}}
   const best=[2,3,4].sort((a,b)=>votes[b]-votes[a])[0];
   m.cells[r*C+c]=votes[best]*2>=S*S?best:1; // mostly road / green / water, otherwise built-up land
  }
  const stats={buildings:0,trees:0,skippedTrees:0},buildings=[];
  for(const b of detail.model?.buildings||[]){
   const [rx,ry]=centroidOf(b.parts.map(p=>p.rings[0]));if(!inSite((rx-x0)/cell,(y0-ry)/cell))continue;
   const parts=b.parts.map(p=>({h:p.h,ring:p.rings[0].map(toGrid)})),pts=parts.flatMap(p=>p.ring);
   let ox=Infinity,oy=Infinity;for(const p of pts){if(p[0]<ox)ox=p[0];if(p[1]<oy)oy=p[1]}
   const h=Math.max(3,Math.min(60,Math.round((b.h||Math.max(...parts.map(p=>p.h)))*10)/10));
   buildings.push({id:'B'+String(buildings.length+1).padStart(3,'0'),type:'building',shape:'footprint',x:r3(ox),y:r3(oy),parts:parts.map(p=>({h:p.h,ring:p.ring.map(([x,y])=>[r3(x-ox),r3(y-oy)])})),
    height:h,storeys:Math.max(1,Math.min(20,Math.round(h/3))),use:'residential',roof:'lightroof',facade:'brick',sourceId:b.id,floorBasis:'estimated',useBasis:'assumed',year:b.year??null});
  }
  for(const b of buildings)for(const i of G.cellsFor(b))m.cells[i]=1; // no roads / plant cover underneath a building
  G.syncGround(m);
  m.entities.push(...buildings);stats.buildings=buildings.length;
  // trees: skip those inside a building footprint or on water, or on an anchor that is already taken
  const owner=new Map();for(const e of m.entities)if(e.type==='building'||e.type==='water')for(const i of G.cellsFor(e))owner.set(i,e);
  const anchors=new Set();let n=0;
  for(const t of detail.model?.trees||[]){
   const [x,y]=toGrid(t);if(x<=0||y<=0||x>=C||y>=R||!inSite(x,y))continue;
   const k=x+','+y,cx=Math.floor(x),cy=Math.floor(y);let blocked=anchors.has(k)||m.entities.length>=G.MAX_ENTITIES;
   for(let dy=-1;dy<=1&&!blocked;dy++)for(let dx=-1;dx<=1&&!blocked;dx++){const X=cx+dx,Y=cy+dy;if(X<0||Y<0||X>=C||Y>=R)continue;const o=owner.get(Y*C+X);if(o&&G.treeInside({x,y},o))blocked=true}
   if(blocked){stats.skippedTrees++;continue}
   anchors.add(k);m.entities.push({id:'T'+String(++n).padStart(3,'0'),type:'tree',x,y,anchor:'free',radius:2.4,height:6,species:'deciduous',basis:'BGT'});stats.trees++;
  }
  m.parcels=SITE_DATA.parcels;
  G.validate(m);
  return{model:m,stats};
 }
 return{layout,cellOptions,autoCell,apply,mask,existing};
})();
