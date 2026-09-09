import test from 'node:test';
import assert from 'node:assert/strict';
import { minimumErrorCut, synthesize, quilt, seededRandom } from '../src/quilting.js';

function image(width,height,fn) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...fn(x,y),255],(y*width+x)*4);
  return {width,height,data};
}
const texture=image(24,24,(x,y)=>[(x*31+y*11)%256,(x*7+y*23)%256,(x*19+y*3)%256]);
const config={source:texture,size:32,patchSize:12,overlap:3,candidateCount:32,seed:'quilt'};

test('dynamic programming finds the global minimum among every connected path',()=>{
  const costs=[7,1,8,2,9,3,8,1,6,3,7,2];
  let best=Infinity;
  const walk=(x,y,sum)=>{
    sum+=costs[y*3+x];
    if(y===3){best=Math.min(best,sum);return;}
    for(let next=Math.max(0,x-1);next<=Math.min(2,x+1);next++)walk(next,y+1,sum);
  };
  for(let x=0;x<3;x++)walk(x,0,0);
  const result=minimumErrorCut(costs,3,4);
  assert.equal(result.cost,best);
  assert.equal(result.path.reduce((sum,x,y)=>sum+costs[y*3+x],0),best);
  result.path.forEach((x,y)=>{if(y)assert.ok(Math.abs(x-result.path[y-1])<=1);});
});
test('single-column, tie and invalid seam cases',()=>{
  assert.deepEqual([...minimumErrorCut([3,1,2],1,3).path],[0,0,0]);
  assert.equal(minimumErrorCut([0,0,0,0],2,2).cost,0);
  assert.throws(()=>minimumErrorCut([NaN],1,1),RangeError);
  assert.throws(()=>minimumErrorCut([-1],1,1),RangeError);
  assert.throws(()=>minimumErrorCut([1],0,1),RangeError);
});
test('seeds reproduce pixels and seams without mutating the source',()=>{
  const before=texture.data.slice(), a=synthesize(config), b=synthesize(config);
  assert.deepEqual(a,b);assert.deepEqual(texture.data,before);
  assert.notDeepEqual(a.data,synthesize({...config,seed:'different'}).data);
  const r=seededRandom('repeat'),s=seededRandom('repeat');
  for(let i=0;i<100;i++)assert.equal(r(),s());
});
test('every output pixel comes from the source and is filled, including L-shaped overlaps and cropped edges',()=>{
  const colors=new Set();
  for(let i=0;i<texture.data.length;i+=4)colors.add([...texture.data.subarray(i,i+3)].join(','));
  for(const method of ['cut','straight','random']) {
    const output=synthesize({...config,size:37,method});
    for(let i=0;i<output.data.length;i+=4){assert.equal(output.data[i+3],255);assert.ok(colors.has([...output.data.subarray(i,i+3)].join(',')));}
    assert.ok(output.seams.some(Boolean));
  }
});
test('constant textures have no invented colors or holes',()=>{
  const source=image(16,16,()=>[24,80,42]);
  const result=synthesize({...config,source,patchSize:8,overlap:2});
  for(let i=0;i<result.data.length;i+=4)assert.deepEqual([...result.data.subarray(i,i+4)],[24,80,42,255]);
});
test('target correspondence actually changes the result toward the target',()=>{
  const source=image(24,24,x=>{const v=Math.round(x/23*255);return[v,v,v];});
  const target=image(32,32,x=>{const v=x<16?15:240;return[v,v,v];});
  const options={source,target,size:32,patchSize:8,overlap:2,candidateCount:512,tolerance:0,passes:2,seed:4};
  const weak=synthesize({...options,structure:0}),strong=synthesize({...options,structure:1});
  const error=result=>result.data.reduce((sum,v,i)=>i%4===3?sum:sum+(v-target.data[i])**2,0);
  assert.ok(error(strong)<error(weak)*0.5);
});
test('progress is monotonic across refinement passes and reaches one',()=>{
  const target=image(37,37,(x,y)=>[x*6,y*6,100]);
  const iterator=quilt({...config,size:37,target,passes:3});
  let last=0,steps=0,step=iterator.next();
  while(!step.done){assert.ok(step.value.progress>last&&step.value.progress<=1);last=step.value.progress;steps++;step=iterator.next();}
  assert.equal(last,1);assert.equal(step.value.patches,steps);assert.equal(step.value.passes,3);
  for(let i=3;i<step.value.data.length;i+=4)assert.equal(step.value.data[i],255);
});
test('unsafe sizes and malformed inputs fail before work starts',()=>{
  for(const change of [{size:1024},{overlap:12},{candidateCount:0},{patchSize:0},{passes:6},{structure:NaN},{method:'blend'},{source:{width:16,height:16,data:[]}}])assert.throws(()=>synthesize({...config,...change}),RangeError);
});
