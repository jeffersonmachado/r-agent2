'use strict';

/**
 * qa/seeds/index.js
 *
 * Seeds e fixtures de dados para o sistema de QA.
 * Seeds de RPA ficam em core/rpa/seeds/ — isso aqui são seeds de QA.
 */

const fs = require('fs');
const path = require('path');

const SEEDS_DIR = __dirname;

function listSeeds() {
  return fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'README.json');
}

function loadSeed(name) {
  const p = path.join(SEEDS_DIR, name.endsWith('.json') ? name : `${name}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = { listSeeds, loadSeed };
