/*
 * Production entrypoint.
 *
 * All application construction is owned by lib/mcp-app-factory.mjs. This
 * module resolves the production environment, asks the canonical factory for
 * the application once, and owns only explicit listener startup.
 */
import { createCrossingKeyApp as constructCrossingKeyApp } from './lib/mcp-app-factory.mjs';

const constructed = await constructCrossingKeyApp();

export function createCrossingKeyApp() {
  return constructed.app;
}

export async function startCrossingKeyServer(options = {}) {
  return constructed.start(options);
}

if (process.env.CK_NO_LISTEN !== 'true') {
  startCrossingKeyServer().then(({ port }) => {
    console.log(`CrossingKey MCP: http://127.0.0.1:${port}/mcp`);
  });
}
