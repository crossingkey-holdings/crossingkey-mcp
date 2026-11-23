import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAID_CAPABILITIES,
  PAID_CAPABILITY_NAMES,
  publicCapabilityDescriptor
} from '../lib/paid-capability-catalog.mjs';
import {
  PAID_TOOL_NAMES,
  MCP_TOOL_MANIFEST
} from '../lib/mcp-manifest.mjs';

test('paid MCP manifest is generated from the canonical paid capability catalog', () => {
  assert.deepEqual(PAID_TOOL_NAMES, PAID_CAPABILITY_NAMES);
  assert.deepEqual(MCP_TOOL_MANIFEST.paidTools, PAID_CAPABILITY_NAMES);
  assert.equal(new Set(PAID_TOOL_NAMES).size, PAID_TOOL_NAMES.length);
  assert.equal(PAID_CAPABILITIES.length, PAID_TOOL_NAMES.length);
});

test('every canonical paid capability has a complete public descriptor', () => {
  for (const capability of PAID_CAPABILITIES) {
    const descriptor = publicCapabilityDescriptor(
      capability,
      'https://mcp.example',
      'eip155:8453'
    );
    assert.equal(descriptor.name, capability.name);
    assert.equal(descriptor.paid, true);
    assert.equal(descriptor.rail, 'x402');
    assert.equal(descriptor.price.amountAtomic, capability.amount);
    assert.equal(descriptor.price.network, 'eip155:8453');
    assert.equal(descriptor.execution, `https://mcp.example${capability.executionPath}`);
    assert.equal(descriptor.inputSchema, capability.inputJsonSchema);
    assert.equal(descriptor.output, capability.output);
  }
});

test('paid capability names are unique and deterministic', () => {
  assert.deepEqual(PAID_CAPABILITY_NAMES, [...PAID_CAPABILITY_NAMES].sort());
  assert.equal(PAID_CAPABILITY_NAMES.length, new Set(PAID_CAPABILITY_NAMES).size);
});
