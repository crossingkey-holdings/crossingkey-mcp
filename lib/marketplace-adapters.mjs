import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import {boundedJson,validateValue} from './marketplace-schema.mjs';

export function publicIp(address) {
  if(net.isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
  }
  // Allow global-unicast only; mapped IPv4, transition, documentation and local ranges denied.
  const lower=address.toLowerCase(),second=parseInt(lower.split(':')[1]||'0',16);
  return net.isIP(address)===6 && /^[23]/.test(lower) && !(lower.startsWith('2001:')&&(second<0x200||second===0xdb8)) && !/^2002:/i.test(lower) && !/^3fff:/i.test(lower);
}

export async function validateEndpoint(raw,lookup=dns.lookup) {
  let url; try { url=new URL(raw); } catch { throw new Error('INVALID_ENDPOINT'); }
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')) throw new Error('INVALID_ENDPOINT');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(host.toLowerCase()==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')) throw new Error('SSRF_BLOCKED');
  const addresses=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(x=>!publicIp(x.address))) throw new Error('SSRF_BLOCKED');
  return {url,addresses};
}

export async function requestJson(endpoint,body,{timeoutMs=8000,maxBytes=262144,headers={},lookup=dns.lookup,requestImpl=https.request,signal,method='POST'}={}) {
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  const {url,addresses}=await Promise.race([validateEndpoint(endpoint,lookup),new Promise((_,reject)=>deadline.addEventListener('abort',()=>reject(new Error('PROVIDER_TIMEOUT')),{once:true}))]);
  return new Promise((resolve,reject)=>{
    const selected=addresses[0];
    const request=requestImpl(url,{method,agent:false,signal:deadline,
      headers:{...headers,'content-type':'application/json',accept:'application/json, text/event-stream'},
      lookup:(_host,options,callback)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family)
    },response=>{
      if(response.statusCode<200||response.statusCode>=300) {response.destroy();reject(new Error('PROVIDER_UNAVAILABLE'));return;}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy();request.destroy();reject(new Error('INVALID_PROVIDER_RESPONSE'));}else chunks.push(chunk);});
      response.on('error',()=>reject(new Error('PROVIDER_UNAVAILABLE')));
      response.on('end',()=>{try {
        const text=Buffer.concat(chunks).toString('utf8');
        const data=text.startsWith('event:')||text.startsWith('data:')?text.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n'):text;
        resolve({data:data?JSON.parse(data):null,session:response.headers['mcp-session-id']});
      }catch{reject(new Error('INVALID_PROVIDER_RESPONSE'));}});
    });
    request.on('error',()=>reject(new Error(deadline.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE')));
    request.end(body===undefined?undefined:JSON.stringify(body));
  });
}

export async function artifactInfo(root,relative) {
  if(!root||!relative||path.isAbsolute(relative)) throw new Error('DELIVERY_FAILED');
  const canonicalRoot=fs.realpathSync(root),file=fs.realpathSync(path.resolve(canonicalRoot,relative));
  if(!file.startsWith(canonicalRoot+path.sep)) throw new Error('DELIVERY_FAILED');
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>128*1024*1024) throw new Error('DELIVERY_FAILED');
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file)) hash.update(chunk);
  return {file,size:stat.size,contentHash:`sha256:${hash.digest('hex')}`};
}

export function createAdapters({bindings={},local={},assetRoot,request=requestJson,timeoutMs=8000}={}) {
  function binding(capability) {
    const config=(typeof bindings==='function'?bindings():bindings)[capability.capabilityId];
    if(!config||!['local','http','mcp','digital_asset'].includes(config.type)) throw new Error('CAPABILITY_DISABLED');
    return config;
  }
  async function preflight(capability) {
    const config=binding(capability);
    if(config.type==='local'&&!local[config.adapter]) throw new Error('CAPABILITY_DISABLED');
    if(['http','mcp'].includes(config.type)) {
      if(config.endpoint!==capability.executionEndpoint) throw new Error('INVALID_ENDPOINT');
      await validateEndpoint(config.endpoint);
      if(config.type==='mcp'&&!/^[A-Za-z0-9._-]{1,128}$/.test(config.tool||'')) throw new Error('INVALID_ENDPOINT');
    }
    if(config.type==='digital_asset') {
      const artifact=await artifactInfo(assetRoot,config.file);
      if(capability.deliveryType!=='digital_asset'||artifact.contentHash!==capability.contentHash) throw new Error('VERIFICATION_FAILED');
    }
  }
  async function executeCapability(context) {
    const {capability,input,entitlement}=context,config=binding(capability);
    let result,timer;const controller=new AbortController();
    const run=async()=>{
      if(config.type==='local') return local[config.adapter]({...context,signal:controller.signal});
      if(config.type==='http') return (await request(config.endpoint,{input,jobId:context.job.jobId},{timeoutMs,signal:controller.signal})).data;
      if(config.type==='mcp') {
        const init=await request(config.endpoint,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'crossingkey-marketplace',version:'2.5.0'}}},{timeoutMs,signal:controller.signal});
        if(!init.data?.result?.serverInfo||init.data.error) throw new Error('INVALID_PROVIDER_RESPONSE');
        const headers=init.session?{'mcp-session-id':init.session}:{};
        await request(config.endpoint,{jsonrpc:'2.0',method:'notifications/initialized'},{timeoutMs,headers,signal:controller.signal});
        let response;
        try {response=await request(config.endpoint,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:config.tool,arguments:input}},{timeoutMs,headers,signal:controller.signal});}
        finally {if(init.session)await request(config.endpoint,undefined,{timeoutMs:1000,headers,method:'DELETE',signal:controller.signal}).catch(()=>{});}
        if(response.data?.error||response.data?.result?.isError||!response.data?.result?.structuredContent) throw new Error('INVALID_PROVIDER_RESPONSE');
        return response.data.result.structuredContent;
      }
      const artifact=await artifactInfo(assetRoot,config.file);
      if(artifact.contentHash!==capability.contentHash) throw new Error('VERIFICATION_FAILED');
      return {artifactId:capability.capabilityId,contentHash:artifact.contentHash,bytes:artifact.size,
        downloadPath:`/api/marketplace/delivery/${entitlement.id}`,authentication:'buyer_bearer_required'};
    };
    try {result=await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('PROVIDER_TIMEOUT'));},timeoutMs);})]);}
    finally {clearTimeout(timer);controller.abort();}
    try {boundedJson(result,262144);validateValue(capability.outputSchema,result);}catch{throw new Error('INVALID_PROVIDER_RESPONSE');}
    return result;
  }
  async function delivery(capability) {
    const config=binding(capability);
    if(config.type!=='digital_asset') throw new Error('DELIVERY_FAILED');
    const artifact=await artifactInfo(assetRoot,config.file);
    if(artifact.contentHash!==capability.contentHash) throw new Error('VERIFICATION_FAILED');
    return artifact;
  }
  return {preflight,executeCapability,delivery};
}
