# Clean checkout — bootstrap-twice

- commit: `eac0fae086d8513a6ffb58053080592157f20a02`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261025143306073-4b621e`
- environmentId: `local-jmachado-Precision-5530-2917493`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap-1 | 0 | 0 | 133s | PASS |
| bootstrap-2 | 0 | 0 | 99s | PASS |
| idempotencia-seed | igual | 0 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:42179 redis:45239
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:42903 (container rap-ci-clean-4b621e-rag; nao usa o 8001 do desenvolvedor)
