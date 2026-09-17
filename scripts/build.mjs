import {mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const copy=JSON.parse(await readFile('data/presentation.json','utf8'));const pack=JSON.parse(await readFile('data/game.json','utf8'));pack.presentation=copy;await writeFile('data/game.json',JSON.stringify(pack,null,2)+'\n');
const compile=spawnSync(process.platform==='win32'?'tsc.cmd':'tsc',['--pretty','false'],{stdio:'inherit',shell:process.platform==='win32'});
if(compile.status!==0)process.exit(compile.status??1);
await mkdir('dist/data',{recursive:true});
const order=['engine','art','presentation','build-paths','build-analysis','app'];
function stripModuleSyntax(code){
 const lines=code.split('\n'),out=[];let importing=false,exporting=false;
 for(const line of lines){
  const trimmed=line.trim();
  if(importing){if(trimmed.includes(';'))importing=false;continue;}
  if(exporting){if(trimmed.includes('}'))exporting=false;continue;}
  if(/^import(?:\s|['"{*])/.test(trimmed)){importing=!trimmed.includes(';');continue;}
  if(/^export\s*\{/.test(trimmed)){exporting=!trimmed.includes('}');continue;}
  if(/^export\s+\*/.test(trimmed))continue;
  out.push(line.replace(/^(\s*)export\s+default\s+/,'$1').replace(/^(\s*)export\s+/,'$1'));
 }
 return out.join('\n');
}
let js='(()=>{\n"use strict";\n';
for(const name of order){const code=stripModuleSyntax(await readFile(`build/${name}.js`,'utf8'));js+=code+'\n';}
js+='})();\n';
const css=await readFile('src/style.css','utf8');let html=await readFile('index.html','utf8');
const data=await readFile('data/game.json','utf8');JSON.parse(data);
await writeFile('dist/app.js',js);await writeFile('dist/style.css',css);await writeFile('dist/index.html',html);await writeFile('dist/data/game.json',data);await writeFile('dist/.nojekyll','');
const generatedNames=['combat-vfx-atlas'];
await mkdir('dist/assets/generated',{recursive:true});
for(const name of generatedNames)await copyFile(`assets/generated/${name}.webp`,`dist/assets/generated/${name}.webp`);
let offlineJs=js;
for(const name of generatedNames){const rel=`assets/generated/${name}.webp`;const uri=`data:image/webp;base64,${(await readFile(rel)).toString('base64')}`;offlineJs=offlineJs.replaceAll(`./${rel}`,uri);}
const offline=html.replace('<link rel="stylesheet" href="./style.css">',`<style>${css}</style>`).replace('<script src="./app.js" defer></script>',`<script>window.__GAME_CONTENT__=${JSON.stringify(JSON.parse(data)).replace(/</g,'\\u003c')};</script><script>${offlineJs.replace(/<\/script/gi,'<\\/script')}</script>`);
await writeFile('PLAY.html',offline);await writeFile('dist/PLAY.html',offline);
console.log(`Build OK: ${Buffer.byteLength(js)} bytes JS, ${Buffer.byteLength(css)} bytes CSS, ${Buffer.byteLength(offline)} bytes offline HTML`);
