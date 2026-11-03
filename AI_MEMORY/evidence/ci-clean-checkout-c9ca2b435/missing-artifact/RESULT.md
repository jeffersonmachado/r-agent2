# Clean checkout — missing-artifact

- commit: `c9ca2b4359a2cbf781586ec3975a56d4c3fbdbc0`
- branch: `codex/p1-governance-hardening-20261023`
- sourceFingerprint: `78b1828696a382c5932cfd98b75cfe61fecb5e56ffddefbab2d2a147fde7c056`
- runId: `clean-checkout-20261024111855879-2eaaa2`
- environmentId: `local-jmachado-Precision-5530-550111`
- veredito: **PASS**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 96s | PASS |
| build-api-base | 0 | 0 | 1s | PASS |
| build-api | 0 | 0 | 14s | PASS |
| build-frontend | 0 | 0 | 40s | PASS |
| prod-like-smoke | 0 | 0 | 114s | PASS |
| prod-like-artefato | 0 | 0 | 0s | PASS |
| consumidor-com-artefato | 0 | 0 | 8s | PASS |
| consumidor-sem-artefato | 1 | 1 | 5s | PASS |
| produtor-regenera | 0 | 0 | 62s | PASS |
| consumidor-apos-regenerar | 0 | 0 | 6s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:35879 redis:36633
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em http://127.0.0.1:46527 (container rap-ci-clean-2eaaa2-rag; nao usa o 8001 do desenvolvedor)
