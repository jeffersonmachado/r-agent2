#!/usr/bin/env node
'use strict';

/**
 * registered-verticals.js — fonte ÚNICA das verticais registradas.
 *
 * Existe para que dois gates (suficiência e modelo de fases) não possam
 * divergir sobre QUAL é o universo de verticais. Divergir aqui é silencioso e
 * grave: um gate dizendo "7/7 pronto" enquanto o outro mede 7 verticais
 * diferentes produz duas verdades sobre o mesmo sistema.
 *
 * Regra canônica: domínios de `config/verticals.json` cujo `kind` é `vertical`.
 * `kind: 'capability-domain'` (core, pbx, omnichannel, crm...) NÃO é vertical
 * pesquisável — misturar os dois faria o universo de benchmark incluir
 * domínios que não têm amostra nem holdout.
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', '..', '..', 'config', 'verticals.json');

/** @returns {string[]} ids ordenados */
function loadRegisteredVerticals() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (_) {
    return [];
  }
  return Object.entries(registry.domains || {})
    .filter(([, def]) => String(def && def.kind) === 'vertical')
    .map(([id]) => id)
    .sort();
}

module.exports = { REGISTRY_PATH, loadRegisteredVerticals };
