# RPA Reliability Handbook - 09 Evidence and Reports

## Objetivo
Garantir auditoria completa de falhas e recuperacoes.

## Diretorio Padrao
`tests/rpa/reports/bugs/`

## Tipos de Artefato
- JSON estruturado com classificacao, owner, strategies e decisao final.
- Markdown legivel para analise humana.
- Screenshot(s) de contexto.

## Campos Recomendados
- fingerprint
- classification
- owner
- pageStateHash
- recoveryPlan
- strategiesAttempted
- finalDecision
- patchSuggestions

## Exemplo de Resultado
`bugEvidenceGenerator` grava arquivos vinculados ao fingerprint e timestamp.

## Limitacoes
- Evidencias grandes podem consumir espaco rapidamente.

## Boas Praticas
- Implementar politica de retencao por ambiente.
- Enviar apenas sumario para canais de alerta; manter detalhe no arquivo.
