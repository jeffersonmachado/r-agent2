# QA Waves Semantico (IA + Manual + Replay Unificado)

## Objetivo

Este modulo permite construir e executar cenarios de QA Waves com passos semanticos (foco em comportamento de negocio), seeds variaveis e replay unificado no mesmo storage/endpoints de RPA:

- `GET /tests/rpa/replay`
- `GET /tests/rpa/replay/:filename`
- UI de visualizacao em `/rpa-replays`

Nao ha player paralelo nem storage paralelo.

## Passos Semanticos vs UI-Based

UI-based valida elementos visuais (clique em botao, seletor, xpath).

Semantic-based valida comportamento de negocio e contrato da plataforma (intencao, backend, fallback, transicao de fluxo, SLA, eventos).

### Proibido (bloqueado)

- `click`
- `click_button`
- `fill_input`
- `xpath`
- `css_selector`
- `selenium_action`
- `open_modal`
- `click_dropdown`

### Permitido

- `send_message`
- `validate_intent`
- `provide_data`
- `validate_response`
- `check_availability`
- `select_slot`
- `create_booking`
- `create_payment`
- `validate_backend`
- `validate_sla`
- `validate_context`
- `validate_fallback`
- `validate_flow_transition`
- `validate_access_release`
- `wait_for_event`
- `trigger_channel_event`

## Endpoints

### Inferir cenario com IA

`POST /dev/qa-waves/infer-scenario`

Alias: `POST /api/qa-waves/infer-scenario`

Entrada:

```json
{
  "vertical": "fitness",
  "journey": "cliente_novo",
  "goal": "aula experimental",
  "channels": ["whatsapp", "chat"],
  "constraints": {
    "semanticStepsOnly": true,
    "platformCompatibleOnly": true,
    "generateSeeds": true
  }
}
```

Saida:

```json
{
  "scenario": { "id": "..." },
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": []
  }
}
```

### Gerar seeds

`POST /dev/qa-waves/generate-seeds`

Alias: `POST /api/qa-waves/generate-seeds`

### Validar cenario

`POST /dev/qa-waves/validate-scenario`

Alias: `POST /api/qa-waves/validate-scenario`

### Salvar cenario versionado

`POST /dev/qa-waves/save-scenario`

Alias: `POST /api/qa-waves/save-scenario`

Cada salvamento gera nova versao `vN` e historico:

```json
{
  "version": "v2",
  "changedBy": "manual",
  "changedAt": "...",
  "changes": []
}
```

### Rodar execucao real (QA Mesh)

`POST /dev/qa-waves/run`

Alias: `POST /api/qa-waves/run`

Regras:

- `mode` deve ser `real`
- replay deve estar habilitado
- cenario invalido nao executa
- runner usa QA Mesh real (`qaMeshService.queueMeshRun`)

Resposta inclui `executionId` e `replayId`.

## Validacoes de compatibilidade

Antes de salvar/executar:

- step permitido
- step proibido ausente
- adapter valido
- channel suportado
- entity conhecida
- IDs de steps unicos
- order consistente
- status de seeds valido
- replay habilitado
- ao menos um step executavel
- ao menos uma validacao

## Exemplo funcional obrigatorio (bootstrap)

Cenario criado automaticamente no store:

- Wave: `fitness-cliente-novo`
- Journey: `cliente_novo`
- Scenario: `fitness_trial_class` (Aula experimental)
- Seeds: `seed_001` ... `seed_005`

Com tags e mapeamento de plataforma para QA Mesh (`business-f1`).

## UI `/dev/qa-waves`

Fluxo principal da pagina integrada:

1. Selecionar dominio/jornada
2. Inferir cenario por IA
3. Editar JSON manualmente
4. Reordenar/ativar/desativar steps
5. Gerar seeds IA
6. Revisar/aprovar/promover seeds para regressao
7. Salvar nova versao
8. Executar cenario real ou wave inteira real
9. Abrir replay real em `/rpa-replays?replayId=<id>`

Leitura operacional atual da tela:

- `GET /api/test-executions/qa-waves/journeys`
- `GET /api/test-executions/qa-waves/journey-status`
- `GET /api/test-executions/qa-waves/step-status`
- `GET /api/test-executions/qa-waves/scenarios`

Contrato de smoke atual:

- `tests/smoke-test-qa-waves-unified.js` deve observar apenas leituras em `/api/test-executions/qa-waves/*` e replays/execuções em `/api/test-executions/*`
- qualquer chamada remanescente em `/api/qa-waves/*` durante o smoke é tratada como falha

## Governanca

O pre-check da execucao considera:

- status do cenario
- validade semantica dos steps
- replay obrigatorio para approved
- tratamento de draft como warning

Se houver step invalido: `NO_GO` e execucao bloqueada.
