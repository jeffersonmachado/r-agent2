'use strict';

describe('operational-compat/playbookCompat', () => {
  test('expõe referência canônica de playbook run', () => {
    const { PLAYBOOK_RUN_REFERENCE_TYPE } = require('../playbookCompat');
    expect(PLAYBOOK_RUN_REFERENCE_TYPE).toBe('operational_playbook_run');
  });
});

describe('operational-compat/modelCompat', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../../db/models');
  });

  test('usa OperationalEvent como fonte soberana quando disponível', () => {
    const operationalEventModel = { model: 'OperationalEvent' };

    jest.doMock('../../../db/models', () => ({
      OperationalEvent: () => operationalEventModel,
      CrmEvent: () => ({ model: 'CrmEvent' }),
      OperationalPlaybookRun: () => ({ model: 'OperationalPlaybookRun' }),
    }));

    const { resolveOperationalEventModel } = require('../modelCompat');
    expect(resolveOperationalEventModel()).toBe(operationalEventModel);
  });

  test('faz fallback para CrmEvent quando OperationalEvent falha', () => {
    const crmEventModel = { model: 'CrmEvent' };

    jest.doMock('../../../db/models', () => ({
      OperationalEvent: () => {
        throw new Error('operational_event_unavailable');
      },
      CrmEvent: () => crmEventModel,
      OperationalPlaybookRun: () => ({ model: 'OperationalPlaybookRun' }),
    }));

    const { resolveOperationalEventModel } = require('../modelCompat');
    expect(resolveOperationalEventModel()).toBe(crmEventModel);
  });

  test('usa OperationalPlaybookRun como fonte soberana', () => {
    const runModel = { model: 'OperationalPlaybookRun' };

    jest.doMock('../../../db/models', () => ({
      OperationalEvent: () => ({ model: 'OperationalEvent' }),
      CrmEvent: () => ({ model: 'CrmEvent' }),
      OperationalPlaybookRun: () => runModel,
    }));

    const { resolveOperationalPlaybookRunModel } = require('../modelCompat');
    expect(resolveOperationalPlaybookRunModel()).toBe(runModel);
  });
});
