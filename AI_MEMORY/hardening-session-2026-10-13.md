# Sessão de hardening — 2026-10-13 (T1..T6)

Relatório consolidado da sessão que executou a lista de pendências T1–T6.
Complementa `AI_MEMORY/hardening-queue.json` (fila oficial, 34 itens: 33 `done`,
1 `blocked`) e `AI_MEMORY/runtime-navigation.md` § "Jornada FUNCIONAL 2026-10-13".

## Veredito

**GO TÉCNICO — PUBLICAÇÃO PENDENTE.**

O produto está tecnicamente validado (suítes verdes, um defeito real de frontend
encontrado e corrigido com prova nos dois sentidos, gates com causa única e
honesta). O que falta é **selar o payload do release** (`P1-11`), que é
exatamente o item `blocked` da fila e depende de decisão humana — a Regra 10 da
missão proíbe publicar sem autorização explícita.

## O que foi entregue

| # | Entrega | Commit | Prova |
|---|---|---|---|
| T1 | `scripts/pbx-cdr-health.sh` + preflight do converge exige o BACKEND de CDR (não só a porta) | `ec85f48b7` | `tests/unit/pbx/pbxCdrHealth.test.js` — 7 casos |
| T2 | Recibo de verifier STALE removido do `dist/` | `ec85f48b7` | `check-dist-clean.sh`: check passa a "sem verify-result.json pré-empacotado" |
| T3 | Fila de hardening atualizada (H9–H19) | `d00b8632f`, `e5ae5c429` | `AI_MEMORY/hardening-queue.json` — 34 itens, 0 abertos |
| T4 | Evidência de runtime recoletada | `1cb7fafe1` | `RUNTIME_PASS items=25 falhas=0`, fingerprint `a9f8c4c0…`, 209 checks PASS |
| T4b | Runner detecta e **atribui** mutação da superfície provada durante o run | `1cb7fafe1` | `allValidatorsRunner.test.js` — 18 casos (+5) |
| T5 | Jornada funcional real no browser + **defeito de produto corrigido** | `dcc97cbed` | `FlowTemplateSelector.test.jsx` 4/4; falha no código antigo (sentido inverso) |
| T6 | Suítes finais e este relatório | — | ver "Medições" abaixo |

## Defeito real de produto encontrado e corrigido (T5)

`frontend/src/components/FlowTemplateSelector.jsx` chamava `useMemo` **depois** dos
`return` antecipados de `selectedTemplate`, `loading` e `error`. Na primeira
renderização (`loading === true`) o hook não rodava; quando o fetch dos modelos
terminava, a render seguinte chamava um hook a mais e o React **abortava o
componente**:

```
Warning: React has detected a change in the order of Hooks called by FlowTemplateSelector.
Rendered more hooks than during the previous render.   (3x pageerror)
```

Efeito no produto: a rota `/editor` registrava 2 erros de console + 3 pageerror e
o botão **"Novo" não abria o seletor de modelos** — a ação de criar fluxo estava
indisponível na tela. Depois do fix: `/editor` com 0 erros de console e 0
pageerror, e "Novo" abrindo "Criar Novo Fluxo / Selecione um modelo" com a lista.

**Prova nos dois sentidos** (o que a Regra 20 exige): com o código antigo
restaurado temporariamente (`git stash push` do `.jsx`), o teste novo FALHA com
exatamente `Rendered more hooks than during the previous render`; com o fix, 4/4.

## O defeito que era do MEU processo, não do produto (T4b)

Durante um run do `validate:all-validators` eu criei um arquivo em `scripts/smoke/`
— raiz que está em `SOURCE_ROOTS` do fingerprint chain. A evidência de runtime foi
coletada antes (`bae797d5…`) e validada depois (`a6454061…`), e o
`validate:engineering-router-v1:runtime` reprovou com `RUNTIME_EVIDENCE_FRESH`,
cascateando 4 falhas num run de ~40 min. **O gate estava certo**; faltava
atribuição. O runner agora fotografa a superfície provada antes e depois do loop,
identifica os arquivos alterados e marca como `attributedToSourceMutation`
SOMENTE as falhas cujo motivo é de obsolescência — falha de pacote continua sendo
falha de pacote.

## Medições finais

- **Validadores (runner completo, worktree limpo): 56 PASS / 4 FAIL.**
  As 4 falhas são UMA causa — `P1-11` (payload não selado): `validate:dist` e os
  três consumidores em cadeia (`release-governance`, `governance-summary`,
  `final-status-projection`). Nenhum aviso de mutação de superfície
  (`provenSurfaceStability: ESTAVEL`).
- **Engineer router v1**: `status=PASS` (STRUCTURAL_PASS/RUNTIME_PASS), 209 checks,
  0 falhas; evidência de runtime `RUNTIME_PASS items=25 falhas=0`.
- **Frontend (Vitest)**: 136 arquivos / 1035 testes PASS (EXIT=0).
- **Backend (`npm run test:unit`)**: 1003 suites PASS (1 skipped) / 8395 testes
  PASS (2 skipped), 0 falhas, EXIT=0.
- **Jornada funcional browser** (8 rotas PRODUCTION): 0 erros de console, 0
  pageerror, 0 requisições falhas; buscas filtram (`/workspace` 8083 → 792 chars,
  `/crm` 1922 → 1170 chars), chips de filtro aplicam, botões de criação abrem.
- **PBX/CDR**: ponte e backend supervisionados (`check`/`ensure`), com o sinal
  correto medido (`cdr show status` → Registered Backends; o `Use Count` do módulo
  é 0 mesmo quando saudável e não serve de sinal).

## Limites desta validação (honestidade de escopo)

- **Não publicado**: nenhum push; `origin/main` segue em `ab1e9fcf3`.
- **`P1-11` permanece `blocked`**: o release completo exige `release:seal`, que
  depende de autorização humana.
- **A jornada browser cobre 8 rotas de negócio**, não as 21 do mapa completo; as
  demais foram validadas apenas quanto a carregamento (varredura de 2026-10-13).
- **Ações não exercitadas** ficam registradas como SKIP explícito no JSON de
  evidência (`qa/evidence/journey-functional-latest.json`), nunca como sucesso.
- O item `H18` observa que a primeira versão do detector de jornada produziu **5
  falsos positivos** (media o menu lateral como se fosse a lista). Corrigido para
  medir efeito percebido; a lição está registrada porque falso positivo de
  detector esconde defeito real no ruído.
