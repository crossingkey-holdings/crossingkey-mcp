export interface X402Option {
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  amount: string;
  maxTimeoutSeconds: number;
  [key: string]: unknown;
}

export interface X402Challenge {
  x402Version: 1 | 2;
  accepts: readonly X402Option[];
  selected: X402Option;
  network: string;
  asset: `0x${string}`;
  payTo: `0x${string}`;
  amount: string;
  maxTimeoutSeconds: number;
  [key: string]: unknown;
}

export class X402ProtocolError extends Error { challenge?: X402Challenge; }
export class X402PaymentRequiredError extends X402ProtocolError { }
export class X402AuthorizationRequiredError extends X402ProtocolError { }
export class X402SettlementError extends X402ProtocolError { }

export function parsePaymentRequired(value: string | object, options?: { expectedNetwork?: string }): X402Challenge;
export function decodePaymentHeader(value: string): object;

export interface BuyerPaymentClientOptions {
  fetchImpl?: typeof fetch;
  approve?: (context: { challenge: X402Challenge; idempotencyKey: string; request: RequestInfo }) => Promise<boolean> | boolean;
  sign?: (context: { challenge: X402Challenge; idempotencyKey: string; request: RequestInfo }) => Promise<string> | string;
  expectedNetwork?: string;
}

export class BuyerPaymentClient {
  constructor(options?: BuyerPaymentClientOptions);
  request(input: RequestInfo, init?: RequestInit & { idempotencyKey?: string }): Promise<{
    response: Response;
    data: unknown;
    paid: boolean;
    receipt?: object | null;
  }>;
  requestJson(input: RequestInfo, body: unknown, init?: RequestInit & { idempotencyKey?: string }): Promise<unknown>;
}

export interface Eip1193Provider { request(args: { method: string; params?: unknown[] }): Promise<unknown>; }
export function createBrowserWalletClient(options: {
  wallet: Eip1193Provider;
  approve: BuyerPaymentClientOptions["approve"];
  signPayment: (context: { challenge: X402Challenge; idempotencyKey: string; request: RequestInfo; wallet: Eip1193Provider }) => Promise<string> | string;
  fetchImpl?: typeof fetch;
  expectedNetwork?: string;
}): BuyerPaymentClient;
export const DEFAULT_NETWORK: "eip155:8453";
