import { quilt } from './quilting.js';

self.onmessage = ({ data: { id, options } }) => {
  const started=performance.now();
  try {
    const iterator=quilt(options);
    let step=iterator.next(), last=0;
    while(!step.done) {
      // Large exports need fewer preview copies to keep memory traffic bounded.
      if(performance.now()-last>(options.size>1024?300:90)) {
        const frame=step.value.data.slice();
        self.postMessage({id,type:'progress',...step.value,data:frame,elapsed:performance.now()-started},[frame.buffer]);
        last=performance.now();
      }
      step=iterator.next();
    }
    self.postMessage({id,type:'complete',...step.value,elapsed:performance.now()-started},[step.value.data.buffer,step.value.seams.buffer]);
  } catch(error) {self.postMessage({id,type:'error',message:error.message});}
};
