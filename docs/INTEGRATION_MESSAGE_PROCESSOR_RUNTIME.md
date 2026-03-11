# MessageProcessor + ProcessRuntimeService Integration

## Overview

Integração do `ProcessRuntimeService` (nova camada canônica) no `messageProcessor.js` com suporte a feature flag `CANONICAL_RUNTIME`.

## Status

✅ **Concluído e testado** (10/10 testes passando)

## Alterações Implementadas

### 1. Import do ProcessRuntimeService

```javascript
const { ProcessRuntimeService } = require('../core/process-runtime');
```

**Arquivo**: `api/services/messageProcessor.js` (linha 11)

### 2. Singleton com inicialização sob demanda

```javascript
let runtimeServiceInstance = null;

function getRuntimeService() {
  if (!process.env.CANONICAL_RUNTIME || process.env.CANONICAL_RUNTIME !== 'true') {
    return null;
  }
  if (!runtimeServiceInstance) {
    runtimeServiceInstance = new ProcessRuntimeService({
      logger,
      enableTelemetry: process.env.ENABLE_RUNTIME_TELEMETRY !== 'false',
    });
  }
  return runtimeServiceInstance;
}
```

**Benefícios**:
- Inicialização lazy (apenas quando feature flag ativa)
- Singleton garante uma única instância por processo
- Zero overhead quando `CANONICAL_RUNTIME` está desativado

### 3. Dual-path execution logic

```javascript
const runtimeService = getRuntimeService();
const useCanonicalRuntime = runtimeService !== null;

if (useCanonicalRuntime) {
  // Nova camada: ProcessRuntimeService com suporte a canônico
  logger.debug('[MessageProcessor] Usando ProcessRuntimeService (CANONICAL_RUNTIME=true)');
  result = await runtimeService.executeStep(state, compiledFlow, {/* options */});
} else {
  // Legacy: executeStep original (backward compatibility)
  result = await executeStep(state, compiledFlow, {/* options */});
}
```

**Localização**: `api/services/messageProcessor.js` linha ~418

## Feature Flag Behavior

| Flag | Comportamento | Teste |
|------|---------------|-------|
| `CANONICAL_RUNTIME` undefined | Legacy path | ✓ |
| `CANONICAL_RUNTIME=false` | Legacy path | ✓ |
| `CANONICAL_RUNTIME=true` | ProcessRuntimeService | ✓ |

## Environment Variables

```bash
# Ativa novo ProcessRuntimeService com suporte canônico
CANONICAL_RUNTIME=true

# Ativa telemetria durante execução (default: true)
ENABLE_RUNTIME_TELEMETRY=true
```

## Backward Compatibility

✅ **100% compatível** - Todas as flows legadas continuam funcionando:

- `FlowDefinition` tradicional: legado path
- Sem changes em handlers de nós
- SessionState mantém mesma estrutura
- Replay/Recording funcionam normalmente

## Testing

### Integration Tests

```bash
npx jest api/services/__tests__/messageProcessor.integration.test.js
```

**Cobertura**:
- ✓ Feature flag behavior
- ✓ Dual-path execution
- ✓ Toggle behavior
- ✓ Error handling
- ✓ Backward compatibility
- ✓ Interface contracts

**Resultado**: 10/10 testes ✓ (1.977s)

### Runtime Tests

```bash
npx jest api/core/process-runtime/__tests__/processRuntimeService.test.js
```

**Resultado**: 1/1 teste ✓ (0.559s)

## Deployment Checklist

- [x] Feature flag implemented
- [x] Backward compatibility validated
- [x] Unit tests passing
- [x] Integration tests passing
- [x] No breaking changes
- [ ] Deploy with `CANONICAL_RUNTIME=false` (default)
- [ ] Monitor logs for 24-48h
- [ ] Gradually enable per tenant
- [ ] Full rollout when stable

## Next Steps

1. **Deploy com flag desativado** (safe default)
2. **Monitor execution metrics** (ProcessRuntimeService logging)
3. **Enable for beta tenants** (internal team)
4. **Gradual rollout** (per-tenant feature flag)
5. **BPMN native adapters** (quando canonical routing estável)
6. **AI copilot UI** (quando runtime completo)

## Logging

Quando `CANONICAL_RUNTIME=true`, novo logging aparece:

```
[MessageProcessor] Usando ProcessRuntimeService (CANONICAL_RUNTIME=true)
{
  flowId: "flow-12345",
  sessionId: "whatsapp_5511999999999"
}
```

## Code Review Notes

- Função `getRuntimeService()` é privada (não exportada)
- Feature flag check é defensive (dupla verificação)
- Logger injection garante observabilidade
- ProcessRuntimeService configurável via env vars
- Zero breaking changes no contrato público

## Related Documentation

- [ProcessRuntimeService](../core/process-runtime/README.md)
- [CanonicalProcessArchitecture](../../frontend/src/process-canonical/README.md)
- [AdapterLayer](../../frontend/src/process-adapters/README.md)
