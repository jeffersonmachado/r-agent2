'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = '/tmp/p0-bugclosure';
const { carregarInventario } = require(path.join(ROOT, 'governance/bug-closure/defect-registry'));
const { evaluateExecutionEligibility } = require(path.join(ROOT, 'governance/bug-closure/eligibility'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-bypass-'));
const fila = (state, status) => ({
  items: [{
    id: 'P1-DEMO-BYPASS',
    title: 'defeito P1 sem prova de correcao',
    status,
    ...(state ? { state } : {}),
    severity: 'P1',
    evidence: 'afirmacao sem execucao',
  }],
});
const avaliar = (rotulo, state, status) => {
  const p = path.join(dir, `fila-${rotulo}.json`);
  fs.writeFileSync(p, JSON.stringify(fila(state, status), null, 2));
  const inv = carregarInventario({ queuePath: p });
  const d = evaluateExecutionEligibility(
    { commit: '0023634244ad05b3e2a01a61987a244c30ea75b2', actor: { id: 'probe', kind: 'script' }, defects: inv.defeitos },
    'SELO_FINAL'
  );
  console.log(`${rotulo}: decision=${d.decision} allowed=${d.allowed} codes=${(d.reasonCodes||[]).join(',')}`);
  return d;
};
const antes = avaliar('01-p1-aberto', 'OPEN', 'pending');
const depois = avaliar('02-json-editado', 'RESOLVED', 'prevention_active');
const soStatus = avaliar('03-so-status-legado', null, 'prevention_active');
console.log('BYPASS_REPRODUZIDO =', antes.allowed === false && depois.allowed === true);
console.log('BYPASS_POR_STATUS_LEGADO =', soStatus.allowed === true);
