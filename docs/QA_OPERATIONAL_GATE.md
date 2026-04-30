# QA Mesh Operational Gate & Auto-Adaptation System

## 🎯 Objetivo

Implementar controle operacional baseado em decisões de QA Mesh, transformando o sistema de "observador" para "controlador" que:

1. **Detecta falhas** via QA Mesh governance
2. **Limita operação** baseado em severidade
3. **Propõe correções** via AutoCorrection
4. **Valida em sandbox** isolado
5. **Aprova ou rejeita** automaticamente com rastreabilidade

---

## 🏗️ Arquitetura

### 1. **OperationalGateService**
**Localização:** `api/services/qa/OperationalGateService.js`

Mapeia decisões de governance para modos operacionais:

```javascript
GO → FULL (operação completa)
GO_WITH_WARNINGS → MONITORING (logs extras)
REVIEW → LIMITED (operação restrita)
NO_GO → BLOCKED (leitura apenas)
```

**Exemplo:**
```javascript
const gate = new OperationalGateService();
const response = gate.evaluateOperationalGate({
  decision: 'REVIEW',
  reason: 'High severity checks failed',
  severity: 'high'
});
// {allowed: true, mode: 'LIMITED', ...}
```

---

### 2. **ValidationSandboxService**
**Localização:** `api/services/qa/ValidationSandboxService.js`

Cria ambientes isolados para testar patches sem afetar produção:

```javascript
const sandbox = service.createSandbox({
  tenantId: 'tenant-1',
  sourceRunId: 'run-123'
});
// sandbox.isolatedTenantId = "tenant-1:sandbox_abc123"

// Aplica patch no sandbox
service.applyPatchInSandbox(sandbox.id, proposedPatch);

// Registra resultado de QA no sandbox
service.recordQAResult(sandbox.id, qaResult);

// Limpa depois
service.destroySandbox(sandbox.id);
```

---

### 3. **AutoCorrectionDecisionService**
**Localização:** `api/services/qa/AutoCorrectionDecisionService.js`

Decide se patch deve ser aprovado baseado em QA no sandbox:

```javascript
const decision = service.evaluateApproval({
  diagnosis: {...},
  proposedPatch: {...},
  sandboxQAResult: {...}  // resultado de QA no sandbox
});
// {approved: true, confidence: 0.95, recommendation: 'safe_to_apply', ...}
```

**Regras:**
- Sandbox GO → Aprovado (safe)
- Sandbox GO_WITH_WARNINGS → Aprovado com monitoramento
- Sandbox REVIEW + alta confiança → Aprovado com restrição
- Sandbox NO_GO → Rejeitado

---

## 🔄 Ciclo de Auto-Adaptação

```
Falha detectada
        ↓
[QA Mesh] Governance REVIEW/NO_GO
        ↓
[AutoCorrection] Diagnóstico + Patch proposto
        ↓
[Sandbox] Cria ambiente isolado
        ↓
[Sandbox] Aplica patch
        ↓
[QA Mesh] Executa novamente no sandbox
        ↓
[Decision] Avalia resultado
        ↓
┌─── Sandbox GO?
│   └→ Aprovado → Aplicar patch (opcional)
│
└─── Sandbox NO_GO?
    └→ Rejeitado → Rollback + Review humano
```

---

## 🛣️ Endpoints

### GET `/qa/operational-status`
Retorna status operacional atual:

```json
{
  "mode": "FULL",
  "allowed": true,
  "decision": "GO",
  "reason": "All checks passed",
  "severity": "low",
  "statusMessage": "✅ [FULL] Operação completa — All checks passed",
  "lastWave": "workspace-core",
  "timestamp": "2026-04-30T..."
}
```

### POST `/qa/operational-status/update-governance`
Atualiza governance (chamado após QA executar):

```json
{
  "governance": {
    "decision": "REVIEW",
    "reason": "High severity checks failed",
    "severity": "high",
    "failedChecks": ["ticketLinked"]
  },
  "wave": "workspace-core"
}
```

### POST `/qa/operational-status/check-operation`
Verifica se operação é permitida:

```json
{
  "operationType": "mass_send"
}
→
{
  "allowed": false,
  "blocked": true,
  "mode": "LIMITED",
  "reason": "Operation 'mass_send' is blocked in LIMITED mode"
}
```

---

## 🧠 Modos Operacionais

### FULL
- ✅ Todas operações permitidas
- ✅ Sem restrições
- ℹ️ Logs normais

### MONITORING
- ✅ Todas operações permitidas
- 📊 Logs extras
- 📌 WorkspaceInsight criado
- ⚠️ Observabilidade aumentada

### LIMITED
- ✅ Leitura permitida
- ✅ Ações manuais permitidas
- ❌ Automações bloqueadas
- ❌ Mass send bloqueado
- ❌ RPA autônomo bloqueado
- ✅ Outbound manual permitido

### BLOCKED
- ✅ Leitura permitida
- ❌ Todas operações de escrita bloqueadas
- ❌ Outbound bloqueado
- ❌ RPA bloqueado
- ❌ Automações bloqueadas
- 📋 UI análise e logs permitidos

---

## 🔐 Middleware: operationalGate

**Localização:** `api/middleware/operationalGate.js`

Protege operações críticas:

```javascript
const gate = operationalGateMiddleware({ logger, governanceSource });

// Verificar operação
const check = await gate.evaluateOperation('mass_send');
// {allowed: true/false, mode: '...', decision: '...', ...}

// Express middleware para rota crítica
app.post('/send-message', gate.protectCriticalOperation('outbound_call'), handler);

// Se operação bloqueada → 423 (Locked)
```

---

## 📊 Testes

### Testes Unitários (23 testes)
**Arquivo:** `tests/unit/qaOperationalGate.test.js`

Cobre:
- OperationalGateService
- ValidationSandboxService
- AutoCorrectionDecisionService

### Testes de Integração (5 testes)
**Arquivo:** `tests/integration/qaAutoAdaptationCycle.test.js`

Cobre ciclos completos:
- ✅ Falha → Patch aprovado
- ✅ Falha → Patch rejeitado (piora situação)
- ✅ Falha → Patch com warnings (aprovado condicional)
- ✅ Bloqueado → Recuperado → Liberado
- ✅ Múltiplos sandboxes em paralelo

---

## 🎯 Próximos Passos

1. **SystemChangeLog** (DB): Registrar todas mudanças aplicadas
2. **Integração com Workspace**: Timeline, insights, actions
3. **Evolução AutoCorrectionService**: Pipeline completo com sandbox
4. **UI**: Exibir status operacional + histórico de mudanças
5. **Testes end-to-end**: Fluxo real de correção automática

---

## 💡 Exemplo de Uso

```javascript
// 1. QA Mesh executa e retorna REVIEW
const governance = {
  decision: 'REVIEW',
  reason: 'High severity checks failed',
  failedChecks: ['ticketLinked']
};

// 2. Gate limita operação
const gate = new OperationalGateService();
const response = gate.evaluateOperationalGate(governance);
// mode: 'LIMITED'

// 3. AutoCorrection propõe fix
const diagnosis = {...};  // análise do problema
const patch = {...};      // solução proposta

// 4. Valida em sandbox
const sandbox = sandboxService.createSandbox({tenantId, sourceRunId});
sandboxService.applyPatchInSandbox(sandbox.id, patch);
const qaResult = runQAInSandbox(sandbox.isolatedTenantId);  // simula execução

// 5. Decision service decide
const decision = decisionService.evaluateApproval({
  diagnosis,
  proposedPatch: patch,
  sandboxQAResult: qaResult
});

if (decision.approved) {
  // Aplicar patch → Atualizar governance → Liberar operação
}
```

---

## 🚨 Segurança & Controles

✅ **Sempre com validação**: Patch não é aplicado sem aprovação de QA
✅ **Sandbox isolado**: Mudanças testadas sem afetar produção
✅ **Reversível**: Toda mudança é rastreada e pode ser desfeita
✅ **Auditável**: Logs completos de todas decisões
✅ **Com fallback**: Se erro técnico → MONITORING (nunca perde operação)
✅ **Controle humano**: Últimas decisões críticas são manuais

---

## 📈 Métricas Disponíveis

```javascript
const metrics = sandboxService.getSandboxMetrics();
// {
//   total: 3,
//   active: 2,
//   withQAResults: 2,
//   averagePatchesPerSandbox: 1.33
// }
```

---

## 🧠 Confiança (0-1)

A Decision Engine calcula confiança considerando:

1. **Confiança do diagnóstico**: 0-1 (quanto o sistema confia na raiz causa)
2. **Resultado de QA**: +0.25 se GO, +0.15 se GO_WITH_WARNINGS, etc
3. **Complexidade do patch**: +0.15 se simples, -0.1 se complexo

Exemplo:
- Diagnóstico 0.9 + QA GO (0.25) + Patch simples (0.15) = 0.90+

---

## 🔄 Fluxo Real

```
Workspace recebe requisição
        ↓
[Gate] Avalia se permitido
        ↓
✅ Permitido → Executa operação
❌ Bloqueado → Retorna 423 Locked
⚠️ Limited → Executa com restrições
```

**Conclusão:** Sistema passa de "reativo" (detecta falhas) para "proativo" (previne degradação).
