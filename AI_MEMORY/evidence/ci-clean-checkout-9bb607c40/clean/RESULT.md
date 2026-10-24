# Clean checkout — clean

- commit: `9bb607c40cef376ef4f39b137b725e345d663752`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `6e2d0f666eac2483b6b31c6f71d3bef2a31c5c0354698be9ab62d8cf25e87b33`
- runId: `clean-checkout-20261024101119926-65ff5a`
- environmentId: `local-jmachado-Precision-5530-396845`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| npm-ci-bootstrap | 0 | 0 | 92s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 27s | PASS |
| build-frontend | 0 | 0 | 41s | PASS |
| prod-like-smoke | 0 | 0 | 114s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| gate-dev-branch | 0 | 0 | 1433s | PASS |
| L1-inventario:L1-release-dag | 0 | 0 | 0s | PASS |
| L1-inventario:L1-fila-oficial | 0 | 0 | 2s | PASS |
| L1-inventario:L1-ai-memory | 0 | 0 | 0s | PASS |
| L1-inventario:L1-aderencia-agente | 0 | 0 | 0s | PASS |
| L1-inventario:L1-cadeia-criptografica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-self-proving | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-decisao-canonica | 0 | 1 | 0s | FAIL |
| L1-inventario-resumo | 0 | 1 | 0s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:34741 redis:42119
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:39685 (container rap-ci-clean-65ff5a-rag; nao usa o 8001 do desenvolvedor)
