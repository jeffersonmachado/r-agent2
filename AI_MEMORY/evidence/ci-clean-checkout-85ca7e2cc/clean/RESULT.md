# Clean checkout — clean

- commit: `85ca7e2cc18d3f108a18ae13bcb37bf3bc67bf6b`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `7244e991740b010b8c412275e7d4bf687e18e718eab6943c94bb595c65c8f854`
- runId: `clean-checkout-20261024093426388-1970a3`
- environmentId: `local-jmachado-Precision-5530-316086`
- veredito: **FAIL**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| npm-ci-bootstrap | 0 | 0 | 129s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 100s | PASS |
| build-frontend | 0 | 0 | 46s | PASS |
| prod-like-smoke | 0 | 0 | 117s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| gate-dev-branch | 0 | 0 | 1459s | PASS |
| L1-inventario:L1-release-dag | 0 | 0 | 0s | PASS |
| L1-inventario:L1-fila-oficial | 0 | 0 | 1s | PASS |
| L1-inventario:L1-ai-memory | 0 | 0 | 0s | PASS |
| L1-inventario:L1-aderencia-agente | 0 | 0 | 0s | PASS |
| L1-inventario:L1-cadeia-criptografica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-self-proving | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-decisao-canonica | 0 | 1 | 0s | FAIL |
| L1-inventario-resumo | 0 | 1 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:43137 redis:44425
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:43315 (container rap-ci-clean-1970a3-rag; nao usa o 8001 do desenvolvedor)
