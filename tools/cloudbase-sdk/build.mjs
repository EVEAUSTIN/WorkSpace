import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(root,'../../assets/cloudbase-auth-3.10.4.js');
const result=await build({absWorkingDir:root,entryPoints:['entry.js'],bundle:true,platform:'browser',format:'iife',target:'es2020',minify:true,legalComments:'linked',outfile:output,metafile:true});
const notices=new Map();
function include(file){if(fs.existsSync(file)&&fs.statSync(file).isFile())notices.set(path.relative(root,file),fs.readFileSync(file,'utf8').replace(/[ \t]+$/gm,''));}
for(const input of Object.keys(result.metafile.inputs)){
  const file=path.resolve(root,input);include(file+'.LICENSE.txt');
  let dir=path.dirname(file);
  while(dir!==path.dirname(dir)){
    const manifest=path.join(dir,'package.json');
    if(fs.existsSync(manifest)){
      const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
      if(pkg.name){for(const name of fs.readdirSync(dir))if(/^(licen[cs]e|copying|notice)(\.|$)/i.test(name))include(path.join(dir,name));break;}
    }
    dir=path.dirname(dir);
  }
}
fs.writeFileSync(path.resolve(root,'../../assets/cloudbase-THIRD-PARTY-NOTICES.txt'),[...notices].sort(([a],[b])=>a.localeCompare(b)).map(([name,text])=>'===== '+name+' =====\n'+text).join('\n\n'));
console.log('Built CloudBase browser auth SDK and '+notices.size+' license notices.');
