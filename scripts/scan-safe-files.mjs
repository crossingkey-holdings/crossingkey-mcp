import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT=process.cwd();
const map=JSON.parse(fs.readFileSync(path.join(ROOT,'data','fulfillment_map.json'),'utf8')).products;
const delivery=path.join(ROOT,'delivery');
fs.mkdirSync(delivery,{recursive:true});

const roots=process.argv.slice(2);
if(!roots.length){
  console.error('Usage: npm run scan:files -- ~/Downloads ~/Documents');
  process.exit(2);
}
const wanted=new Map(Object.entries(map).map(([id,m])=>[m.file,{id,...m}]));
const found=[];
const secretPatterns=[
  /sk_(?:live|test)_[A-Za-z0-9]+/g,
  /whsec_[A-Za-z0-9]+/g,
  /gh[pousr]_[A-Za-z0-9_]+/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/ig
];
function sha(file){
  const h=crypto.createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex');
}
function walk(dir){
  let ents; try{ents=fs.readdirSync(dir,{withFileTypes:true})}catch{return}
  for(const e of ents){
    if(['.git','node_modules','.cache'].includes(e.name)) continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(p);
    else if(wanted.has(e.name)){
      const meta=wanted.get(e.name);
      const got=sha(p);
      const size=fs.statSync(p).size;
      let secretHit=false;
      if(size<25*1024*1024){
        const buf=fs.readFileSync(p);
        const sample=buf.toString('utf8');
        secretHit=secretPatterns.some(rx=>{rx.lastIndex=0; return rx.test(sample)});
      }
      const okHash=got===meta.sha256;
      const ok=okHash && !secretHit;
      if(ok) fs.copyFileSync(p,path.join(delivery,e.name));
      found.push({offer_id:meta.id,source:p,file:e.name,sha256:got,expected_sha256:meta.sha256,hash_ok:okHash,secret_pattern_hit:secretHit,copied:ok});
    }
  }
}
for(const r0 of roots){
  const r=path.resolve(r0.replace(/^~(?=\/|$)/,process.env.HOME||''));
  walk(r);
}
fs.writeFileSync(path.join(ROOT,'data','safe_file_scan.json'),JSON.stringify({scanned_at:new Date().toISOString(),found},null,2));
console.log(JSON.stringify({matched:found.length,copied:found.filter(x=>x.copied).length,report:'data/safe_file_scan.json'},null,2));
