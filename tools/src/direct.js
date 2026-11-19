// Direct manipulation shares the same validation and undo history as the inspector.
(() => {
 const scene = document.querySelector('#scene');
 const dialog = document.querySelector('#entityDialog');
 const form = dialog.querySelector('form');
 let drag = null;
 let lastTap = null;
 let editingId = null;
 const direct = () => ['inspect','select'].includes(tool);
 const input = (name,label,value,min,max,step=1) =>
   `<label><span class="label">${t(label)}</span><input required name="${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
 const choice = (name,label,values,value) =>
   `<label><span class="label">${t(label)}</span><select name="${name}">${options(values,value)}</select></label>`;
 function edit(id) {
   const e = model.entities.find(item => item.id === id);
   if (!e || dialog.open) return;
   editingId = e.id;
   selection = e.id;
   const fields = [];
   if(e.type==='building'){
     fields.push(choice('use','function',G.USES,e.use),input('storeys','storeys',e.storeys,1,20),
       input('height','height',e.height,3,60,.1),choice('roof','roof',G.ROOF,e.roof),
       choice('facade','facade',G.FACADE,e.facade));
   }else if(e.type==='tree'){
     fields.push(choice('species','treeType',G.TREES,e.species),input('height','treeHeight',e.height,2,20,.5),
       input('radius','radius',e.radius,1,8,.5));
   }else{
     if(e.type==='road')fields.push(choice('material','material',G.GROUND,e.material));
     if(e.type==='plant')fields.push(choice('plantType','plantType',G.PLANTS,e.plantType));
     fields.push(input('w','columns',e.w,1,model.grid.columns),input('d','rows',e.d,1,model.grid.rows));
   }
   dialog.querySelector('h2').textContent=t(e.type)+' · '+e.id;
   dialog.querySelector('.entity-fields').innerHTML=fields.join('');
   dialog.querySelector('.edit-error').textContent='';
   render();
   dialog.showModal();
 }
 form.onsubmit = ev => {
   ev.preventDefault();
   const e=model.entities.find(item=>item.id===editingId);
   if(!e)return;
   const props={};
   for(const el of form.querySelectorAll('[name]'))props[el.name]=el.type==='number'?el.valueAsNumber:el.value;
   if('w' in props)Object.assign(props,{x:e.x,y:e.y});
   const error=G.placementError(model,{...e,...props},'x' in props);
   if(error){dialog.querySelector('.edit-error').textContent=t(error);return}
   if(change(()=>G.patch(model,e.id,props),'updated'))dialog.close();
 };
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
 function destination(ev) {
   const [x,y]=point(ev);
   return {x:drag.e.x+Math.round(x-drag.start[0]),y:drag.e.y+Math.round(y-drag.start[1])};
 }
 function clearDrag() {
   if(!drag)return;
   const pointer=drag.pointer;
   drag=null;
   scene.classList.remove('dragging');
   if(scene.hasPointerCapture(pointer))scene.releasePointerCapture(pointer);
   scene.querySelector('#ghost').replaceChildren();
 }
 scene.addEventListener('pointerdown',ev=>{
   const id=pickEvent(ev);
   if(!id||!direct()||ev.button!==0||!ev.isPrimary)return;
   const e=model.entities.find(item=>item.id===id);
   if(!e)return;
   ev.stopImmediatePropagation();
   drag={e,polys:hitPolysFor(e.id),pointer:ev.pointerId,start:point(ev),client:[ev.clientX,ev.clientY],moved:false};
   scene.setPointerCapture(ev.pointerId);
 },true);
 scene.addEventListener('pointermove',ev=>{
   if(!drag||ev.pointerId!==drag.pointer)return;
   ev.stopImmediatePropagation();
   if(Math.hypot(ev.clientX-drag.client[0],ev.clientY-drag.client[1])<4&&!drag.moved)return;
   drag.moved=true;
   scene.classList.add('dragging');
   const pos=destination(ev),next={...drag.e,...pos},err=G.placementError(model,next,true);
   const a=project(drag.e.x,drag.e.y),b=project(pos.x,pos.y),ghost=scene.querySelector('#ghost');
   const stroke=err?'#ad4c38':'#216749',dx=b[0]-a[0],dy=b[1]-a[1];
   ghost.innerHTML=`<g opacity=".8">${drag.polys.map(p=>`<polygon points="${p.map(q=>(q[0]+dx)+','+(q[1]+dy)).join(' ')}" fill="${err?'#e3b3a3':'#cfe0c4'}" fill-opacity=".55" stroke="${stroke}" stroke-width="1.4"/>`).join('')}</g>`;
 },true);
 scene.addEventListener('pointerup',ev=>{
   if(!drag||ev.pointerId!==drag.pointer)return;
   ev.stopImmediatePropagation();
   const {e,moved}=drag,pos=destination(ev);
   clearDrag();
   selection=e.id;
   if(moved){
     lastTap=null;
     if(pos.x!==e.x||pos.y!==e.y)change(()=>G.patch(model,e.id,pos),'moved');
     else render();
     return;
   }
   const now=performance.now();
   if(lastTap&&lastTap.id===e.id&&now-lastTap.time<470&&Math.hypot(ev.clientX-lastTap.x,ev.clientY-lastTap.y)<9){
     lastTap=null;edit(e.id);
   }else{
     lastTap={id:e.id,time:now,x:ev.clientX,y:ev.clientY};render();
   }
 },true);
 scene.addEventListener('dblclick',ev=>{
   const id=pickEvent(ev);
   if(id&&direct()){ev.preventDefault();edit(id)}
 });
 scene.addEventListener('pointercancel',clearDrag);
 scene.addEventListener('lostpointercapture',clearDrag);
 document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&drag){clearDrag();ev.stopImmediatePropagation()}},true);
})();