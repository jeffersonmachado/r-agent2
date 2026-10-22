# Clean checkout — clean

- commit: `382f83b37810f4f1abaf433ac4b67e8c88d28a18`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `2e118d99ae6aec260c2ddf5efd79ada134f70d779c896317c7a6234aa9fb6193`
- runId: `clean-checkout-20261022011537792-662e06`
- environmentId: `local-jmachado-Precision-5530-4128680`
- veredito: **FAIL**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| npm-ci-bootstrap | 0 | 0 | 99s | PASS |
| gate-dev-branch | 0 | 1 | 283s | FAIL |
| L1-inventario:L1-cadeia-criptografica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-self-proving | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-release-dag | 0 | 0 | 0s | PASS |
| L1-inventario:L1-decisao-canonica | 0 | 1 | 0s | FAIL |
| L1-inventario:L1-fila-oficial | 0 | 0 | 1s | PASS |
| L1-inventario:L1-ai-memory | 0 | 0 | 0s | PASS |
| L1-inventario:L1-aderencia-agente | 0 | 0 | 0s | PASS |
| L1-inventario-resumo | 0 | 1 | 0s | PASS |
| integracao-engenheiro | 0 | 0 | 1002s | PASS |

## Limitações declaradas

- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:43897 (nao usa o 8001 do desenvolvedor)
