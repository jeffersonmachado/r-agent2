import { describe, it, expect, vi } from 'vitest';
import { handlePipelineApiError } from './apiErrorHandler';

describe('apiErrorHandler', () => {
  it('ao receber SCRAPE_FAILED dispara toast error', () => {
    const showToast = vi.fn();
    const err = {
      body: {
        error: {
          code: 'SCRAPE_FAILED',
          message: 'Falha ao raspar URL',
          details: { url: 'https://studiooly.com.br/' },
        },
      },
    };

    handlePipelineApiError(err, { showToast });

    expect(showToast).toHaveBeenCalled();
    const [, type] = showToast.mock.calls[0];
    expect(type).toBe('error');
  });

  it('ao receber PROVIDER_QUOTA_EXCEEDED mostra mensagem de quota', () => {
    const showToast = vi.fn();
    const err = {
      status: 402,
      body: {
        error: {
          code: 'PROVIDER_QUOTA_EXCEEDED',
          message: 'You exceeded your current quota',
          details: { tenantId: 'system', providerErrorCode: 'insufficient_quota' },
        },
      },
    };

    handlePipelineApiError(err, { showToast });

    expect(showToast).toHaveBeenCalled();
    const [msg, type] = showToast.mock.calls[0];
    expect(type).toBe('error');
    expect(String(msg)).toMatch(/cota do provider/i);
  });
});

