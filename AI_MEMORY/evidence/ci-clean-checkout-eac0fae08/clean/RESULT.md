# Clean checkout — clean

- commit: `eac0fae086d8513a6ffb58053080592157f20a02`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261025115507853-9d0ec3`
- environmentId: `local-jmachado-Precision-5530-2666301`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| npm-ci-bootstrap | 0 | 0 | 141s | PASS |
| build-api-base | 0 | 0 | 0s | PASS |
| build-api | 0 | 0 | 29s | PASS |
| build-frontend | 0 | 0 | 79s | PASS |
| prod-like-smoke | 0 | 0 | 109s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| gate-dev-branch | 0 | 0 | 1693s | PASS |
| L1-inventario:L1-release-dag | 0 | 0 | 0s | PASS |
| L1-inventario:L1-fila-oficial | 0 | 0 | 1s | PASS |
| L1-inventario:L1-ai-memory | 0 | 0 | 0s | PASS |
| L1-inventario:L1-aderencia-agente | 0 | 0 | 0s | PASS |
| L1-inventario:L1-cadeia-criptografica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-self-proving | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-projecao-estado-canonico | 0 | 1 | 2s | FAIL |
| L1-inventario:L1-decisao-canonica | 0 | 1 | 0s | FAIL |
| L1-inventario-resumo | 0 | 1 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:44397 redis:37863
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:44489 (container rap-ci-clean-9d0ec3-rag; nao usa o 8001 do desenvolvedor)
