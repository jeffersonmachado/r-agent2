# Clean checkout — l2-system

- commit: `780aaa33ba3591e61aac9f7d9687f6e90705cd7e`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `d230eba27e0a1dc6468d415c2e5fd1d9500de619b5a7c27f4ac545ed3fa26282`
- runId: `clean-checkout-20261022081648392-abbf47`
- environmentId: `local-jmachado-Precision-5530-668236`
- veredito: **FAIL**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 102s | PASS |
| l2-test-system | 0 | 1 | 5s | FAIL |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:45031 redis:34335
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:43665 (nao usa o 8001 do desenvolvedor)
