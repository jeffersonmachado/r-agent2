'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const dataTestIdValidationService = require('../qa/dataTestIdValidationService');

describe('dataTestIdValidationService', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'datatestid-'));
    fs.mkdirSync(path.join(tempRoot, 'frontend', 'src', 'components'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('detecta duplicidade e acessibilidade invalida de data-testid', () => {
    const filePath = path.join(tempRoot, 'frontend', 'src', 'components', 'Ticket.jsx');
    fs.writeFileSync(
      filePath,
      [
        '<div>',
        '  <button data-testid="ticket-send-button" aria-label="enviar">Enviar</button>',
        '  <div data-testid="ticket-send-button">acao</div>',
        '</div>',
      ].join('\n'),
      'utf8'
    );

    const scan = dataTestIdValidationService.scanDataTestIds({
      rootDir: tempRoot,
      frontendDir: path.join(tempRoot, 'frontend', 'src'),
    });

    const validation = dataTestIdValidationService.validateCapabilityDataTestIds(
      { id: 'ticket-send' },
      scan
    );

    expect(validation.status).toBe('NO_GO');
    expect(validation.missing).toContain('duplicated_data_testid');
    expect(validation.missing).toContain('inaccessible_data_testid');
    expect(validation.relatedTestIds).toContain('ticket-send-button');
  });

  test('retorna missing_data_testid quando capability nao possui seletor real', () => {
    const filePath = path.join(tempRoot, 'frontend', 'src', 'components', 'Other.jsx');
    fs.writeFileSync(filePath, '<button data-testid="other-button">OK</button>\n', 'utf8');

    const scan = dataTestIdValidationService.scanDataTestIds({
      rootDir: tempRoot,
      frontendDir: path.join(tempRoot, 'frontend', 'src'),
    });

    const validation = dataTestIdValidationService.validateCapabilityDataTestIds(
      { id: 'support-reply-flow' },
      scan
    );

    expect(validation.status).toBe('NO_GO');
    expect(validation.missing).toContain('missing_data_testid');
    expect(validation.remediation.length).toBeGreaterThan(0);
  });
});
