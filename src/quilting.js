import { minimumErrorCut } from './seam.js';
export { minimumErrorCut } from './seam.js';

export function seededRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function checkImage(image, name) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 8 || image.height < 8 || image.width > 1024 || image.height > 1024 || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) throw new RangeError(`${name} must be RGBA pixels, 8–1024 pixels per side`);
}

/** Smoothed intensity correspondence, normalized independently to use available tonal range. */
function guide(image) {
  const { width, height, data } = image;
  const raw = new Float32Array(width * height), result = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) raw[i] = (data[i*4]*0.2126 + data[i*4+1]*0.7152 + data[i*4+2]*0.0722) / 255;
  let min = 1, max = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(width-1, Math.max(0, x+dx)), yy = Math.min(height-1, Math.max(0, y+dy));
      sum += raw[yy * width + xx]; count++;
    }
    const value = sum / count;
    result[y * width + x] = value; min = Math.min(min, value); max = Math.max(max, value);
  }
  const range = Math.max(0.001, max-min);
  for (let i = 0; i < result.length; i++) result[i] = (result[i]-min)/range;
  return result;
}

function difference(a, ai, b, bi) {
  const r=a[ai]-b[bi], g=a[ai+1]-b[bi+1], blue=a[ai+2]-b[bi+2];
  return (r*r+g*g+blue*blue)/195075;
}

function candidates(source, patch, count, random) {
  const cols=source.width-patch+1, rows=source.height-patch+1, total=cols*rows;
  // A seeded uniform subset makes browser runtimes bounded. Small sources are searched exhaustively.
  const selected = new Set();
  if (total <= count) for (let i=0;i<total;i++) selected.add(i);
  else while(selected.size < count) selected.add(Math.floor(random()*total));
  return [...selected].map(i=>({x:i%cols,y:Math.floor(i/cols)}));
}

function seamMasks(output, source, x, y, sx, sy, width, height, outputWidth, overlap, blend) {
  let left=null, top=null;
  if (x && blend === 'cut') {
    const w=Math.min(overlap,width), costs=new Float64Array(w*height);
    for(let yy=0;yy<height;yy++) for(let xx=0;xx<w;xx++) costs[yy*w+xx]=difference(output,((y+yy)*outputWidth+x+xx)*4,source.data,((sy+yy)*source.width+sx+xx)*4);
    left=minimumErrorCut(costs,w,height).path;
  }
  if (y && blend === 'cut') {
    const h=Math.min(overlap,height), costs=new Float64Array(h*width);
    // Transpose the horizontal overlap, then use the same exact seam solver.
    for(let xx=0;xx<width;xx++) for(let yy=0;yy<h;yy++) costs[xx*h+yy]=difference(output,((y+yy)*outputWidth+x+xx)*4,source.data,((sy+yy)*source.width+sx+xx)*4);
    top=minimumErrorCut(costs,h,width).path;
  }
  return {left,top};
}

/** Pure, deterministic CPU implementation. Consume in a worker; yields once per placed patch. */
export function* quilt({source, target=null, size=256, patchSize=36, overlap=6, candidateCount=384, tolerance=0.1, structure=0.75, passes=3, seed='1', method='cut'}) {
  checkImage(source,'Source');
  if(target) checkImage(target,'Target');
  const maxSize=target?512:2048, maxPatch=target?96:256;
  if(!Number.isInteger(size)||size<32||size>maxSize) throw new RangeError(`Output size must be 32–${maxSize}`);
  if(!Number.isInteger(patchSize)||patchSize<8||patchSize>Math.min(source.width,source.height,size,maxPatch)) throw new RangeError('Invalid patch size');
  if(!Number.isInteger(overlap)||overlap<1||overlap>=patchSize) throw new RangeError('Overlap must be smaller than the patch');
  if(!Number.isInteger(candidateCount)||candidateCount<1||candidateCount>4096) throw new RangeError('Candidate count must be 1–4096');
  if(!Number.isInteger(passes)||passes<1||passes>5) throw new RangeError('Pass count must be 1–5');
  if(!Number.isFinite(tolerance)||tolerance<0||tolerance>1||!Number.isFinite(structure)||structure<0||structure>1) throw new RangeError('Invalid matching weights');
  if(!['cut','straight','random'].includes(method)) throw new RangeError('Unknown quilting method');
  if(target&&(target.width!==size||target.height!==size)) throw new RangeError('Target must match output dimensions');
  const random=seededRandom(seed), count=target?passes:1;
  const sourceGuide=target?guide(source):null, targetGuide=target?guide(target):null;
  const schedule=Array.from({length:count},(_,i)=>Math.max(8,Math.round(patchSize*(2/3)**i)));
  const overlaps=schedule.map(p=>Math.max(1,Math.min(p-1,Math.round(overlap*p/patchSize))));
  const total=schedule.reduce((sum,p,i)=>sum+Math.ceil((size-p)/(p-overlaps[i])+1)**2,0);
  let data=new Uint8ClampedArray(size*size*4), done=0, lastOwnership;
  for(let pass=0;pass<count;pass++) {
    const previous=pass?data:null;
    data=new Uint8ClampedArray(size*size*4);
    const owners=new Int32Array(size*size).fill(-1);
    const patch=schedule[pass], ov=overlaps[pass], step=patch-ov;
    const pool=candidates(source,patch,candidateCount,random), scores=new Float64Array(pool.length);
    let placement=0;
    // Stop when the prior patch reaches the far edge; edge patches are cropped, never shifted back.
    const positions=[];
    for(let position=0;position===0||positions.at(-1)+patch<size;position+=step)positions.push(position);
    for(const y of positions) for(const x of positions) {
      const w=Math.min(patch,size-x), h=Math.min(patch,size-y);
      let best=Infinity;
      if(method!=='random') for(let c=0;c<pool.length;c++) {
        const {x:sx,y:sy}=pool[c];
        let local=0,localCount=0,correspondence=0, prior=0;
        // Synthesis scores only the overlap. Skip the unscored interior of large
        // patches; preserve raster summation order and count the corner once.
        for(let yy=0;yy<h;yy++) for(let xx=0,end=target||(y&&yy<ov)?w:x?Math.min(ov,w):0;xx<end;xx++) {
          const dst=(y+yy)*size+x+xx, src=(sy+yy)*source.width+sx+xx;
          if((x&&xx<ov)||(y&&yy<ov)) {local+=difference(data,dst*4,source.data,src*4);localCount++;}
          if(target) {const delta=sourceGuide[src]-targetGuide[dst];correspondence+=delta*delta;}
          if(previous) prior+=difference(previous,dst*4,source.data,src*4);
        }
        const continuity=localCount?local/localCount:0;
        const texture=previous?(continuity+prior/(w*h))/2:continuity;
        const score=target?(1-structure)*texture+structure*correspondence/(w*h):texture;
        scores[c]=score;best=Math.min(best,score);
      }
      let selected;
      if(method==='random'||(!x&&!y&&!target)) selected=Math.floor(random()*pool.length);
      else {
        const acceptable=[];
        for(let c=0;c<pool.length;c++) if(scores[c]<=best*(1+tolerance)+1e-12)acceptable.push(c);
        selected=acceptable[Math.floor(random()*acceptable.length)];
      }
      const {x:sx,y:sy}=pool[selected];
      const {left,top}=seamMasks(data,source,x,y,sx,sy,w,h,size,ov,method);
      for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++) {
        const keepLeft=x&&xx<(left?left[yy]:method==='straight'?Math.floor(ov/2):0);
        const keepTop=y&&yy<(top?top[xx]:method==='straight'?Math.floor(ov/2):0);
        if(keepLeft||keepTop)continue;
        const dst=(y+yy)*size+x+xx, src=(sy+yy)*source.width+sx+xx;
        data[dst*4]=source.data[src*4];data[dst*4+1]=source.data[src*4+1];data[dst*4+2]=source.data[src*4+2];data[dst*4+3]=255;
        owners[dst]=placement;
      }
      placement++;done++;
      yield {data,width:size,height:size,progress:done/total,pass:pass+1,passes:count,patchSize:patch,placement:{x,y,sx,sy,width:w,height:h},method};
    }
    lastOwnership=owners;
  }
  const seams=new Uint8Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=y*size+x;
    if((x&&lastOwnership[i]!==lastOwnership[i-1])||(y&&lastOwnership[i]!==lastOwnership[i-size]))seams[i]=1;
  }
  return {data,width:size,height:size,seams,seed:String(seed),patches:done,passes:count,method};
}

export function synthesize(options) {
  const iterator=quilt(options);
  let step=iterator.next();
  while(!step.done)step=iterator.next();
  return step.value;
}
