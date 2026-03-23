'use strict';

const fs = require('fs');
const path = require('path');

const HOTSPOT_FILES = [
  'api/services/rpaService.js',
  'api/services/ragDocumentsService.js',
  'api/services/flowGeneratorService.js',
  'api/services/tenantService.js',
  'api/services/queueService.js',
  'api/services/rpaTestGeneratorService.js',
  'api/services/generationOrchestrator.js',
  'api/services/ragService.js',
];

describe('defensive coercion shared utility guardrail', () => {
  test('shared utility exports expected helpers', () => {
    const utilsPath = path.join(process.cwd(), 'api', 'utils', 'defensiveCoercion.js');
    const utils = require(utilsPath);

    expect(typeof utils.safeToString).toBe('function');
    expect(typeof utils.safeTrim).toBe('function');
    expect(typeof utils.safeTrimLower).toBe('function');
    expect(typeof utils.safeErrorMessage).toBe('function');
    expect(typeof utils.safeGet).toBe('function');
  });

  test('hotspot services import shared coercion utility', () => {
    const offenders = HOTSPOT_FILES.filter((relativePath) => {
      const absolutePath = path.join(process.cwd(), relativePath);
      const source = fs.readFileSync(absolutePath, 'utf8');
      return !source.includes("require('../utils/defensiveCoercion')");
    });

    expect(offenders).toEqual([]);
  });
});
