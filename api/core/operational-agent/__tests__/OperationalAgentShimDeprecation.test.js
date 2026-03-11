'use strict';

describe('operational-agent shim deprecations', () => {
  const previousStrictEnv = process.env.OPERATIONAL_AGENT_SHIM_STRICT;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    if (previousStrictEnv == null) {
      delete process.env.OPERATIONAL_AGENT_SHIM_STRICT;
    } else {
      process.env.OPERATIONAL_AGENT_SHIM_STRICT = previousStrictEnv;
    }
  });

  test('emits warning once per shim module', () => {
    const warningSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});

    require('../SignalService');
    require('../SignalService');

    expect(warningSpy).toHaveBeenCalledTimes(1);
    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining('SignalService in api/core/operational-agent is deprecated'),
      expect.objectContaining({
        code: 'OperationalAgentShimDeprecated',
        type: 'DeprecationWarning',
      }),
    );
  });

  test('emits independent warnings for different shims', () => {
    const warningSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});

    require('../SignalService');
    require('../SignalQueryService');

    expect(warningSpy).toHaveBeenCalledTimes(2);
  });

  test('blocks shim import in strict mode', () => {
    process.env.OPERATIONAL_AGENT_SHIM_STRICT = 'true';

    expect(() => require('../SignalService')).toThrow(
      'SignalService in api/core/operational-agent is disabled in strict mode',
    );
  });
});
