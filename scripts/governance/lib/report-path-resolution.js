'use strict';

/**
 * report-path-resolution.js — resolução do caminho de um relatório de prova
 * declarado em `config/engineering-router-v2-required-tests.json`.
 *
 * CONVENÇÃO (histórica): o caminho declarado é relativo a `reports/`
 * (`path.join(ROOT, 'reports', rel)`), e declarações como `reports/x.json`
 * funcionam porque o prefixo era removido e recolocado.
 *
 * EXCEÇÃO REAL (medida 2026-10-05, requisito TEMPORAL-06): artefatos
 * autoritativos de governança vivem em `governance/` — é lá que a taxonomia
 * (`config/runtime-evidence-artifacts.json`) e o `ensure-authoritative-artifacts-fresh`
 * os produzem. O leitor antigo prefixava `reports/` SEMPRE, então
 * `governance/mutable-json-state-validation-report.json` era procurado em
 * `reports/governance/...` — inexistente — e o requisito virava UNPROVEN
 * ("relatório de prova ausente") mesmo com os três relatórios presentes, com
 * valor PASS e do run corrente. O V2 seal abortou em REQUIRED_TESTS_V2 por um
 * erro de PATH, não de substância.
 *
 * A resolução devolve candidatos em ordem de precedência (caminho do repositório
 * primeiro; convenção `reports/` depois). Quem lê decide por existência e, sem
 * nenhum candidato existente, reporta o PRIMEIRO — o caminho do repositório —
 * para o diagnóstico apontar o que foi realmente procurado.
 */
function reportPathCandidates(declared) {
  const raw = String(declared || '').trim().replace(/^\.\//, '');
  if (!raw) return [];
  const semPrefixo = raw.replace(/^reports\//, '');
  const candidates = [];
  const add = (candidate) => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  add(raw); // caminho relativo à raiz do repositório (ex.: governance/x.json)
  add(`reports/${semPrefixo}`); // convenção histórica (ex.: governance/x.json -> reports/governance/x.json)
  return candidates;
}

module.exports = { reportPathCandidates };
