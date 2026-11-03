# Clean checkout — clean

- commit: `83b50f1e4209522593d554a84a40b1d02abeb6cc`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `ba06659e6e7b7ee5327477f590e9191373514f9ad1140b2588985abcab322626`
- runId: `clean-checkout-20261024190537448-351b57`
- environmentId: `local-jmachado-Precision-5530-1332417`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| npm-ci-bootstrap | 0 | 0 | 110s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 26s | PASS |
| build-frontend | 0 | 0 | 40s | PASS |
| prod-like-smoke | 0 | 0 | 114s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| gate-dev-branch | 0 | 0 | 1617s | PASS |
| L1-inventario:L1-release-dag | 0 | 0 | 0s | PASS |
| L1-inventario:L1-fila-oficial | 0 | 0 | 1s | PASS |
| L1-inventario:L1-ai-memory | 0 | 0 | 0s | PASS |
| L1-inventario:L1-aderencia-agente | 0 | 0 | 0s | PASS |
| L1-inventario:L1-cadeia-criptografica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-self-proving | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-projecao-estado-canonico | 0 | 1 | 3s | FAIL |
| L1-inventario:L1-decisao-canonica | 0 | 1 | 0s | FAIL |
| L1-inventario-resumo | 0 | 1 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:38171 redis:36587
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:45967 (container rap-ci-clean-351b57-rag; nao usa o 8001 do desenvolvedor)
