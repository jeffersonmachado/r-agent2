import { describe, it, expect } from 'vitest';
import { isDocForDomain } from './QaWavesDocsTab';

describe('qa-waves/QaWavesDocsTab > isDocForDomain', () => {
  it('reconhece roteiros por prefixo jornada-<domínio>-', () => {
    expect(isDocForDomain('jornada-fitness-leads.md', 'fitness')).toBe(true);
    expect(isDocForDomain('jornada-beauty-beauty_booking.md', 'beauty')).toBe(true);
    expect(isDocForDomain('jornada-fitness-leads.md', 'beauty')).toBe(false);
  });

  it('reconhece diagramas verticais e de jornada', () => {
    expect(isDocForDomain('vertical-fitness.md', 'fitness')).toBe(true);
    expect(isDocForDomain('journey-fitness-leads-fitness_matricula_leads.md', 'fitness')).toBe(true);
    expect(isDocForDomain('vertical-fitness.md', 'beauty')).toBe(false);
  });

  it('trata aliases de domínio (clinic/clinica, market/mercado, services/servicos)', () => {
    expect(isDocForDomain('vertical-clinica.md', 'clinic')).toBe(true);
    expect(isDocForDomain('jornada-clinic-clinic_default_journey.md', 'clinic')).toBe(true);
    expect(isDocForDomain('vertical-mercado.md', 'market')).toBe(true);
    expect(isDocForDomain('vertical-servicos.md', 'services')).toBe(true);
  });

  it('reconhece treinamentos por domínio', () => {
    expect(isDocForDomain('treinamento-fitness-agendamento-ui.md', 'fitness')).toBe(true);
    expect(isDocForDomain('treinamento-jornada-fitness-leads.md', 'fitness')).toBe(true);
    expect(isDocForDomain('treinamento-support-inbox-nota-ui.md', 'fitness')).toBe(false);
  });

  it('retorna false para entradas ausentes ou sem domínio', () => {
    expect(isDocForDomain(null, 'fitness')).toBe(false);
    expect(isDocForDomain('manual-atendimento-nota-interna.md', 'fitness')).toBe(false);
    expect(isDocForDomain('README.md', 'fitness')).toBe(false);
    expect(isDocForDomain('architecture-governance-flow.md', 'fitness')).toBe(false);
  });
});
