// RD New (EPSG:28992) <-> WGS84, Schreutelkamp & Strang van Hees polynomial (sub-metre within NL).
const RDGEO=(()=>{
 const X0=155000,Y0=463000,PHI0=52.15517440,LAM0=5.38720621;
 const K=[[0,1,3235.65389],[2,0,-32.58297],[0,2,-0.2475],[2,1,-0.84978],[0,3,-0.0665],[2,2,-0.01709],[1,0,-0.00738],[4,0,0.0053],[2,3,-3.9e-4],[4,1,3.3e-4],[1,1,-1.2e-4]];
 const L=[[1,0,5260.52916],[1,1,105.94684],[1,2,2.45656],[3,0,-0.81885],[1,3,0.05594],[3,1,-0.05607],[0,1,0.01199],[3,2,-0.00256],[1,4,0.00128],[0,2,2.2e-4],[2,0,-2.2e-4],[5,0,2.6e-4]];
 const R=[[0,1,190094.945],[1,1,-11832.228],[2,1,-114.221],[0,3,-32.391],[1,0,-0.705],[3,1,-2.34],[1,3,-0.608],[0,2,-0.008],[2,3,0.148]];
 const S=[[1,0,309056.544],[0,2,3638.893],[2,0,73.077],[1,2,-157.984],[3,0,59.788],[0,1,0.433],[2,2,-6.439],[1,1,-0.032],[0,4,0.092],[1,4,-0.054]];
 function toWgs(x,y){const dx=(x-X0)*1e-5,dy=(y-Y0)*1e-5;let p=0,l=0;for(const[a,b,c]of K)p+=c*dx**a*dy**b;for(const[a,b,c]of L)l+=c*dx**a*dy**b;return[LAM0+l/3600,PHI0+p/3600]}
 function toRd(lon,lat){const dp=0.36*(lat-PHI0),dl=0.36*(lon-LAM0);let x=X0,y=Y0;for(const[a,b,c]of R)x+=c*dp**a*dl**b;for(const[a,b,c]of S)y+=c*dp**a*dl**b;return[x,y]}
 return{toWgs,toRd};
})();
if(typeof module!=='undefined')module.exports=RDGEO;
