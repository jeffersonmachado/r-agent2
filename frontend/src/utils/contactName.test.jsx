import { describe, expect, it } from 'vitest';
import { normalizeContactName } from './contactName';

describe('normalizeContactName', () => {
  it('ignora placeholders gerados pela interface', () => {
    expect(normalizeContactName('Contato sem nome')).toBeNull();
    expect(normalizeContactName('Contato ••••8492')).toBeNull();
    expect(normalizeContactName('Contato 11988648492')).toBeNull();
  });

  it('preserva nomes reais', () => {
    expect(normalizeContactName('Maria Silva')).toBe('Maria Silva');
    expect(normalizeContactName('Contato Comercial Acme')).toBe('Contato Comercial Acme');
  });
});
