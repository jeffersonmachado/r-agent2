# Engineering Checkpoint Checklist

Protocolo de checkpoints incrementais auditáveis (pedido do operador, 2026-10-16). Vale para
trabalho de desenvolvimento com auditoria externa por commit.

## Regras invioláveis

- Trabalhe em `dev/engineering-hardening` (ou outra branch de desenvolvimento). **Nunca** commite
  direto na `main`, **nunca** publique tag e **nunca** use `--force`.
- Um checkpoint = uma correção independente. Não empacote mudanças não relacionadas.
- **Teste rápido relevante antes de cada checkpoint.** Se falhar, não existe checkpoint.
- **Nunca** crie commit vazio/artificial só para cumprir intervalo, e **nunca** publique teste
  falso ou evidência inconsistente.
- Depois do push, continue trabalhando — respeitando dependências e gates.
- Pull Request só depois das validações obrigatórias.

## Como registrar (executável, não prosa)

```bash
node tools/audit/checkpoint.js \
  --title "area: o que mudou" \
  --problem "qual problema real isto corrige" \
  --tests "npx jest <teste relevante>" \
  [--tests "<outro comando>"] [--note "contexto"]
```

- O gravador DERIVA o resto do estado real: branch, SHA de base, arquivos modificados, e cada
  teste com exit code, duração e sha256 da saída.
- Ele **recusa** rodar em `main`/`master`, **recusa** sem `--tests` e **recusa-se a escrever** se
  qualquer teste sair diferente de 0 — é impossível registrar checkpoint verde a partir de teste
  vermelho (exit 1, nada escrito).
- Saída versionada: `AI_MEMORY/evidence/checkpoints.md`, um item por commit, com `id` = sha256 do
  conteúdo registrado (o auditor recalcula).
- O commit que carrega um checkpoint é sempre
  `git log -1 --format=%H -- AI_MEMORY/evidence/checkpoints.md`.

## O que o commit deve dizer

Título no formato `area(escopo): o que mudou` e, no corpo: id do checkpoint, arquivos, testes
executados com resultado e problema corrigido. O `id` é o elo entre commit e registro.

## Antes de abrir PR

- O agregado bloqueante é `npm run validate:governance-enforcement` (cadeia de 63 passos com `&&`
  — o que prova é o exit 0). Ele exige evidência **do run governado corrente**: um worktree com
  fonte alterada por desenvolvimento novo fica em drift e o agregado fica vermelho até existir um
  run novo. Isso é esperado e precisa ser dito, nunca escondido.
- Enquanto o agregado não puder ficar verde no HEAD do PR, use os gates rápidos relevantes ao
  escopo (ex.: `audit:json-persistence`, `validate:ai-memory`, `validate:agent-adherence`,
  `validate:hardening-queue`) e declare explicitamente o nível de validação atingido.
