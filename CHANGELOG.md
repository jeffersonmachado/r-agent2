# Changelog

Todas as mudanças significativas neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
e este projeto adere à [Versionamento Semântico](https://semver.org/spec/v2.0.0.html).

## Ondas Arquiteturais de Convergência

### [Onda 19] - 2026-03-11

#### Objetivo
Permitir remoção gradual e segura de shims legados com modo estrito controlável por flag.

#### Added
- Suporte a modo estrito para shims legados via `OPERATIONAL_AGENT_SHIM_STRICT=true|1|on|strict`.
- Erro explícito `OperationalAgentShimBlocked` ao importar shim em modo estrito.
- Testes focados para validar:
  - warning único por shim legado
  - warnings independentes por diferentes shims
  - bloqueio de import em strict mode
- Job dedicado no CI (`Operational Agent Shim Strict`) para validação em staging/PR.

#### Changed
- API de deprecação centralizada em `api/core/operational-agent/deprecation.js` com suporte a strict mode.
- Pipeline de CI com controle de enforcement via `OPERATIONAL_AGENT_SHIM_STRICT_ENFORCE`:
  - `0` (default): modo observabilidade (`continue-on-error=true`)
  - `1` (fase 2): modo bloqueante (`continue-on-error=false`)

#### Deprecated
- Imports legados via shims de `operational-agent` seguem suportados.
- Formalmente marcados para descontinuação com timeline clara de migração.

#### Test Status
- `OperationalAgentShimDeprecation.test.js`: ✅ 3 testes
- `OperationalAgentIndex.test.js`: ✅ 2 testes

#### Rollout Strategy
- **Fase 1 (atual)**: observabilidade em staging/PR, sem bloqueio (default).
- **Fase 2**: endurecimento opcional via `OPERATIONAL_AGENT_SHIM_STRICT_ENFORCE=1` quando imports legados forem eliminados.

---

### [Onda 18] - 2026-03-10

#### Objetivo
Adicionar deprecation warnings por shim legado com teste focado.

#### Added
- Deprecation warnings por shim importado de `operational-agent`.
- Teste `OperationalAgentShimDeprecation.test.js` validando warnings únicos.
- Error code `OperationalAgentShimDeprecated` para rastreabilidade.

#### Changed
- Shims de `operational-agent` agora emitem warning one-time ao importar.

---

### [Onda 17] - 2026-03-09

#### Objetivo
Normalizar imports de compatibilidade para usar índice lazy de `operational-agent`.

#### Changed
- API de compatibilidade refatorada para lazy loading via `operational-agent/index.js`.
- Redução de imports diretos a shims específicos em favor do entrypoint centralizado.

---

### [Onda 16] - 2026-03-08

#### Objetivo
Adicionar mais warnings de deprecação para surface de compatibilidade.

#### Added
- Warnings estendidos para export legados do index.
- Error code `OperationalAgentIndexDeprecatedExport` para rastreabilidade.

---

### [Onda 15] - 2026-03-07

#### Objetivo
Criar índice lazy de compatibilidade em `operational-agent`.

#### Added
- Índice de compatibilidade em `api/core/operational-agent/index.js` com lazy loading.

---

### [Onda 14] - 2026-03-06

#### Objetivo
Depreciar service-level entrypoint com warning.

#### Added
- Warning one-time em `OperationalAgentService` com error code `OperationalAgentServiceDeprecated`.

---

### [Onda 13] - 2026-03-05

#### Objetivo
Testar conformidade de OperationalAgentService como delegador.

#### Added
- Testes `OperationalAgentService.test.js` validando delegação ao kernel.

---

### [Onda 12] - 2026-03-04

#### Objetivo
Normalizar imports nos testes para usar módulos canônicos diretos.

#### Changed
- `api/server.test.js` refatorado para imports canônicos.
- Testes agora usam kernel + spies em vez de operational-agent.

---

### [Onda 11] - 2026-03-03

#### Objetivo
Remover warnings da camada de compatibilidade, usando apenas compatibilidade estrutural.

#### Changed
- Removidas warnings de export durante refator.
- Compatibilidade mantida apenas por interface.

---

### [Onda 10] - 2026-03-02

#### Objetivo
Mover shims de modules canônicos para `operational-agent` (compatibilidade).

#### Changed
- `OperationalSignalRegistry`, `SignalService`, etc. criados em módulos canônicos.
- Shims de `operational-agent` agora se referem aos canônicos.

---

### [Onda 9] - 2026-03-01

#### Objetivo
Refatorar em torno de `ServiceOperationsKernel` como orquestrador canônico.

#### Added
- `ServiceOperationsKernel` como entrypoint de operações canônico.
- Padrões de lazy loading para evitar dependências circulares.

#### Changed
- `OperationalEventBus`, `OperationalPlaybookEngine`, `QuickActionAccess` refatorados.

---

## Notas de Integração

- Todas as ondas mantêm compatibilidade regressiva durante fases de transição.
- Testes validam tanto comportamento canônico quanto caminhos legados.
- Documentação detalhada em `docs/16-architectural-convergence-waves.md`.

---

## Próximas Ondas Previstas

- **Onda 20**: Remove efetivamente shims quando imports legados forem eliminados (fase 2 do enforcement).
- **Roadmap**: Consolidação final de `operational-agent` em camada de compatibilidade pura.
