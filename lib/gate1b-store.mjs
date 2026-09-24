import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export function readState(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,idempotency:{},replayKeys:{},entitlements:{},receipts:{}};throw e;}}
export function durableWrite(file,state){
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${crypto.randomUUID()}.tmp`;
 const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
// Kernel-held ownership: elapsed time never evicts a live owner. Parent death closes
// the pipe, the guardian exits, and the kernel releases flock. Shared by marketplace.
export async function withProcessLock(file,operation,{waitMs=Number(process.env.CK_GATE1B_LOCK_WAIT_MS||180000)}={}){
 if(!Number.isSafeInteger(waitMs)||waitMs<1000)throw new Error('Invalid Gate1B lock wait');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 if(fs.existsSync(`${file}.lock`))throw new Error('Legacy store lock present; operator reconciliation required');
 const token=crypto.randomUUID(),frame=`LOCKED ${token}`;
 // Synchronous descriptor I/O is intentional: readiness cannot be buffered,
 // and the kernel lock remains held until the parent's control pipe closes.
 const program=`import fs from 'node:fs';fs.writeSync(1,${JSON.stringify(frame+'\n')});const b=Buffer.alloc(1);while(fs.readSync(0,b,0,1,null)>0){}`;
 const guard=spawn('/usr/bin/flock',['--exclusive','--wait',String(waitMs/1000),`${file}.gate1b.lock`,process.execPath,'--input-type=module','-e',program],{stdio:['pipe','pipe','pipe']});
 guard.stdin.on('error',()=>{});
 let owned=false,closed=false,output='',errors='';
 guard.stderr.setEncoding('utf8');guard.stderr.on('data',d=>{errors+=d;});
 const done=new Promise(resolve=>guard.once('close',(code,signal)=>{closed=true;owned=false;resolve({code,signal});}));
 try{
  await new Promise((resolve,reject)=>{
   let settled=false;
   const timer=setTimeout(()=>finish(new Error('Lock guardian readiness timed out')),waitMs+1000);timer.unref?.();
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
   guard.once('error',error=>finish(error));
   guard.once('close',(code,signal)=>{if(!owned)finish(new Error(`Lock guardian exited before readiness (${signal||code}); ${errors.trim()}`.trim()));});
   guard.stdout.setEncoding('utf8');
   guard.stdout.on('data',chunk=>{
    output+=chunk;
    while(output.includes('\n')){
     const index=output.indexOf('\n'),line=output.slice(0,index);output=output.slice(index+1);
     if(line!==frame){finish(new Error('Malformed lock guardian readiness'));return;}
     owned=true;finish();return;
    }
    if(output.length>256)finish(new Error('Malformed lock guardian readiness'));
   });
  });
  const assertOwned=()=>{if(!owned||closed)throw new Error('Durable ownership lost');};
  return await operation(assertOwned);
 }finally{
  guard.stdin.end();
  const cleanup=setTimeout(()=>{if(!closed)guard.kill('SIGKILL');},2000);cleanup.unref?.();
  await done;clearTimeout(cleanup);
 }
}
