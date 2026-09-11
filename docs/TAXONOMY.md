# CrossingKey MCP taxonomy

## .xkey
Machine-readable language / governed instruction artifact format.

Potential commercial surface after implementation verification:
- xkey.validate
- xkey.inspect
- xkey.compile
- xkey.package

## Agentic OS
Execution, orchestration, governance and operator runtime.

The verified Rust `xkey` binary is classified as `agenticos.operator-control-plane`.
It is not the `.xkey` language itself and remains operator-facing.

## CCMB
Continuity, state, evidence and receipt substrate. It should not expose arbitrary crawler/database mutation to public clients.

## AAPCL
Commercial/procurement transaction state layer.

## MCP
External machine interface and capability broker.

## Payment adapters
Stripe prepaid credits are the current verified production-safe commercial rail. Other settlement adapters may be added independently after verification.
