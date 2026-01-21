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
});

