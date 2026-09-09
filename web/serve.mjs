import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
createServer(async(req,res)=>{
  try {
    let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path==='/')path='/web/index.html';
    const file=resolve(root,`.${path}`);
    if(!file.startsWith(root+sep))throw new Error('Forbidden');
    const contents=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(contents);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(5182,'127.0.0.1',()=>console.log('Graphics Studies: http://127.0.0.1:5182'));
