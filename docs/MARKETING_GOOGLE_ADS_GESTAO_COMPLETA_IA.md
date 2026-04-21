# Marketing Google Ads - Gestão Completa com Supervisão por IA

Este documento descreve o alvo arquitetural para transformar a integração atual de Google Ads em uma gestão completa, detalhada e supervisionada por IA.

## Estado atual

Já existe hoje:

- configuração segura por tenant
- armazenamento criptografado de segredos
- captura de atribuição (`gclid`, `gbraid`, `wbraid`, `utm_*`)
- conversões offline
- upload de conversões
- sincronização de desempenho por keyword e search term
- recomendações heurísticas
- resumo analítico por IA

Isso cobre a base de leitura, diagnóstico e recomendação.

## O que define gestão completa

Uma gestão completa de Ads com supervisão por IA exige fechar o ciclo abaixo:

1. coletar dados da conta
2. consolidar desempenho em histórico local
3. medir ROI/ROAS de forma reconciliada
4. gerar recomendações explicáveis
5. aprovar por política ou humano
6. executar mudanças na conta
7. monitorar impacto pós-mudança
8. aprender com resultados

## Componentes ainda faltantes

### 1. Escrita de volta na Google Ads API

Falta implementar mutações como:

- incluir keyword
- negativar termo
- remover ou pausar keyword
- ativar novamente keyword
- ajustar bids
- ajustar orçamento de campanha

Sem isso, a IA sugere, mas não opera o ciclo completo.

### 2. Workflow de aprovação supervisionada

Falta uma fila de recomendações com:

- status `draft`, `approved`, `rejected`, `applied`, `failed`, `rolled_back`
- score de confiança
- explicação técnica
- impacto esperado
- aprovador humano
- timestamp de decisão

Isso é o núcleo da supervisão por IA.

### 3. Scheduler e automação recorrente

Falta rodar automaticamente:

- sync diário de keywords/search terms
- análise recorrente por tenant
- reprocessamento incremental
- alertas por deterioração de performance

### 4. ROI e ROAS por entidade

Falta fechar cálculo por:

- campanha
- ad group
- keyword
- search term
- janela temporal

Métricas-alvo:

- custo
- receita atribuída
- conversões
- CPA
- ROAS
- ROI líquido
- custo operacional agregado

### 5. Governança operacional

Faltam regras como:

- limite máximo de mudanças por execução
- limite percentual de alteração de bid/orçamento
- bloqueio em campanhas de alto spend sem aprovação humana
- fallback para modo sugestão apenas
- rollback auditável

### 6. Observabilidade ativa

Faltam alertas para:

- falha de sync
- falha de escrita na API
- aumento abrupto de CPC
- queda brusca de CTR
- search terms com gasto sem conversão
- campanhas com volume anormal

### 7. UI dedicada de gestão

Falta uma interface especializada com:

- visão por campanha, grupo, keyword e search term
- fila de recomendações
- filtros por severidade e impacto
- aprovação/rejeição em lote
- histórico de mudanças
- explicação da IA e comparação antes/depois

### 8. Memória de decisão da IA

Falta registrar:

- o que a IA sugeriu
- o que o gestor aprovou ou rejeitou
- o que foi aplicado
- o efeito posterior no desempenho

Essa memória é necessária para calibrar confiança e reduzir recomendações ruins repetidas.

## Roadmap recomendado

### Fase 1. Operação assistida

- sync automático
- análise recorrente
- dashboard analítico
- fila de recomendações sem execução automática

### Fase 2. Supervisão com aprovação

- ações de inclusão/negativação/pausa
- aprovação humana obrigatória
- auditoria completa
- rollback operacional

### Fase 3. Auto-otimização controlada

- autoaprovação de ações de baixo risco
- regras por tenant
- aprendizado por resultado histórico
- alertas e contenção automática

## Regra prática de segurança

A IA não deve começar executando mudanças destrutivas por padrão. A ordem segura é:

1. sugerir
2. justificar
3. solicitar aprovação
4. aplicar
5. medir impacto

## Resultado esperado

Quando todas as camadas acima estiverem prontas, a plataforma passa a operar Google Ads como um sistema fechado de otimização supervisionada:

- coleta completa
- análise detalhada
- explicação por IA
- decisão assistida
- execução auditável
- aprendizado contínuo