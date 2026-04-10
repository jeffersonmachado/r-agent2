# QA Mesh Pipeline History Reclassification

Data: 2026-04-10

## Resumo

- Objetivo: corrigir históricos do QA Mesh que classificavam bloqueio de pipeline oficial como `flaky`.
- Resultado: 20 arquivos de histórico atualizados, com 38 resultados reclassificados para `pipeline_required`.
- Validação posterior: `legacy_results=0`, `legacy_repair=0`, `legacy_clusters=0`.

## Motivo

Alguns cenários `business-*` eram executados fora do pipeline oficial e falhavam em `core/rpa/cli.js:88` com a mensagem `"business-qa" exige o pipeline oficial`. Em execuções com histórico misto, isso podia ser rotulado como `flaky`, mascarando a causa operacional real.

## Ação executada

- Backend/UI passaram a tratar esse caso como `pipeline_required`.
- O `summary` das execuções passou a expor o contador explícito `pipelineBlocked` para consumo por UI e dashboards.
- Foi executado o saneador `npm run qa:mesh:history:reclassify-pipeline -- --write`.
- O saneador regravou `results`, `summary`, `governance`, `repairPlan` e `intelligence.clusters` dos históricos afetados.

## Históricos saneados

- `qa-mesh/meshHistory/mesh-2026-04-09T00-30-00-145Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T00-45-00-113Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T01-00-00-130Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T01-15-00-106Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T01-30-00-178Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T01-45-00-130Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T02-00-00-114Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T02-15-00-120Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T14-15-00-334Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T14-30-00-374Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T14-45-00-209Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T15-00-00-248Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T16-30-00-254Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T16-45-00-165Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T17-00-00-117Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T17-15-00-448Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T19-15-00-167Z.json`
- `qa-mesh/meshHistory/mesh-2026-04-09T19-30-00-201Z.json`
- `qa-mesh/meshHistory/meshq-1775782141950-19lxuo.json`
- `qa-mesh/meshHistory/meshq-1775782521108-w84lk5.json`

## Comandos de verificação

```bash
npm exec -- jest --no-coverage --runInBand --runTestsByPath qa-mesh/__tests__/meshRunner.test.js qa-mesh/__tests__/qaMeshService.test.js
python3 - <<'PY'
from pathlib import Path
import json
root = Path('qa-mesh/meshHistory')
legacy_results = []
legacy_repair = []
legacy_clusters = []
for path in root.glob('*.json'):
    data = json.loads(path.read_text(encoding='utf-8'))
    for result in data.get('results', []):
        text = ' | '.join([
            str(result.get('errorMessage') or ''),
            *[str(x.get('message') if isinstance(x, dict) else x) for x in result.get('logs', [])],
            *[str(x.get('error') if isinstance(x, dict) else x) for x in result.get('errors', [])],
        ]).lower()
        if 'exige o pipeline oficial' in text and result.get('failureType') == 'flaky':
            legacy_results.append(path.name)
    for item in data.get('repairPlan', {}).get('orderedFixList', []):
        if item.get('errorMessage') == '/opt/results/ria/r-agent2/core/rpa/cli.js:88' and item.get('failureType') == 'flaky':
            legacy_repair.append(path.name)
    for cluster in data.get('intelligence', {}).get('clusters', []):
        if 'exige o pipeline oficial' in str(cluster.get('sampleError', '')).lower() and cluster.get('failureType') == 'flaky':
            legacy_clusters.append(path.name)
print(f'legacy_results={len(set(legacy_results))}')
print(f'legacy_repair={len(set(legacy_repair))}')
print(f'legacy_clusters={len(set(legacy_clusters))}')
PY
```