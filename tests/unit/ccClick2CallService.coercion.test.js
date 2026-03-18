'use strict';

const fs = require('fs');
const path = require('path');

describe('ccClick2CallService coercion hardening', () => {
  const originalOriginateEnabled = process.env.AMI_ORIGINATE_ENABLED;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.AMI_ORIGINATE_ENABLED = 'true';
  });

  afterAll(() => {
    if (originalOriginateEnabled === undefined) delete process.env.AMI_ORIGINATE_ENABLED;
    else process.env.AMI_ORIGINATE_ENABLED = originalOriginateEnabled;
  });

  test('createClick2CallRequest tolerates hostile originate error.message getter', async () => {
    const hostileError = {
      code: 'ami_boom',
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const update = jest.fn(async function updateMock(values) {
      this.status = values.status;
      this.extra = values.extra;
      return this;
    });

    jest.doMock('../../api/services/asterisk/amiClient', () => ({
      originate: jest.fn(async () => {
        throw hostileError;
      }),
    }));

    jest.doMock('../../api/db/models', () => ({
      CcClick2CallRequest: jest.fn(() => ({
        create: jest.fn(async (values) => ({
          ...values,
          createdAt: '2026-03-18T00:00:00.000Z',
          update,
        })),
      })),
    }));

    const { createClick2CallRequest } = require('../../api/services/cc/ccClick2CallService');

    const out = await createClick2CallRequest({
      tenantKey: 'tenant-1',
      payload: {
        target: '1001',
        phone: '+5511999999999',
        originate: { channel: 'SIP/1001' },
      },
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      extra: expect.objectContaining({
        originateError: {
          code: 'ami_boom',
          message: '',
        },
      }),
    }));
    expect(out.status).toBe('failed');
    expect(out.extra.originateError).toEqual({ code: 'ami_boom', message: '' });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/cc/ccClick2CallService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});