# RPA Reliability Handbook - 05 Page State Inspector

## Objetivo
Capturar contexto profundo da pagina no instante da falha.

## Artefatos Capturados
- URL e titulo.
- Hash de estado (`pageStateHash`).
- Trecho de HTML e elementos candidatos.
- Visibilidade e bounding boxes (quando possivel).
- Logs de console e erros HTTP recentes.
- Screenshot da falha.

## Saida Esperada
Objeto estruturado usado por:
- planner de recovery,
- evidence generator,
- bug memory.

## Exemplo de Uso
`tests/rpa/bugResolution/pageStateInspector.js` roda antes do planejamento de recovery.

## Limitacoes
- DOM pode mudar entre captura e proxima tentativa.
- Alguns elementos nao sao serializaveis de forma completa.

## Boas Praticas
- Capturar snapshot imediatamente apos falha.
- Limitar tamanho de payload para evitar custo alto de I/O.
