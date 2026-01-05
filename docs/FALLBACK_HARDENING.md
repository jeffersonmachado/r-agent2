# Endurecimento de Fallbacks - Implementação

## Resumo

Este documento descreve as mudanças implementadas para endurecer o sistema de fallbacks, removendo mascaramentos silenciosos de problemas e implementando fail-closed ao invés de fail-open em cenários críticos.

## Mudanças Implementadas

### 1. Rate Limiting - Fail-Open → Fail-Closed ✅

**Arquivo**: `infra/rate-limit/index.js`

**Mudanças**:
- **Redis → Memória**: Em produção, lança erro ao invés de usar fallback silencioso
- **checkRateLimitStatus**: Fail-closed em produção (bloqueia ao invés de permitir)
- **Erros de verificação**: Bloqueia requisições em produção quando não é possível verificar status

**Impacto**:
- Em produção, rate limiting não pode ser desabilitado silenciosamente
- Problemas de infraestrutura (Redis) são detectados imediatamente
- Previne vulnerabilidades de rate limiting

**Comportamento**:
- **Desenvolvimento**: Permite fallback para memória com logs de erro
- **Produção**: Falha explicitamente se Redis não estiver disponível

### 2. Auth Service - Remoção de Fallback de Validação ✅

**Arquivo**: `api/services/authService.js`

**Mudanças**:
- Removido fallback que aceitava tokens sem validação
- Sempre falha explicitamente se módulo de validação não estiver disponível
- Logs como erro crítico

**Impacto**:
- Previne autenticação insegura
- Detecta problemas de configuração imediatamente
- Não mascarar problemas de segurança

### 3. AI Providers - Métricas e Alertas ✅

**Arquivos**: 
- `engine/aiProviderManager.js`
- `api/services/aiProviderService.js`

**Mudanças**:
- Logs de fallback mudados de `warn` para `error`
- Adicionado registro no sistema de monitoramento
- Provider estático loga como erro crítico quando usado
- Métricas de uso de fallback

**Impacto**:
- Uso de fallback não é mais silencioso
- Problemas de providers são detectados rapidamente
- Métricas permitem monitoramento proativo

### 4. Frontend - Desabilitação de Simulação em Produção ✅

**Arquivo**: `frontend/src/hooks/useFlowRunner.js`

**Mudanças**:
- Simulação desabilitada em produção
- Em produção, lança erro ao invés de simular
- Em desenvolvimento, permite simulação mas loga como erro

**Impacto**:
- Problemas de API são detectados imediatamente em produção
- Não mascarar problemas de conectividade
- Desenvolvimento ainda permite simulação para testes

### 5. Logging - Aumento de Severidade ✅

**Arquivos**:
- `engine/nodes/aiNode.js`
- `engine/fallbackController.js`
- `engine/nodes/aiNode.js` (RAG fallback)

**Mudanças**:
- Fallbacks agora logam como `error` ou `warn` (não mais `debug`)
- Adicionado campo `severity` e `alert` nos logs
- RAG fallback loga com severidade apropriada
- Provider ausente loga como erro crítico

**Impacto**:
- Logs de fallback são mais visíveis
- Facilita debugging e monitoramento
- Alertas podem ser configurados baseados em severidade

### 6. Sistema de Monitoramento de Fallbacks ✅

**Arquivo**: `engine/fallbackMonitor.js` (NOVO)

**Funcionalidades**:
- Rastreamento de uso de fallbacks em tempo real
- Thresholds configuráveis por tipo de fallback
- Alertas automáticos quando thresholds são excedidos
- Métricas agregadas (último minuto, 5 minutos, 1 hora, total)

**Tipos Monitorados**:
- `RATE_LIMIT_REDIS_TO_MEMORY`: Fallback Redis → Memória
- `RATE_LIMIT_FAIL_OPEN`: Fail-open (nunca deve acontecer)
- `AI_PROVIDER_FALLBACK`: Fallback de provider de IA
- `AI_PROVIDER_STATIC`: Provider estático usado
- `RAG_FALLBACK_TO_DIRECT`: RAG → IA direta
- `AI_NODE_NO_PROVIDER`: Nó AI sem provider
- `FRONTEND_AI_SIMULATION`: Simulação no frontend (nunca em produção)
- `AUTH_TOKEN_FALLBACK`: Fallback de autenticação (nunca deve acontecer)

**Thresholds**:
- `RATE_LIMIT_REDIS_TO_MEMORY`: 1/min (qualquer uso é crítico)
- `RATE_LIMIT_FAIL_OPEN`: 0/min (nunca deve acontecer)
- `AI_PROVIDER_FALLBACK`: 10/min
- `AI_PROVIDER_STATIC`: 1/min (qualquer uso é crítico)
- `RAG_FALLBACK_TO_DIRECT`: 20/min
- `AI_NODE_NO_PROVIDER`: 1/min (qualquer uso é crítico)
- `FRONTEND_AI_SIMULATION`: 0/min (nunca em produção)
- `AUTH_TOKEN_FALLBACK`: 0/min (nunca deve acontecer)

**Integração**:
- Integrado em todos os pontos críticos de fallback
- Não afeta execução (erros são silenciosamente ignorados)
- Métricas disponíveis via `getFallbackMetrics()`

## Benefícios

1. **Visibilidade**: Fallbacks não são mais silenciosos
2. **Segurança**: Fail-closed em cenários críticos
3. **Detecção Rápida**: Problemas são detectados imediatamente
4. **Monitoramento**: Sistema de métricas e alertas
5. **Debugging**: Logs mais informativos e estruturados

## Compatibilidade

- **Desenvolvimento**: Mantém fallbacks para facilitar desenvolvimento
- **Produção**: Fail-closed para segurança e confiabilidade
- **Backward Compatible**: Não quebra funcionalidades existentes

## Próximos Passos Recomendados

1. **Dashboard de Monitoramento**: Criar interface para visualizar métricas de fallback
2. **Alertas Externos**: Integrar com sistemas de alerta (PagerDuty, Slack, etc.)
3. **Métricas Prometheus**: Exportar métricas para Prometheus
4. **Testes**: Adicionar testes para verificar comportamento fail-closed
5. **Documentação**: Atualizar documentação de operações

## Arquivos Modificados

1. `infra/rate-limit/index.js`
2. `api/services/authService.js`
3. `engine/aiProviderManager.js`
4. `engine/nodes/aiNode.js`
5. `api/services/aiProviderService.js`
6. `frontend/src/hooks/useFlowRunner.js`
7. `frontend/src/api/system.js`
8. `engine/fallbackController.js`

## Arquivos Criados

1. `engine/fallbackMonitor.js` - Sistema de monitoramento de fallbacks

## Notas Importantes

- Todas as mudanças são **fail-safe**: erros no monitoramento não afetam a execução
- Em **produção**, fallbacks críticos agora falham explicitamente
- Em **desenvolvimento**, fallbacks ainda funcionam mas com logs de erro
- Sistema de monitoramento é **opcional** e não quebra se não estiver disponível

