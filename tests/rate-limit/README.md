# Testes de Rate Limiting

## 📋 Visão Geral

Testes para o sistema de rate limiting do projeto, incluindo:
- Testes unitários de políticas e engine
- Testes de integração com endpoints
- Testes de scraping rate limiting

## 🚀 Executar Testes

### Executar apenas testes de rate limiting:
```bash
npm run test:rate-limit
```

### Executar como parte dos testes sistêmicos:
```bash
npm run test:system
```

### Executar como parte de todos os testes:
```bash
npm run test:all
```

### Executar como parte do teste completo:
```bash
npm run test:complete
```

## 📁 Estrutura

```
tests/rate-limit/
├── rateLimit.test.js      # Testes unitários
└── integration.test.js     # Testes de integração
```

## ✅ Inclusão nos Testes Completos

Os testes de rate limiting estão incluídos em:

1. ✅ **`test:all`** - Executa todos os testes Jest (inclui rate-limit automaticamente)
2. ✅ **`test:system`** - Executa testes sistêmicos (inclui rate-limit explicitamente)
3. ✅ **`test:complete`** - Executa `test:all` (inclui rate-limit)

## 📊 Cobertura

- Políticas de rate limiting (DRY_RUN, GENERATION_REAL, BOOTSTRAP, SCRAPING)
- Rate limiting por domínio e execução
- Integração com Redis
- Bloqueio de execuções
- Auditoria de eventos
- Integração com endpoints HTTP

## ⚠️ Notas

- Testes de integração requerem servidor rodando (são pulados se não disponível)
- Testes funcionam sem Redis (usam fallback em memória)
- Timeouts configurados para evitar travamentos




