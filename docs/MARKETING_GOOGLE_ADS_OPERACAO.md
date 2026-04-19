# Marketing Google Ads

Este guia descreve a operação da integração de Google Ads no módulo de Marketing: configuração, registro de conversões offline, upload manual e gatilho automático quando um lead vira customer.

## Escopo atual

- Captura pública de `gclid`, `gbraid`, `wbraid` e `utm_*` no fluxo de landing page e tracking.
- Persistência canônica da atribuição no lead.
- Registro manual ou automático de conversões offline para Google Ads.
- Upload de conversões pendentes via Google Ads API.
- Sincronização de desempenho por keyword e search term.
- Recomendações heurísticas de inclusão, negativação e remoção/pausa.
- Execução manual de ações de keyword com suporte a dry-run.
- Resumo analítico por IA sobre portfólio de keywords e termos pesquisados.
- Segredos armazenados de forma criptografada no storage de credenciais do tenant.

## Operação pela interface

- A tela de Marketing já expõe a configuração do Google Ads, o sync de keywords/search terms, a análise consolidada e a aplicação manual das recomendações.
- A tela de Marketing também permite persistir recomendações em fila, aprovar, rejeitar e aplicar cada item individualmente.
- A tela de Marketing também exibe ROI/ROAS por campanha, ad group, keyword e search term com base nas métricas sincronizadas.
- O comportamento do botão de aplicar segue o `dryRun` salvo nas configurações do tenant.
- Quando `dryRun=true`, a interface valida a mutação no Google Ads sem efetivar a alteração.

## Pré-requisitos

- Migration aplicada: `20260418110000-create-marketing-ad-conversions.js`.
- Tenant com permissão para acessar o módulo de Marketing.
- `ENCRYPTION_KEY` configurada no ambiente para criptografia de credenciais.
- Credenciais válidas de Google Ads para o tenant:
  - `developerToken`
  - `clientId`
  - `clientSecret`
  - `refreshToken`
- Configuração pública mínima:
  - `enabled=true`
  - `customerId`
  - `defaultConversionActionId`

## Scheduler automático

O runtime agora pode atualizar a fila de recomendações automaticamente em background.

Variáveis de ambiente:

- `ENABLE_MARKETING_GOOGLE_ADS_SCHEDULER=true`
- `MARKETING_GOOGLE_ADS_SCHEDULER_INTERVAL_MS=300000`
- `MARKETING_GOOGLE_ADS_SCHEDULER_TENANT_LIMIT=50`
- `MARKETING_GOOGLE_ADS_AUTO_UPLOAD_ON_SCHEDULER=true`
- `MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_WINDOW_DAYS=1`
- `MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_MIN_EVENTS=3`
- `MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_GROWTH_FACTOR=2`
- `MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_COOLDOWN_MINUTES=60`

Comportamento:

- Descobre tenants com `google_ads.enabled=true`.
- Reexecuta a análise da janela padrão dos últimos 30 dias.
- Persiste novas recomendações na fila operacional.
- Se o tenant também tiver `autoUpload=true`, tenta enviar conversões pendentes no mesmo ciclo.
- Avalia crescimento anormal de `OrderMarketingAttributionMissing`; quando o volume recente cruza o mínimo e cresce acima do limiar, emite `MarketingGoogleAdsAttributionAlert` no event ledger com cooldown por tenant.
- O scheduler não escreve artefatos canônicos de arquivo; opera apenas em banco e event ledger.

## Endpoints

Todos os endpoints ficam sob `/api/marketing/google-ads`.

### 1. Ler configuração

- Método: `GET /api/marketing/google-ads/settings`
- Permissão: `config.read`

Exemplo de resposta:

```json
{
  "ok": true,
  "value": {
    "enabled": true,
    "customerId": "1234567890",
    "loginCustomerId": "",
    "defaultConversionActionId": "111222333",
    "defaultConversionName": "customer",
    "defaultCurrencyCode": "BRL",
    "dryRun": true,
    "autoUpload": false,
    "uploader": "google_ads_api",
    "hasDeveloperToken": true,
    "hasClientId": true,
    "hasClientSecret": true,
    "hasRefreshToken": true
  }
}
```

Observação: o retorno não expõe os segredos, apenas flags indicando sua presença.

### 2. Salvar configuração

- Método: `POST /api/marketing/google-ads/settings`
- Permissão: `config.update`
- Content-Type: `application/json`

Payload de exemplo:

```json
{
  "enabled": true,
  "customerId": "1234567890",
  "loginCustomerId": "",
  "defaultConversionActionId": "111222333",
  "defaultConversionName": "customer",
  "defaultCurrencyCode": "BRL",
  "dryRun": true,
  "autoUpload": false,
  "uploader": "google_ads_api",
  "developerToken": "google-ads-developer-token",
  "clientId": "oauth-client-id.apps.googleusercontent.com",
  "clientSecret": "oauth-client-secret",
  "refreshToken": "oauth-refresh-token"
}
```

Comportamento:

- Campos públicos ficam em `tenant_settings` com a chave `google_ads`.
- Segredos ficam criptografados em `tenant_ai_credentials` com provider `google_ads`.

### 3. Listar conversões

- Método: `GET /api/marketing/google-ads/conversions?status=pending&limit=100&offset=0`
- Permissão: `analytics.read`

Parâmetros:

- `status`: opcional, normalmente `pending`, `uploaded` ou `failed`.
- `limit`: opcional, padrão `100`, máximo `1000`.
- `offset`: opcional, padrão `0`.

Exemplo de resposta:

```json
{
  "ok": true,
  "total": 1,
  "items": [
    {
      "id": "madsconv-1745000000000-abcd1234",
      "tenant_key": "demo",
      "lead_id": "mlead-1",
      "platform": "google_ads",
      "click_id_type": "gclid",
      "click_id": "CjwK...",
      "conversion_name": "customer",
      "conversion_action_id": "111222333",
      "conversion_time": "2026-04-18T21:00:00.000Z",
      "conversion_value": 297.5,
      "currency_code": "BRL",
      "status": "pending",
      "attempts": 0,
      "metadata": {
        "source": "manual"
      }
    }
  ],
  "limit": 100,
  "offset": 0
}
```

### 4. Registrar conversão manualmente

- Método: `POST /api/marketing/google-ads/conversions`
- Permissão: `config.update`
- Content-Type: `application/json`

Payload de exemplo usando `leadId`:

```json
{
  "leadId": "mlead-1",
  "conversionName": "customer",
  "conversionActionId": "111222333",
  "conversionTime": "2026-04-18T21:00:00.000Z",
  "conversionValue": 297.5,
  "currencyCode": "BRL",
  "idempotencyKey": "google_ads:manual:mlead-1:2026-04-18",
  "metadata": {
    "source": "manual",
    "orderId": "PED-1001"
  }
}
```

Payload de exemplo usando click id explícito:

```json
{
  "clickId": "CjwK123abc",
  "clickIdType": "gclid",
  "conversionName": "customer",
  "conversionActionId": "111222333",
  "conversionTime": "2026-04-18T21:00:00.000Z",
  "conversionValue": 297.5,
  "currencyCode": "BRL",
  "metadata": {
    "source": "manual"
  }
}
```

Regras principais:

- `conversionName` é obrigatório.
- É necessário ter `clickId`/`clickIdType` diretamente no payload ou um `leadId` com atribuição armazenada.
- Se `idempotencyKey` já existir no tenant, o serviço retorna a conversão existente e marca `deduplicated=true`.

### 5. Fazer upload das pendências

- Método: `POST /api/marketing/google-ads/conversions/upload?limit=50`
- Permissão: `config.update`

Exemplo de resposta:

```json
{
  "ok": true,
  "uploaded": 3,
  "failed": 1,
  "attempted": 4
}
```

Comportamento:

- O upload busca conversões `pending` por ordem de criação.
- Cada item é enviado individualmente ao endpoint `uploadClickConversions` do Google Ads.
- Em sucesso, o registro vira `uploaded` e recebe `uploaded_at` e `external_upload_id`.
- Em falha, o registro vira `failed` e recebe `last_error`.

### 6. Sincronizar desempenho de keywords e search terms

- Método: `POST /api/marketing/google-ads/keywords/sync`
- Permissão: `config.update`
- Content-Type: `application/json`

Payload de exemplo:

```json
{
  "startDate": "2026-04-01",
  "endDate": "2026-04-18"
}
```

Exemplo de resposta:

```json
{
  "ok": true,
  "startDate": "2026-04-01",
  "endDate": "2026-04-18",
  "keywordRows": 182,
  "searchTermRows": 967,
  "keywordSynced": 182,
  "searchTermSynced": 967
}
```

Comportamento:

- Consulta a Google Ads API usando `searchStream`.
- Persiste snapshot diário em tabelas locais de keywords e search terms.
- Faz `upsert` determinístico por tenant, entidade e data.

### 7. Listar desempenho de keywords

- Método: `GET /api/marketing/google-ads/keywords/performance`
- Permissão: `analytics.read`

Parâmetros suportados:

- `startDate`
- `endDate`
- `campaignId`
- `adGroupId`
- `matchType`
- `sortBy` (`cost`, `clicks`, `conversions`, `conversionValue`, `roas`, etc.)
- `sortOrder` (`asc` ou `desc`)
- `limit`
- `offset`

Exemplo de resposta:

```json
{
  "ok": true,
  "total": 2,
  "items": [
    {
      "campaignId": "cmp-1",
      "campaignName": "Campanha Search",
      "adGroupId": "ag-1",
      "adGroupName": "Grupo 1",
      "keywordId": "kw-2",
      "keywordText": "clinica odontologica",
      "matchType": "EXACT",
      "impressions": 120,
      "clicks": 18,
      "cost": 36,
      "conversions": 4,
      "conversionValue": 720,
      "ctr": 0.15,
      "averageCpc": 2,
      "costPerConversion": 9,
      "roas": 20,
      "firstDate": "2026-04-01",
      "lastDate": "2026-04-18"
    }
  ],
  "startDate": "2026-04-01",
  "endDate": "2026-04-18",
  "limit": 100,
  "offset": 0
}
```

### 8. Listar desempenho de search terms

- Método: `GET /api/marketing/google-ads/search-terms/performance`
- Permissão: `analytics.read`

Parâmetros suportados:

- `startDate`
- `endDate`
- `campaignId`
- `adGroupId`
- `sortBy`
- `sortOrder`
- `limit`
- `offset`

Comportamento:

- Consolida desempenho por termo de busca real.
- Preserva keyword associada quando informada pela Google Ads API.
- Serve de base para negativação e expansão de keywords.

### 9. Analisar keywords com heurística + IA

- Método: `POST /api/marketing/google-ads/keywords/analyze`
- Permissão: `analytics.read`
- Content-Type: `application/json`

Payload de exemplo:

```json
{
  "startDate": "2026-04-01",
  "endDate": "2026-04-18",
  "options": {
    "minClicks": 8,
    "minImpressions": 100,
    "minCost": 20,
    "includeMinConversions": 1
  }
}
```

Exemplo de resposta:

```json
{
  "ok": true,
  "startDate": "2026-04-01",
  "endDate": "2026-04-18",
  "totals": {
    "keywords": 27,
    "searchTerms": 143,
    "keywordCost": 1200.4,
    "keywordConversionValue": 8430.9,
    "searchTermCost": 1870.2
  },
  "recommendations": [
    {
      "action": "include_keyword",
      "term": "dentista 24 horas",
      "source": "heuristic",
      "confidence": 0.86,
      "rationale": "O termo já converteu e ainda não aparece como keyword explícita no portfólio sincronizado."
    },
    {
      "action": "add_negative_keyword",
      "term": "curso de dentista",
      "source": "heuristic",
      "confidence": 0.83,
      "rationale": "O termo consumiu clique e custo sem gerar conversão dentro da janela analisada."
    }
  ],
  "ai": {
    "summary": "Adicionar dentista 24 horas e negativar curso de dentista. Pausar dentista barato.",
    "suggestions": [
      {
        "action": "include_keyword",
        "term": "dentista 24 horas",
        "rationale": "Alta intenção e já converteu.",
        "confidence": 0.92
      }
    ]
  }
}
```

Comportamento atual:

- Gera recomendações heurísticas baseadas em cliques, custo, conversão e valor de conversão.
- Usa IA para resumir o portfólio e priorizar ações.

### 9.1. Consultar ROI e ROAS por entidade

- Método: `GET /api/marketing/google-ads/roi`
- Permissão: `analytics.read`

Parâmetros suportados:

- `startDate`
- `endDate`
- `campaignId`
- `adGroupId`
- `entity`: `campaign`, `ad_group`, `keyword`, `search_term`
- `sortBy`: `conversionValue`, `cost`, `margin`, `roi`, `roas`, `conversions`
- `sortOrder`: `asc` ou `desc`
- `limit`
- `offset`

Exemplo de resposta:

```json
{
  "ok": true,
  "entity": "campaign",
  "startDate": "2026-04-01",
  "endDate": "2026-04-18",
  "summary": {
    "keywords": {
      "items": 24,
      "impressions": 12900,
      "clicks": 830,
      "cost": 2140.5,
      "conversions": 53,
      "conversionValue": 9780,
      "roi": 3.5685,
      "roas": 4.5685,
      "margin": 7639.5
    },
    "searchTerms": {
      "items": 188,
      "cost": 2010.2,
      "conversions": 49,
      "conversionValue": 9020,
      "roi": 3.487,
      "roas": 4.487,
      "margin": 7009.8
    }
  },
  "total": 3,
  "items": [
    {
      "campaignId": "cmp-1",
      "campaignName": "Search Brand",
      "cost": 820.5,
      "conversionValue": 4310,
      "margin": 3489.5,
      "roas": 5.2529,
      "roi": 4.2529
    }
  ]
}
```

Observações:

- O cálculo usa o custo e o `conversion_value` já sincronizados do Google Ads.
- `roas = conversionValue / cost`.
- `roi = (conversionValue - cost) / cost`.
- Para evitar dupla contagem, os totais principais usam a visão de keywords; a visão de search terms é exposta em resumo separado.
- A resposta também expõe `summary.reconciled` e, por item, `internalRevenue`, `attributedOrders`, `reconciledRoas` e `reconciledRoi`.
- A reconciliação usa pedidos internos não cancelados e tenta atribuí-los ao Ads via `order.context.marketingAttribution` ou, na base já existente, via `orders.customer_phone -> marketing_leads.phone -> attributes.lastAttribution`.
- Hoje a reconciliação é forte por campanha e best-effort por keyword/search term via `utm_term`; `ad_group` depende de `adGroupId`/`adGroupName` estar presente na atribuição do pedido.

### 9.2. Monitorar pedidos sem atribuição

- Método: `GET /api/marketing/google-ads/attribution-exceptions?windowDays=7&limit=20`
- Permissão: `analytics.read`

Uso:

- Lista exceções `OrderMarketingAttributionMissing` registradas no event ledger.
- Retorna resumo operacional com acumulado histórico, volume recente, pedidos distintos afetados e última ocorrência.
- Também expõe `alert`, que reaproveita a mesma regra automática do scheduler para indicar `ok`, `warning` ou `critical` com base em crescimento recente.
- Expõe quebra por `source` e os itens mais recentes para auditoria operacional.
- Na interface de Marketing, o operador pode alternar a janela operacional de exceções entre `1`, `3` e `7` dias antes de atualizar a consulta.
- Quando houver `warning` ou `critical`, o dashboard central também exibe um resumo navegável do alerta para acesso rápido ao módulo de Marketing.
- O painel operacional multiárea também expõe um resumo de `Atribuição Ads` no bloco de sistema, reaproveitando o mesmo status para drill-down rápido em Marketing.

Exemplo de resposta:

```json
{
  "ok": true,
  "tenantId": "demo",
  "windowDays": 7,
  "summary": {
    "totalMissing": 8,
    "recentMissing": 3,
    "distinctOrdersRecent": 3,
    "lastOccurredAt": "2026-04-19T12:00:00.000Z"
  },
  "alert": {
    "windowDays": 7,
    "triggered": true,
    "severity": "warning",
    "currentCount": 3,
    "previousCount": 1,
    "growthFactor": 3,
    "thresholds": {
      "minRecentMissing": 3,
      "growthFactorThreshold": 2
    }
  },
  "bySource": [
    {
      "source": "orders.storefront",
      "total": 8,
      "recent": 3
    }
  ],
  "items": [
    {
      "id": "evt-1",
      "occurredAt": "2026-04-19T12:00:00.000Z",
      "correlationId": "ordcor-123",
      "source": "orders.storefront",
      "orderId": "ord-1",
      "payload": {
        "orderNumber": "demo-abc123",
        "deliveryType": "delivery"
      }
    }
  ]
}
```

## Captura de atribuição em pedidos públicos

O endpoint público `POST /storefront/orders?token=...` agora aceita opcionalmente um bloco `attribution` no body para persistir contexto de marketing dentro do pedido.

Payload parcial de exemplo:

```json
{
  "customerName": "Cliente Teste",
  "customerPhone": "+5511999999999",
  "items": [{ "name": "Plano CRM", "qty": 1, "price": 300 }],
  "attribution": {
    "utm_source": "google",
    "utm_campaign": "search brand",
    "utm_term": "crm brand",
    "gclid": "CjwK...",
    "campaignId": "123456",
    "campaignName": "Search Brand",
    "keywordText": "crm brand"
  }
}
```

Uso recomendado:

- Sempre que o storefront ou checkout souber a atribuição, envie esse bloco junto do pedido.
- Isso melhora a reconciliação de receita real e reduz dependência do fallback por telefone+lead.
- A página pública [StorefrontOrderPage.jsx] já lê automaticamente `utm_*`, `gclid`, `gbraid`, `wbraid`, `campaignId`, `campaignName`, `adGroupId`, `adGroupName`, `keywordText` e `searchTerm` da URL e envia esse bloco ao criar o pedido.
- No estado atual do código, o storefront público é o único fluxo identificado que cria pedidos diretamente; novos fluxos de criação devem propagar `marketingAttribution` em `createOrder({ context })` para preservar a reconciliação de ROI.
- Observabilidade: todo `OrderCreated` agora registra `payload.hasMarketingAttribution`; quando a atribuição vier ausente, o ledger também recebe o evento `OrderMarketingAttributionMissing` para facilitar alertas e auditoria operacional.

### 10. Aplicar ação de keyword no Google Ads

- Método: `POST /api/marketing/google-ads/keywords/actions/apply`
- Permissão: `config.update`
- Content-Type: `application/json`

Payload de exemplo para inclusão de keyword:

```json
{
  "action": "include_keyword",
  "campaignId": "123456",
  "adGroupId": "789012",
  "keywordText": "crm para indústria",
  "matchType": "PHRASE",
  "dryRun": true,
  "idempotencyKey": "ads-action:tenant-1:crm-industria"
}
```

Payload de exemplo para negativação:

```json
{
  "action": "add_negative_keyword",
  "campaignId": "123456",
  "adGroupId": "789012",
  "keywordText": "curso de crm",
  "matchType": "PHRASE",
  "dryRun": false
}
```

Payload de exemplo para pausa:

```json
{
  "action": "pause_keyword",
  "campaignId": "123456",
  "adGroupId": "789012",
  "keywordId": "345678",
  "dryRun": false
}
```

Comportamento:

- Executa mutação real na Google Ads API via `adGroupCriteria:mutate`.
- Suporta `dryRun=true` usando `validateOnly` para validar sem aplicar na conta.
- Registra evento em ledger para rastreabilidade.
- Registra auditoria best-effort quando a chamada passa pelo controller autenticado.
- No estado atual, a execução cobre ações em nível de ad group.

### 11. Persistir recomendações em fila operacional

- Método: `POST /api/marketing/google-ads/recommendations/sync`
- Permissão: `config.update`

Payload de exemplo:

```json
{
  "startDate": "2026-04-01",
  "endDate": "2026-04-18"
}
```

Comportamento:

- Reexecuta a análise de keywords/search terms.
- Persiste recomendações em `tenant_recommendations` com domínio `marketing_google_ads`.
- Deduplica itens abertos/aprovados por fingerprint da recomendação.

### 12. Listar fila persistida

- Método: `GET /api/marketing/google-ads/recommendations?limit=20&status=open`
- Permissão: `analytics.read`

### 13. Aprovar ou rejeitar recomendação

- Método: `PUT /api/marketing/google-ads/recommendations/:recommendationId`
- Permissão: `config.update`

Payload de exemplo:

```json
{
  "status": "approved",
  "note": "Validado pelo time de marketing"
}
```

Status aceitos:

- `open`
- `approved`
- `rejected`

### 14. Aplicar recomendação persistida

- Método: `POST /api/marketing/google-ads/recommendations/:recommendationId/apply`
- Permissão: `config.update`

Payload de exemplo:

```json
{
  "dryRun": true
}
```

Comportamento:

- Reconstrói o payload da ação a partir da recomendação persistida.
- Executa a mutação real no Google Ads ou apenas valida, conforme `dryRun`.
- Atualiza o status da recomendação para `applied` ou `failed`.
- Registra histórico de decisão e histórico de aplicação no `metadata` da recomendação.

## Gatilho automático

Uma conversão offline é registrada automaticamente quando um lead muda de stage para `customer`.

Origem do gatilho:

- atualização de lead via `PATCH /api/marketing/leads/:leadId`
- serviço interno de marketing ao detectar transição para `customer`

Comportamento:

- tenta usar o `defaultConversionName` configurado no tenant
- usa `defaultConversionActionId` quando disponível
- tenta obter valor da conversão de `attributes.conversionValue` ou `attributes.customerValue`
- usa chave idempotente fixa por tenant e lead para evitar duplicação

## Erros operacionais comuns

- `integration_disabled`: integração desabilitada no tenant.
- `customer_id_required`: `customerId` não configurado.
- `default_conversion_action_id_required`: action id padrão não configurado.
- `developer_token_required`: developer token ausente.
- `client_id_required`: OAuth client id ausente.
- `client_secret_required`: OAuth client secret ausente.
- `refresh_token_required`: refresh token ausente.
- `click_id_missing`: tentativa de registrar conversão sem `gclid`, `gbraid` ou `wbraid`.
- `google_oauth_failed:*`: falha ao trocar refresh token por access token.
- `google_ads_upload_failed:*`: erro retornado pela Google Ads API.
- `google_ads_partial_failure:*`: a API respondeu com falha parcial no upload.
- `google_ads_query_failed:*`: falha ao consultar desempenho de keywords/search terms.
- `unsupported_action`: ação informada não é suportada pela camada de execução.
- `ad_group_id_required`: a ação exige `adGroupId`.
- `keyword_text_required`: a ação exige `keywordText` ou `term`.
- `keyword_id_required`: a pausa exige `keywordId`.
- `recommendation_not_found`: recomendação persistida não encontrada no tenant.
- `invalid_status`: status inválido ao aprovar/rejeitar recomendação.

## Sequência recomendada de ativação

1. Garantir `ENCRYPTION_KEY` no ambiente.
2. Aplicar migrations no ambiente alvo.
3. Salvar configuração do tenant em `POST /settings` com `dryRun=true`.
4. Criar uma conversão manual de teste em `POST /conversions`.
5. Validar a pendência em `GET /conversions?status=pending`.
6. Executar upload em `POST /conversions/upload?limit=1`.
7. Validar o resultado em `GET /conversions?status=uploaded` ou `failed`.
8. Depois do teste, desativar `dryRun` para envio real.

## UI

A operação também está exposta na tela de Marketing do frontend:

- configuração de Google Ads
- criação manual de conversões
- listagem de conversões
- disparo manual de upload

Os endpoints de keywords/search terms e análise por IA já estão disponíveis no backend e no client frontend, mas ainda podem exigir evolução adicional de interface para gestão detalhada.

Cliente frontend relacionado:

- `frontend/src/api/marketing.js`
- `frontend/src/pages/MarketingPage.jsx`

## ROI atual e lacunas

O estado atual já permite:

- capturar atribuição e conversões offline
- consolidar custo e desempenho de keywords/search terms
- calcular proxies como `costPerConversion` e `roas` na camada analítica local

O que ainda falta para ROI completo de Ads:

- fechamento financeiro por pedido/receita real reconciliado com keyword/search term
- gestão de spend por campanha fora da janela sincronizada local
- escrita de volta na conta para fechar o ciclo de otimização supervisionada por IA