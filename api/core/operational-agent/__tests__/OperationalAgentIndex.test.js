'use strict';

describe('operational-agent compatibility index', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('exposes OperationalAgentService as the explicit legacy entrypoint', () => {
    const facade = require('..');
    const { OperationalAgentService } = require('../OperationalAgentService');

    expect(facade.OperationalAgentService).toBe(OperationalAgentService);
  });

  test('emits a deprecation warning once per legacy export access', () => {
    const warningSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
    const facade = require('..');

    const first = facade.SignalService;
    const second = facade.SignalService;

    expect(typeof first).toBe('function');
    expect(second).toBe(first);
    expect(warningSpy).toHaveBeenCalledTimes(2);

    const codes = warningSpy.mock.calls
      .map((call) => call?.[1]?.code)
      .filter(Boolean);

    expect(codes).toEqual(expect.arrayContaining([
      facade.LEGACY_INDEX_EXPORT_WARNING_CODE,
      'OperationalAgentShimDeprecated',
    ]));
  });
});
