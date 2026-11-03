# Clean checkout — missing-artifact

- commit: `33ef95718813455d176c617ccdc546be46f0b4ee`
- branch: `dev/engineering-hardening`
- sourceFingerprint: `2d9bc644d04da40d5692347c5238d083042a217048df9ebc1c849815707b87fe`
- runId: `clean-checkout-20261022073459441-f0fe3f`
- environmentId: `local-jmachado-Precision-5530-596292`
- veredito: **FAIL**
- node: 22.12.0 · npm: 10.9.0 · postgres: psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) · redis: redis-cli 7.0.15 · docker: Docker version 27.3.1, build ce12230
- jest: 29.7.0

| passo | esperado | exit | duracao | ok |
|---|---|---|---|---|
| clone-limpo | 0 | 0 | 0s | PASS |
| bootstrap | 0 | 0 | 101s | PASS |
| consumidor-com-artefato | 0 | 0 | 4s | PASS |
| consumidor-sem-artefato | 1 | 0 | 3s | FAIL |
| produtor-regenera | 0 | 0 | 0s | PASS |
| consumidor-apos-regenerar | 0 | 0 | 3s | PASS |

## Limitações declaradas

- Postgres/Redis efemeros do run: pg:40771 redis:46287
- imagem r-agent2-rag-service:latest ja existia no host (reaproveitada; use --build-images para reconstruir)
- servico RAG provisionado pelo harness em 127.0.0.1:45001 (nao usa o 8001 do desenvolvedor)
