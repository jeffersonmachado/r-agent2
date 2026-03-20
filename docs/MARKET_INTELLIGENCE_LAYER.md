# Market Intelligence Layer

## 1. Visao

O `Market Intelligence Layer` permite que a plataforma aprenda com todos os tenants, sem quebrar o isolamento operacional de cada um.

Ele transforma o sistema de:

- IA por tenant

para:

- IA com aprendizado coletivo da plataforma

Essa camada nao substitui o `Tenant Intelligence Core`. Ela fica acima dele, consolidando benchmarks, padroes, previsoes e playbooks derivados de dados anonimizados e agregados.

## 2. Papel da camada

O papel do `Market Intelligence Layer` e permitir:

- benchmarks
- padroes
- previsoes
- recomendacoes baseadas em mercado

Na pratica, a camada usa sinais agregados da plataforma para responder como o tenant esta posicionado em relacao a empresas semelhantes e quais estrategias apresentaram melhor resultado no conjunto anonymizado.

## 3. Posicionamento na arquitetura

```text
Operational Modules
        ↓
EventLedger
        ↓
Tenant Intelligence Core
        ↓
Tenant Operational State Engine
        ↓
Market Intelligence Layer
```

Leitura arquitetural:

- `Operational Modules` continuam sendo a origem dos eventos e metricas primarias
- `EventLedger` segue como trilha auditavel operacional
- `Tenant Intelligence Core` continua entregando inteligencia por tenant
- `Tenant Operational State Engine` consolida estado vivo do tenant
- `Market Intelligence Layer` adiciona aprendizado coletivo anonimo da plataforma

## 4. Perguntas que o sistema passa a responder

Com essa camada, o r-agent2 passa a responder perguntas como:

- "este tenant esta acima ou abaixo do mercado?"
- "qual estrategia funciona melhor para negocios semelhantes?"
- "qual metrica indica churn antes do cancelamento?"

Exemplos práticos:

- benchmark de `cancellation_rate` versus media do mercado por vertical
- padroes recorrentes de `churn_signal` em segmentos semelhantes
- playbooks com melhor taxa de sucesso para `no_show`
- previsoes de metrica guiadas por tendencia coletiva e benchmark atual

## 5. Regras de privacidade

Essa camada **nunca** deve expor dados individuais de tenants.

Somente podem sair dessa camada:

- agregacoes
- estatisticas
- padroes anonimos

Regras obrigatorias:

- nao expor tenant individual de referencia
- nao retornar linhas brutas de eventos de outros tenants
- nao duplicar dados operacionais sensiveis fora do contexto necessario
- priorizar metricas agregadas por `vertical`, `region` e janela temporal
- manter toda comparacao em formato seguro, resumido e nao identificavel

## 6. Estrutura implementada

### Core

- `api/core/market-intelligence/MarketBenchmarkEngine.js`
- `api/core/market-intelligence/MarketPatternEngine.js`
- `api/core/market-intelligence/MarketPredictionEngine.js`
- `api/core/market-intelligence/MarketRecommendationEngine.js`
- `api/core/market-intelligence/MarketKnowledgeService.js`

### Persistencia

- `api/db/models/MarketMetricAggregate.js`
- `api/db/models/MarketBenchmark.js`
- `api/db/models/MarketPattern.js`
- `api/db/models/MarketPrediction.js`
- `api/db/models/MarketPlaybook.js`

### API

- `api/serverHandlers/marketIntelligenceRoutes.js`

## 7. Entidades da camada

### MarketMetricAggregate

Armazena metricas agregadas de mercado:

- `vertical`
- `region`
- `metric_key`
- `period_start`
- `period_end`
- `avg_value`
- `median_value`
- `p90_value`
- `sample_size`
- `metadata`

### MarketBenchmark

Representa a posicao relativa de um tenant em relacao ao mercado:

- `tenant_key`
- `metric_key`
- `tenant_value`
- `market_avg`
- `market_median`
- `percentile`
- `evaluated_at`
- `metadata`

### MarketPattern

Armazena padroes anonimizados detectados:

- `vertical`
- `pattern_type`
- `description`
- `confidence`
- `evidence`
- `detected_at`
- `metadata`

Exemplo:

- `pattern_type = churn_signal`
- descricao: clientes que faltam duas vezes seguidas tem alta chance de cancelamento

### MarketPrediction

Guarda previsoes por tenant geradas a partir de benchmark e tendencia:

- `tenant_key`
- `prediction_type`
- `target_metric`
- `predicted_value`
- `confidence`
- `prediction_window`
- `evidence`
- `generated_at`
- `metadata`

### MarketPlaybook

Armazena playbooks validados por dados agregados:

- `vertical`
- `problem_type`
- `playbook_name`
- `description`
- `success_rate`
- `evidence`
- `metadata`

Exemplo:

- `problem_type = no_show`
- `playbook_name = double_confirmation_flow`

## 8. Engines

### MarketBenchmarkEngine

Responsavel por calcular a posicao relativa do tenant:

```json
{
  "metric": "no_show_rate",
  "tenant_value": 0.21,
  "market_avg": 0.17,
  "percentile": 74,
  "status": "above_market"
}
```

### MarketPatternEngine

Responsavel por detectar e listar padroes anonimizados do mercado, como:

- churn signals
- horarios com maior cancelamento
- canais com maior conversao
- padroes de abandono

### MarketPredictionEngine

Responsavel por gerar previsoes como:

- churn probability
- demand forecast
- conversion probability

### MarketRecommendationEngine

Responsavel por sugerir acoes baseadas em benchmark e playbooks de mercado.

Exemplo:

- cancelamentos acima da media de mercado
- recomendacao de playbook de confirmacao

### MarketKnowledgeService

Servico central que integra os engines e expõe:

- `getBenchmarks(tenantKey)`
- `getMarketPatterns(vertical)`
- `getPredictions(tenantKey)`
- `getMarketPlaybooks(vertical)`

## 9. Integracao com Operational State

O `Market Intelligence Layer` alimenta o `TenantOperationalStateEngine` com:

- bloco `market`
- riscos derivados de benchmark
- oportunidades derivadas de benchmark
- prioridades recomendadas por mercado

Exemplo:

- `tenant cancellation_rate = 24%`
- `market average = 17%`
- gera risco `above_market_cancellation`

Como o repositório ainda nao possui `OperationalRiskEngine`, `OperationalOpportunityEngine` e `OperationalPriorityEngine` como classes separadas, essa integracao foi incorporada diretamente ao `TenantOperationalStateEngine`, preservando compatibilidade com a arquitetura atual.

## 10. APIs

Rotas implementadas:

- `GET /api/market/benchmarks`
- `GET /api/market/patterns`
- `GET /api/market/predictions`
- `GET /api/market/playbooks`

Regras:

- exigem autenticacao
- exigem permissao de leitura analitica
- respeitam `tenant_key`
- recusam acesso cruzado entre tenants
- mantem a logica de negocio dentro dos engines

## 11. Valor estrategico

Essa camada permite que o r-agent2:

- aprenda com todos os tenants
- detecte padroes do mercado
- antecipe riscos
- recomende estrategias comprovadas

Quanto mais tenants utilizarem a plataforma, melhor fica a inteligencia agregada da plataforma.

Isso cria vantagem competitiva estrutural, mantendo seguranca, anonimato e rastreabilidade.
