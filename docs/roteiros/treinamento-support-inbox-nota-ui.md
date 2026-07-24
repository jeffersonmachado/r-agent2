> Fonte: replay real `qa_wave_replay_1784896078321_pu601p` (QA Waves, 2026-07-24, seed UI `support-inbox-nota-ui`, 12/12 passos com sucesso)
> Missão Learning Core: `3569c131-5336-4169-ab0a-a4dc0001226a` | RAG: `training:qa_wave_replay_1784896078321_pu601p`
> Uso: treinamento de usuários novos e base de conhecimento para dúvidas (Academy/RAG).
> Nota: os 6 erros do replay original referem-se à validação semântica estrita da wave
> (contrato operacional blocking de `support_ticket_flow`, em correção), não aos passos de UI,
> que executaram 12/12 com sucesso.
# Treinamento: jornada qa_wave_replay_1784896078321_pu601p

Roteiro gerado automaticamente a partir de um replay operacional real,
com todos os dados anonimizados (35 campos mascarados).

## Resumo

- Contexto: operacao
- Telas percorridas: 2
- Ações: 12
- Duração de referência: 99s
- Erros no replay original: 6

## Telas

- `/workspace`
- `/inbox`

## Passo a passo

Valores de campos aparecem mascarados (`[valor]`, `[telefone]`, etc.) por privacidade;
cada passo de preenchimento indica um **exemplo sintético** seguro para prática.

1. **Navegar** — etapa `Abrir workspace (login automático pousa aqui)` (alvo `{{urls.frontend}}/workspace`) ✅
2. **Aguardar** — etapa `Aguardar shell autenticado` (alvo `.rap-primary-rail`) ✅
3. **Clicar** — etapa `Abrir menu Atendimento (rail)` (alvo `a[aria-label="Atendimento"]`) ✅
4. **Aguardar** — etapa `Aguardar item Caixa de Entrada no menu lateral` (alvo `.rap-secondary-nav-item:has-text("Caixa de Entrada")`) ✅
5. **Clicar** — etapa `Abrir Caixa de Entrada no menu lateral` (alvo `.rap-secondary-nav-item:has-text("Caixa de Entrada")`) ✅
6. **Aguardar** — etapa `Aguardar lista de tickets da inbox` (alvo `.support-ticket-card`) ✅
7. **Clicar** — etapa `Selecionar primeiro ticket da lista` (alvo `.support-ticket-card`) ✅
8. **Aguardar** — etapa `Aguardar painel de notas internas` (alvo `textarea.support-form-textarea`) ✅
9. **Preencher campo** — etapa `Escrever nota interna` (alvo `textarea.support-form-textarea`; valor: [valor] — exemplo sintético: `Observações de exemplo (dado sintético)`) ✅
10. **Clicar** — etapa `Salvar nota interna` (alvo `button:has-text("Salvar nota")`) ✅
11. **Aguardar** — etapa `Aguardar toast Nota adicionada` (alvo `.rap-toast--success:has-text("Nota adicionada")`) ✅
12. **Validar** — etapa `Validar criação da nota interna` ✅

## Checklist de validação

- [ ] Consegui executar todos os passos sem ajuda
- [ ] Entendi o objetivo de cada tela percorrida
- [ ] Sei o que fazer quando um passo falha
