# QA Waves UI (isolado em /dev)

Implementacao funcional para gerenciamento de ondas, execucao seletiva e visualizacao de replays em ambiente isolado.

## Estrutura

- frontend: React + Vite, interface modular
- backend: Node + Express, rotas mock organizadas em controller/service/repository
- shared/contracts: contratos de dados para integracao futura
- mock: exemplos de payload
- docs: documentacao de endpoints

## Como rodar

1. Instalar dependencias no modulo:

```bash
cd dev/qa-waves-ui
npm install
npm --prefix backend install
npm --prefix frontend install
```

2. Subir backend e frontend juntos:

```bash
npm run dev
```

Opcional para rodar backend apenas em mock:

```bash
QA_WAVES_FORCE_MOCK=1 npm run dev:backend
```

3. Acessos:
- Frontend: http://localhost:5176
- Backend: http://localhost:4176/api

## Endpoints principais

- GET /api/waves
- POST /api/executions
- GET /api/executions/:executionId
- GET /api/replays
- GET /api/replays/:replayId
- POST /api/replays/:replayId/reexecute

## Contratos implementados

Contrato em [shared/contracts/models.contract.json](shared/contracts/models.contract.json), cobrindo:
- Wave
- WaveItem
- ExecutionRequest
- ExecutionResult
- Replay
- ReplayFilter

## Fluxos cobertos

- Visualizacao de ondas com expansao de itens
- Selecao por onda inteira e por itens
- Estado parcial de selecao por onda
- Execucao seletiva com fila e status por item
- Persistencia de execucao em memoria (mock)
- Geracao de replay a cada item executado
- Painel de replays com filtros compostos por data+hora
- Detalhes de replay e reexecucao

## Exemplo de payload de execucao

```json
{
  "selectedWaveIds": ["wave-onboarding"],
  "selectedItemIds": ["item-reneg", "item-open-ticket"]
}
```

## Exemplo de filtro de replay por data/hora

```http
GET /api/replays?startDate=2026-04-20&startTime=08:00&endDate=2026-04-21&endTime=18:30&status=failure&channel=whatsapp
```

## Integracao futura com dados reais

Pontos de substituicao planejados:

1. Backend repository [backend/src/repositories/stateRepository.js](backend/src/repositories/stateRepository.js)
   - Ja faz leitura hibrida de fonte real quando disponivel:
     - qa-mesh/meshRegistry.json
     - qa-mesh/system-validate/meshEvidence/*/scenarios/*.json
   - Mantem fallback automatico para mocks se fonte real nao estiver disponivel.

2. Contratos compartilhados [shared/contracts/models.contract.json](shared/contracts/models.contract.json)
   - Manter payloads compatveis entre mock e integracao real.

3. Servicos frontend em [frontend/src/services](frontend/src/services)
   - Mantem camada HTTP desacoplada para troca de endpoints sem alterar componentes.

## Observacoes

- Tudo esta isolado em /dev/qa-waves-ui e nao altera o fluxo principal da aplicacao.
- Estado atual de execucao/replay e em memoria do processo backend (mock), ideal para QA exploratorio.
- GET /api/replays suporta paginacao por `page` e `pageSize`.

## Testes backend

```bash
cd backend
npm test
```

Os testes validam:
- filtro composto de data+hora
- consistencia de paginacao
