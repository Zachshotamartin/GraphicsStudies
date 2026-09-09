/** Static markup is shared with server-rendered portfolio pages. */
export function labMarkup({mode='quilting',assetsBase='./web/assets'}={}) {
  const transfer=mode==='transfer';
  return `
    <form class="graphics-lab__controls">
      <fieldset><legend>Source material</legend>
        <label>Texture<select name="texture"><option value="foliage">Foliage</option><option value="pebbles" ${transfer?'selected':''}>River pebbles</option><option value="upload" hidden>Uploaded texture</option></select></label>
        <div class="graphics-lab__inputs"><figure><img data-input="source" src="${assetsBase}/${transfer?'pebbles':'foliage'}.webp" alt="Selected source texture" width="128" height="128"><figcaption>Texture sample</figcaption></figure>${transfer?`<figure><img data-input="target" src="${assetsBase}/bust.webp" alt="Selected target image" width="128" height="128"><figcaption>Target structure</figcaption></figure>`:''}</div>
        <label class="graphics-lab__upload">Upload texture<input name="sourceFile" type="file" accept="image/png,image/jpeg,image/webp"></label>
        ${transfer?'<label class="graphics-lab__upload">Upload target<input name="targetFile" type="file" accept="image/png,image/jpeg,image/webp"></label>':''}
        <small>PNG, JPEG or WebP, up to 12 MB. Images stay in your browser.</small>
      </fieldset>
      <fieldset><legend>${transfer?'Transfer settings':'Quilting settings'}</legend>
        <div class="graphics-lab__pair"><label>Patch size<select name="patch"><option>16</option><option>24</option><option selected>36</option><option>48</option><option>64</option></select></label><label>Output<select name="size"><option value="256">256 × 256</option><option value="384">384 × 384</option><option value="512">512 × 512</option></select></label></div>
        <label>Overlap <output data-value="overlap">17%</output><input name="overlap" type="range" min="10" max="40" value="17"></label>
        ${transfer?'<label>Target structure <output data-value="structure">75%</output><input name="structure" type="range" min="10" max="95" value="75"></label><label>Refinement passes<select name="passes"><option>1</option><option>2</option><option selected>3</option></select></label>':'<label>Join method<select name="method"><option value="cut">Minimum-error seam</option><option value="straight">Straight overlap</option><option value="random">Random patches</option></select></label>'}
        <div class="graphics-lab__pair"><label>Candidate patches<select name="candidates"><option value="384">384</option><option value="768">768</option><option value="1536">1,536</option></select></label><label>Seed<input name="seed" value="42" maxlength="32" autocomplete="off"></label></div>
        <small>${transfer?'Higher structure favors the target’s tones. Smaller patches resolve finer details.':'Try all three join methods with the same seed to compare how boundaries change.'}</small>
      </fieldset>
      <div class="graphics-lab__actions"><button type="submit" data-run>Run ${transfer?'transfer':'quilting'}</button><button type="button" data-cancel hidden>Cancel</button></div>
    </form>
    <div class="graphics-lab__result">
      <div class="graphics-lab__toolbar" role="group" aria-label="Output display"><button type="button" data-view="result" aria-pressed="true">Result</button><button type="button" data-view="seams" aria-pressed="false" disabled>Show seams</button><button type="button" data-export disabled>Save PNG</button></div>
      <div class="graphics-lab__canvas"><img data-poster src="${assetsBase}/${transfer?'transfer':'quilting'}-result.webp" alt="Example ${transfer?'sculpture reconstructed from pebble patches':'foliage synthesized from overlapping patches'}" width="512" height="512"><canvas hidden width="256" height="256" aria-label="${transfer?'Texture transfer':'Image quilting'} output"></canvas></div>
      <p class="graphics-lab__status" role="status" aria-live="polite">Example output. Choose settings, then run the study.</p>
      <p class="graphics-lab__error" role="alert" hidden></p>
      <p class="graphics-lab__caption">${transfer?'Every output pixel comes from the texture sample. The target only guides which patches are selected.':'Patches are matched by overlap error. The seam follows a minimum-cost path through that error map.'}</p>
    </div>`;
}

/** The standalone demos and portfolio import this same UI and worker implementation. */
export function mountLab(host,{mode='quilting',assetsBase='./web/assets',workerFactory=()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'})}={}) {
  const transfer=mode==='transfer';
  host.classList.add('graphics-lab');
  host.innerHTML=labMarkup({mode,assetsBase});
  const form=host.querySelector('form'), canvas=host.querySelector('canvas'), context=canvas.getContext('2d');
  const poster=host.querySelector('[data-poster]'),status=host.querySelector('[role=status]'),error=host.querySelector('[role=alert]');
  const run=host.querySelector('[data-run]'),cancel=host.querySelector('[data-cancel]'),exportButton=host.querySelector('[data-export]'),seamButton=host.querySelector('[data-view=seams]');
  const sourceImage=host.querySelector('[data-input=source]'),targetImage=host.querySelector('[data-input=target]');
  let worker=null, result=null, active=0, disposed=false, uploadedSource=null, uploadedTarget=null, view='result';
  const uploadVersions={source:0,target:0};
  const listeners=[];
  const on=(element,event,handler)=>{element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler));};
  const setError=message=>{error.textContent=message;error.hidden=!message;};
  const syncInputs=()=>{
    sourceImage.src=form.elements.texture.value==='upload'?uploadedSource:`${assetsBase}/${form.elements.texture.value}.webp`;
    if(targetImage)targetImage.src=uploadedTarget||`${assetsBase}/bust.webp`;
  };
  const refreshLabels=()=>{
    for(const output of host.querySelectorAll('[data-value]'))output.value=`${form.elements[output.dataset.value].value}%`;
  };
  const lock=busy=>{
    for(const fieldset of form.querySelectorAll('fieldset'))fieldset.disabled=busy;
    run.disabled=busy;cancel.hidden=!busy;exportButton.disabled=busy||!result;seamButton.disabled=busy||!result;
    canvas.setAttribute('aria-busy',String(busy));
  };
  const draw=frame=>{
    canvas.width=frame.width;canvas.height=frame.height;
    const pixels=new Uint8ClampedArray(frame.data);
    if(view==='seams'&&frame.seams) for(let i=0;i<frame.seams.length;i++)if(frame.seams[i]){pixels[i*4]=231;pixels[i*4+1]=179;pixels[i*4+2]=97;}
    context.putImageData(new ImageData(pixels,frame.width,frame.height),0,0);
    canvas.hidden=false;poster.hidden=true;
  };
  async function decode(url,size,crop) {
    const image=new Image();image.src=url;await image.decode();
    if(image.naturalWidth*image.naturalHeight>40000000)throw new Error('Use an image smaller than 40 megapixels.');
    const buffer=document.createElement('canvas');
    buffer.width=size;buffer.height=size;
    const ctx=buffer.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#141f1f';ctx.fillRect(0,0,size,size);
    if(crop){const side=Math.min(image.naturalWidth,image.naturalHeight);ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,size,size);}
    else {const scale=Math.min(size/image.naturalWidth,size/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(size-w)/2,(size-h)/2,w,h);}
    return {data:ctx.getImageData(0,0,size,size).data,width:size,height:size};
  }
  async function start(event) {
    event.preventDefault();
    const id=++active;
    worker?.terminate();setError('');lock(true);view='result';
    for(const button of host.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view==='result'));
    status.textContent='Preparing image pixels…';
    if(matchMedia('(max-width:700px)').matches) host.querySelector('.graphics-lab__result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'});
    try {
      const size=Number(form.elements.size.value),patchSize=Number(form.elements.patch.value);
      const source=await decode(sourceImage.src,256,true);
      const target=transfer?await decode(targetImage.src,size,false):null;
      if(disposed||id!==active)return;
      const options={source,target,size,patchSize,overlap:Math.max(1,Math.round(patchSize*Number(form.elements.overlap.value)/100)),candidateCount:Number(form.elements.candidates.value),seed:form.elements.seed.value,structure:transfer?Number(form.elements.structure.value)/100:0,passes:transfer?Number(form.elements.passes.value):1,method:transfer?'cut':form.elements.method.value};
      worker=workerFactory();
      worker.onmessage=({data})=>{
        if(disposed||data.id!==active)return;
        if(data.type==='error'){setError(data.message);status.textContent='The study could not finish.';lock(false);worker.terminate();return;}
        draw(data);
        if(data.type==='complete'){
          result={...data,options:{...options,source:undefined,target:undefined}};
          status.textContent=`${data.patches} patches · ${(data.elapsed/1000).toFixed(1)} seconds · seed ${options.seed} · ${size} × ${size}`;
          lock(false);worker.terminate();worker=null;
        }else status.textContent=`${Math.round(data.progress*100)}% complete${transfer?` · pass ${data.pass} of ${data.passes}`:''} · ${data.patchSize}px patches`;
      };
      worker.onerror=()=>{if(id!==active)return;setError('The worker could not run. Reload the page and try again.');status.textContent='Study stopped.';lock(false);worker?.terminate();worker=null;};
      const buffers=[source.data.buffer];if(target)buffers.push(target.data.buffer);
      worker.postMessage({id,options},buffers);
    }catch(cause){if(!disposed&&id===active){setError(cause.message||'Could not read that image.');status.textContent='Study stopped.';lock(false);}}
  }
  on(form,'submit',start);
  on(cancel,'click',()=>{active++;worker?.terminate();worker=null;lock(false);if(result)draw(result);else{canvas.hidden=true;poster.hidden=false;}status.textContent='Canceled. Adjust settings to run again.';});
  on(form,'input',refreshLabels);
  on(form.elements.texture,'change',syncInputs);
  for(const [name,kind] of [['sourceFile','source'],['targetFile','target']])if(form.elements[name])on(form.elements[name],'change',async event=>{
    const version=++uploadVersions[kind];
    const file=event.target.files?.[0];if(!file)return;
    if(file.size>12*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Choose a PNG, JPEG or WebP image under 12 MB.');event.target.value='';return;}
    const url=URL.createObjectURL(file);
    try{await decode(url,64,kind==='source');if(disposed||version!==uploadVersions[kind]){URL.revokeObjectURL(url);return;}if(kind==='source'){if(uploadedSource)URL.revokeObjectURL(uploadedSource);uploadedSource=url;form.elements.texture.querySelector('[value=upload]').hidden=false;form.elements.texture.value='upload';}else{if(uploadedTarget)URL.revokeObjectURL(uploadedTarget);uploadedTarget=url;}setError('');syncInputs();}catch{URL.revokeObjectURL(url);if(!disposed&&version===uploadVersions[kind])setError('That image could not be decoded. Try another file.');}
  });
  for(const button of host.querySelectorAll('[data-view]'))on(button,'click',()=>{view=button.dataset.view;for(const other of host.querySelectorAll('[data-view]'))other.setAttribute('aria-pressed',String(other===button));if(result)draw(result);});
  on(exportButton,'click',()=>{
    if(!result)return;
    const exportCanvas=document.createElement('canvas');exportCanvas.width=result.width;exportCanvas.height=result.height;
    exportCanvas.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);
    exportCanvas.toBlob(blob=>{if(!blob)return;const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=`${mode}-${result.width}-${result.seed.replace(/[^a-zA-Z0-9_-]/g,'_')}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
  });
  syncInputs();refreshLabels();
  return ()=>{disposed=true;active++;worker?.terminate();listeners.forEach(remove=>remove());if(uploadedSource)URL.revokeObjectURL(uploadedSource);if(uploadedTarget)URL.revokeObjectURL(uploadedTarget);host.replaceChildren();};
}
