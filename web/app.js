import { mountLab } from '../src/lab.js';
const mode=new URLSearchParams(location.search).get('study')==='transfer'?'transfer':'quilting';
document.querySelector('h1').textContent=mode==='transfer'?'Texture transfer':'Image quilting';
document.querySelector('[data-description]').textContent=mode==='transfer'?'Reconstruct an image using patches of another material.':'Build a larger texture from a small sample, one minimum-error seam at a time.';
document.title=`${mode==='transfer'?'Texture transfer':'Image quilting'} | Graphics Studies`;
mountLab(document.querySelector('#lab'),{mode,assetsBase:'/web/assets'});
