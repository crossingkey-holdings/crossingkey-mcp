/* Definition-only factory boundary. Importing this module performs no I/O. */
export async function createCrossingKeyApp(options={}) {
  const envMap={
    CK_NO_LISTEN:'true',
    CK_STATE_FILE:options.stateFile,
    CK_CATALOG_FILE:options.catalogFile,
    CK_CREDITS_FILE:options.creditsFile,
    CK_FULFILL_FILE:options.fulfillFile,
    CK_SERVICES_FILE:options.servicesFile,
    CK_FUNNEL_DB:options.funnelDb,
    MACHINE_COMMERCE_FILE:options.machineCommerceFile,
    MARKETPLACE_FILE:options.marketplaceFile,
    DELIVERY_ROOT:options.deliveryRoot,
    CK_BASE_RPC_URL:options.rpcUrl,
    X402_FACILITATOR_URL:options.facilitatorUrl,
    PUBLIC_BASE_URL:options.publicBaseUrl,
    CK_KENNEKARTE_HMAC_SECRET:options.kennekarteSecret
  };
  const previous={};
  for(const [key,value] of Object.entries(envMap)){
    if(value===undefined) continue;
    previous[key]=process.env[key];
    process.env[key]=String(value);
  }
  try {
    const module=await import(`../server-runtime.mjs?factory=${Date.now()}-${Math.random()}`);
    return {app:module.createCrossingKeyApp(),start:module.startCrossingKeyServer};
  } finally {
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}
