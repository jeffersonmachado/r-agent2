> Fonte: replay real `qa_wave_replay_1784891878285_sj46gh` (QA Waves, 2026-07-24, 18/18 passos com sucesso)
> Missão Learning Core: `62c04821-08e2-4b7d-92b0-524e0b617196` | RAG: `training:qa_wave_replay_1784891878285_sj46gh`
> Uso: treinamento de usuários novos e base de conhecimento para dúvidas (Academy/RAG).
# Treinamento: jornada qa_wave_replay_1784891878285_sj46gh

Roteiro gerado automaticamente a partir de um replay operacional real,
com todos os dados anonimizados (63 campos mascarados).

## Resumo

- Contexto: operacao
- Telas percorridas: 2
- Ações: 18
- Duração de referência: 119s
- Erros no replay original: 0

## Telas

- `/workspace`
- `/tasks`

## Passo a passo

Valores de campos aparecem mascarados (`[valor]`, `[telefone]`, etc.) por privacidade;
cada passo de preenchimento indica um **exemplo sintético** seguro para prática.

1. **Navegar** — etapa `Abrir workspace (login automático pousa aqui)` (alvo `{{urls.frontend}}/workspace`) ✅
2. **Aguardar** — etapa `Aguardar shell autenticado` (alvo `.rap-primary-rail`) ✅
3. **Clicar** — etapa `Abrir menu Construtor (rail)` (alvo `a[aria-label="Construtor"]`) ✅
4. **Clicar** — etapa `Expandir seção Execução no menu` (alvo `.rap-secondary-nav-section-header:has-text("Execução")`) ✅
5. **Clicar** — etapa `Abrir Tarefas no menu lateral` (alvo `.rap-secondary-nav-item:has-text("Tarefas")`) ✅
6. **Aguardar** — etapa `Aguardar formulário de nova tarefa` (alvo `.support-details-title:has-text("Nova tarefa")`) ✅
7. **Preencher campo** — etapa `Preencher título da tarefa` (alvo `.support-details-panel:has-text("Nova tarefa") input`; valor: [valor] — exemplo sintético: `Aula experimental (exemplo sintético)`) ✅
8. **Preencher campo** — etapa `Preencher prazo da tarefa` (alvo `.support-details-panel:has-text("Nova tarefa") input[type="datetime-local"]`; valor: [valor] — exemplo sintético: `2026-07-25T09:00`) ✅
9. **Clicar** — etapa `Criar tarefa` (alvo `button:has-text("Criar tarefa")`) ✅
10. **Aguardar** — etapa `Aguardar confirmação de criação da tarefa` (alvo `.rap-toast--success:has-text("Tarefa criada")`) ✅
11. **Clicar** — etapa `Abrir agendamento da tarefa criada` (alvo `div.p-3:has-text("Aula experimental QA") button:has-text("Agendar")`) ✅
12. **Aguardar** — etapa `Aguardar modal Novo Agendamento` (alvo `.support-modal-content`) ✅
13. **Preencher campo** — etapa `Preencher data/hora inicial do agendamento` (alvo `.support-modal-content input[type="datetime-local"]`; valor: [valor] — exemplo sintético: `2026-07-25T09:00`) ✅
14. **Preencher campo** — etapa `Preencher finalidade` (alvo `input[placeholder="Buscar finalidade..."]`; valor: [valor] — exemplo sintético: `aula experimental`) ✅
15. **Preencher campo** — etapa `Preencher notas do agendamento` (alvo `.support-modal-content textarea.support-form-textarea`; valor: [valor] — exemplo sintético: `Observações de exemplo (dado sintético)`) ✅
16. **Clicar** — etapa `Confirmar agendamento` (alvo `.support-modal-content button[type="submit"]`) ✅
17. **Aguardar** — etapa `Aguardar toast Agendamento criado` (alvo `.rap-toast--success:has-text("Agendamento criado")`) ✅
18. **Validar** — etapa `Validar criação do agendamento` ✅

## Checklist de validação

- [ ] Consegui executar todos os passos sem ajuda
- [ ] Entendi o objetivo de cada tela percorrida
- [ ] Sei o que fazer quando um passo falha
