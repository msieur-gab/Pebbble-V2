/* pebble-covers.mjs — deterministic linocut pebble covers, v16 render core.
 *
 * Pure functions, no DOM, no dependencies. Same math as the studio tool
 * (pebble-signatures-v16.html): tune there, paste settings here.
 *
 *   import { pebbleCover, pebbleDataURI } from "./pebble-covers.mjs";
 *
 *   el.innerHTML = pebbleCover(playlist.id);                   // inline <svg>
 *   img.src      = pebbleDataURI(playlist.id, { detail: "thumb" });
 *
 * Same seed -> same stone, forever, on every device. No image storage.
 */

/* ---------- RNG + noise ---------- */
function xmur3(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=(h<<13)|(h>>>19);}return function(){h=Math.imul(h^(h>>>16),2246822507);h=Math.imul(h^(h>>>13),3266489909);h^=h>>>16;return h>>>0;};}
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rng=seed=>mulberry32(xmur3(String(seed))());
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const f1=v=>Math.round(v*10)/10;
const _fr=v=>v-Math.floor(v);
const _vh=(x,y,s)=>_fr(Math.sin(x*127.1+y*311.7+s*0.719)*43758.5453)*2-1;
function _vn(x,y,s){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);const a=_vh(ix,iy,s),b=_vh(ix+1,iy,s),c=_vh(ix,iy+1,s),d=_vh(ix+1,iy+1,s);return(a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;}

/* ---------- shape ---------- */
function shapePoints(rand,count){const K=3,cap=[0.24,0.17,0.12],am=[],ph=[];for(let k=0;k<K;k++){am.push(cap[k]*(0.35+rand()*0.65));ph.push(rand()*Math.PI*2);}const asp=0.74+rand()*0.44,rot=rand()*Math.PI*2,p=[];for(let i=0;i<count;i++){const th=(i/count)*Math.PI*2;let r=1;for(let k=0;k<K;k++)r+=am[k]*Math.cos((k+1)*th+ph[k]);const x=Math.cos(th)*r,y=Math.sin(th)*r*asp;p.push({x:x*Math.cos(rot)-y*Math.sin(rot),y:x*Math.sin(rot)+y*Math.cos(rot)});}return p;}
function fitPoints(pts,size,pad){let a=1e9,b=1e9,c=-1e9,d=-1e9;for(const q of pts){if(q.x<a)a=q.x;if(q.x>c)c=q.x;if(q.y<b)b=q.y;if(q.y>d)d=q.y;}const w=c-a,h=d-b,av=size-pad*2,s=av/Math.max(w,h),ox=pad+(av-w*s)/2-a*s,oy=pad+(av-h*s)/2-b*s;return pts.map(q=>({x:q.x*s+ox,y:q.y*s+oy}));}
function pathD(pts){const n=pts.length,p=i=>pts[((i%n)+n)%n];let d="M"+f1(p(0).x)+" "+f1(p(0).y);for(let i=0;i<n;i++){const p0=p(i-1),p1=p(i),p2=p(i+1),p3=p(i+2);d+="C"+f1(p1.x+(p2.x-p0.x)/6)+" "+f1(p1.y+(p2.y-p0.y)/6)+" "+f1(p2.x-(p3.x-p1.x)/6)+" "+f1(p2.y-(p3.y-p1.y)/6)+" "+f1(p2.x)+" "+f1(p2.y);}return d+"Z";}
function pointInPoly(x,y,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;}return inside;}
function distToPoly(x,y,pts){let m=1e18;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const ax=pts[j].x,ay=pts[j].y,bx=pts[i].x,by=pts[i].y;const dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy||1;let t=((x-ax)*dx+(y-ay)*dy)/L2;t=clamp(t,0,1);const px=ax+dx*t-x,py=ay+dy*t-y;const d2=px*px+py*py;if(d2<m)m=d2;}return Math.sqrt(m);}
const edgePt=(cx,cy,a,R)=>({x:cx+Math.cos(a)*R,y:cy+Math.sin(a)*R});

/* ---------- veins ---------- */
function veinCenterline(A,B,rand,size,wav,offset,bow){
  const dx=B.x-A.x,dy=B.y-A.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const nseed=rand()*1000,amp=size*(0.02+wav*0.14),M=44,pts=[];
  for(let i=0;i<M;i++){
    const t=i/(M-1);
    const wob=_vn(t*(1.3+wav*1.7),nseed*0.1,nseed)*amp;
    const arc=(bow||0)*Math.sin(Math.PI*t);
    const o=offset+arc+wob*(0.35+0.65*Math.sin(Math.PI*t));
    pts.push({x:A.x+dx*t+nx*o,y:A.y+dy*t+ny*o});
  }
  return pts;
}
const pointOn=(pts,u)=>pts[clamp(Math.round(u*(pts.length-1)),0,pts.length-1)];
function ribbonD(pts,wStart,wEnd,taperStart,taperEnd,nseed){
  const N=pts.length,left=[],right=[];
  for(let i=0;i<N;i++){
    const t=i/(N-1),a=pts[Math.max(0,i-1)],b=pts[Math.min(N-1,i+1)];
    let tx=b.x-a.x,ty=b.y-a.y;const tl=Math.hypot(tx,ty)||1;const nx=-ty/tl,ny=tx/tl;
    const wn=0.55*(_vn(t*6,nseed*0.1+3,nseed)*0.5+0.5)+0.45*(_vn(t*17,nseed*0.1+5,nseed)*0.5+0.5);
    let w=lerp(wStart,wEnd,t)*(0.5+1.0*wn);
    if(taperStart)w*=clamp(t/0.10,0.12,1);
    if(taperEnd)w*=clamp((1-t)/0.10,0.05,1);
    const j=_vn(t*34,nseed*0.1+8,nseed)*w*0.18;
    left.push({x:pts[i].x+nx*(w/2+j),y:pts[i].y+ny*(w/2+j)});
    right.push({x:pts[i].x-nx*(w/2-j),y:pts[i].y-ny*(w/2-j)});
  }
  let d="M"+f1(left[0].x)+" "+f1(left[0].y);
  for(let i=1;i<N;i++)d+="L"+f1(left[i].x)+" "+f1(left[i].y);
  for(let i=N-1;i>=0;i--)d+="L"+f1(right[i].x)+" "+f1(right[i].y);
  return d+"Z";
}
function veinsMarkup(size,rand,P){
  const cx=size/2,cy=size/2,Rr=size*0.66;
  const nB=rand()<0.14?0:(rand()<0.83?1:2);
  let out="";
  for(let b=0;b<nB;b++){
    const a0=rand()*Math.PI*2,a1=a0+Math.PI+(rand()-0.5)*0.7;
    const E1=edgePt(cx,cy,a0,Rr),E2=edgePt(cx,cy,a1,Rr);
    const side=rand()<0.5?1:-1;
    const bundleOff=side*size*(0.06+rand()*0.16);
    const bow=side*size*(0.015+rand()*0.11)*(rand()<0.78?1:-1);
    const mainW=size*(0.009+rand()*0.007)*(0.5+P.veinWeight*1.15);
    const main=veinCenterline(E1,E2,rand,size,P.wav,bundleOff,bow);
    out+='<path d="'+ribbonD(main,mainW*0.82,mainW,false,false,rand()*1000)+'"/>';
    const nT=1+Math.floor(rand()*(0.4+P.veinAmount*2.6));
    for(let t=0;t<nT;t++){
      const tside=rand()<0.5?1:-1;
      const startAng=a0+(rand()-0.5)*0.5;
      const S=edgePt(cx,cy,startAng,Rr);
      const u=0.3+rand()*0.5;
      const Cp=pointOn(main,u);
      const off=tside*size*(0.012+rand()*0.03);
      const trib=veinCenterline(S,Cp,rand,size,P.wav,off,bow*0.5);
      const tw=mainW*(0.28+rand()*0.42);
      out+='<path d="'+ribbonD(trib,tw*0.5,tw*0.15,true,true,rand()*1000)+'"/>';
    }
  }
  return out;
}

/* ---------- grain: jittered grid of stroked marks ---------- */
function grainMarkup(size,Gr,Lr,P,poly,GRID){
  const cell=size/GRID,pad=size*0.12;
  const mk=size/52;  // mark scale is anchored to the stone, NOT the grid:
                     // lower-detail grids give fewer marks, never fatter ones
  const pseed=Lr()*200,fine=0.55+P.grain*0.8;
  const baseLvl=0.10+P.grain*0.42,patchLvl=P.coverage*0.9;
  const wLv=[0.14,0.22,0.32].map(w=>f1(Math.max(0.2,mk*w*fine)));
  const opLv=[0.60,0.74,0.88];
  const buckets={};
  let count=0;
  for(let gy=0;gy<GRID;gy++){
    for(let gx=0;gx<GRID;gx++){
      const jx=Gr(),jy=Gr(),g=Gr(),sz=Gr();
      const x=(gx+jx)*cell,y=(gy+jy)*cell;
      if(x<pad*0.4||y<pad*0.4||x>size-pad*0.4||y>size-pad*0.4)continue;
      if(!pointInPoly(x,y,poly))continue;
      const t=clamp(distToPoly(x,y,poly)/(size*0.10),0,1);
      const interior=t*t*(3-2*t);
      const ee=Math.pow(interior,1.7);
      if(ee<=0.02)continue;
      const nv=_vn(x/size*3.1+pseed,y/size*3.1+pseed*0.7,pseed)*0.5+0.5;
      const nv2=_vn(x/size*7.0,y/size*7.0,pseed+11)*0.5+0.5;
      const patch=clamp((nv*0.7+nv2*0.3-0.42)/0.40,0,1);
      if(g<(baseLvl+patch*patchLvl)*ee){
        const ang=_vn(x/size*2.2+pseed*0.31,y/size*2.2,pseed+29)*Math.PI
                 +_vn(x/size*9.0,y/size*9.0,pseed+53)*0.5;
        const L=mk*(0.04+P.mark*(0.5+sz*1.3)*(1+patch*0.5));
        const hx=Math.cos(ang)*L/2,hy=Math.sin(ang)*L/2;
        const wi=sz<0.33?0:(sz<0.72?1:2);
        const a=0.55+sz*0.22+patch*0.14;
        const oi=a<0.66?0:(a<0.78?1:2);
        const key=wi+"_"+oi;
        (buckets[key]||(buckets[key]=[])).push("M"+f1(x-hx)+" "+f1(y-hy)+"l"+f1(2*hx)+" "+f1(2*hy));
        count++;
      }
    }
  }
  let out="";
  for(const key in buckets){
    const[wi,oi]=key.split("_").map(Number);
    out+='<path fill="none" stroke="#000" stroke-linecap="round" stroke-width="'+wLv[wi]+'" stroke-opacity="'+opLv[oi]+'" d="'+buckets[key].join("")+'"/>';
  }
  return{markup:out,count};
}

/* ---------- public API ---------- */

/** Studio-tuned defaults (Gab, 2026-07) — override via opts.settings. */
export const DEFAULT_SETTINGS=Object.freeze({grain:0.6,coverage:0.6,mark:0.3,veinAmount:0.8,wav:0.6,veinWeight:1});

/** Grain grid per level of detail. "flat" skips grain entirely (shape + veins only). */
const DETAIL_GRID={full:52,thumb:26,flat:0};

/**
 * Build one pebble cover as a standalone SVG string (transparent background).
 *
 * @param {string} seed - playlist id/name; same seed always yields the same stone
 * @param {object} [opts]
 * @param {"full"|"thumb"|"flat"} [opts.detail="full"] - grain level of detail;
 *        shape and veins are identical across levels (independent RNG streams),
 *        so a "thumb" is recognizably the same stone as its "full" cover
 * @param {string} [opts.ink="#18160f"] - ink color
 * @param {number} [opts.size=480] - internal coordinate space; the render is
 *        scale-invariant, so this only affects coordinate precision. Display
 *        size is up to CSS / the viewBox.
 * @param {object} [opts.settings=DEFAULT_SETTINGS] - studio tuning values
 * @returns {string} SVG markup
 */
export function pebbleCover(seed,opts={}){
  const{detail="full",ink="#18160f",size=480,settings=DEFAULT_SETTINGS}=opts;
  const P={...DEFAULT_SETTINGS,...settings};
  const R=rng(seed+"::shape"),Gr=rng(seed+"::grain"),V=rng(seed+"::vein"),Lr=rng(seed+"::light");
  const poly=fitPoints(shapePoints(R,60),size,size*0.12);
  const d=pathD(poly);
  const GRID=DETAIL_GRID[detail]??DETAIL_GRID.full;
  const grain=GRID>0?grainMarkup(size,Gr,Lr,P,poly,GRID):{markup:"",count:0};
  const veins=veinsMarkup(size,V,P);
  const uid="m"+xmur3(seed+"|"+size+"|"+detail+"|"+ink+"|"+JSON.stringify(P))().toString(36);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'">'
    +'<defs><mask id="'+uid+'" maskUnits="userSpaceOnUse" x="0" y="0" width="'+size+'" height="'+size+'">'
    +'<rect width="'+size+'" height="'+size+'" fill="#fff"/>'
    +'<g fill="#000">'+grain.markup+veins+'</g>'
    +'</mask></defs>'
    +'<path d="'+d+'" fill="'+ink+'" mask="url(#'+uid+')"/>'
    +'</svg>';
}

/**
 * Same stone as a data: URI, for <img src> or CSS background-image.
 * Ids are document-scoped inside an <img>, so this is also the safest way to
 * show the same seed many times on one page.
 */
export function pebbleDataURI(seed,opts){
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(pebbleCover(seed,opts));
}
