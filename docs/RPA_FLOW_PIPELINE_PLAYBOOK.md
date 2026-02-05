# RPA Flow Pipeline (playbook operacional)

Este playbook descreve como executar, validar e reverter o pipeline de
geracao de gravacoes RPA a partir de fluxos.

## Quando usar
- Ao converter um fluxo novo em gravação RPA.
- Ao atualizar dependencias que exigem seeds RPA.
- Ao validar consistencia do ambiente antes de execucoes automáticas.

## Fluxo padrão
1. **Analise de dependencias**
   - Identifica seeds obrigatorios e dependencias faltantes.
2. **Execucao de seeds (opcional)**
   - Se `autoExecuteSeeds=true`, executa seeds faltantes.
3. **Validacao do estado**
   - Confirma que dependencias foram satisfeitas.
4. **Conversao flow -> gravação RPA**
   - Gera gravacao deterministica e preview de passos.
5. **Salvamento da gravacao**
   - Persistencia em `tests/rpa/seeds/`.

## Parametros recomendados
- `autoExecuteSeeds=false` em producao (executar manualmente).
- `autoExecuteSeeds=true` em ambientes de teste e homologacao.
- `saveRecording=true` para registrar gravações.

## Observabilidade e auditoria
- Logs do pipeline: `api/services/rpaFlowPipelineService.js`.
- Replay/recording: diretórios `replays/rpa-pipeline/` e `recordings/rpa-pipeline/`.
- Auditoria: eventos `rpa_pipeline_started` e `rpa_pipeline_finished`.

## Rollback (grave erro)
1. Identifique a gravacao gerada (id e path).
2. Remova o arquivo em `tests/rpa/seeds/<recordingId>.json`.
3. Reexecute o pipeline com seeds corrigidos.

## Sinais de falha comuns
- Dependencias faltantes mesmo apos seeds.
- Gravacao vazia (0 passos).
- Erros de persistencia no sistema de arquivos.

## Checklist rapido
- [ ] Dependencias resolvidas
- [ ] Seeds corretos (se aplicavel)
- [ ] Gravacao gerada e salva
- [ ] Auditoria registrada
