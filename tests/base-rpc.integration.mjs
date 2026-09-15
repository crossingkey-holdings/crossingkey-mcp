const url=process.env.BASE_RPC_URL||'https://mainnet.base.org';
const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(8000)});
if(!response.ok) throw new Error(`HTTP ${response.status}`);
const body=await response.json(); if(body.result!=='0x2105') throw new Error(`Unexpected Base chain id: ${body.result}`);
const blockResponse=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'eth_blockNumber',params:[]}),signal:AbortSignal.timeout(8000)});
if(!blockResponse.ok) throw new Error(`HTTP ${blockResponse.status}`); const block=(await blockResponse.json()).result; if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block)) throw new Error('Malformed block number');
console.log(JSON.stringify({network:'eip155:8453',chainId:8453,blockNumber:block,rpc:'configured-or-mainnet-base-public',writes:0}));
