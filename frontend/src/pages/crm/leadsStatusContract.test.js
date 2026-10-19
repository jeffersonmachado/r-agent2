import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

/**
 * REGRESSÃO — contrato de status/identidade de Leads e client do CRM.
 *
 * DEFEITOS MEDIDOS (2026-10-19, jornada real em `/crm/leads`, tenant system):
 *
 * 1) STATUS DIVERGENTE: o formulário enviava `status: 'new'` (inglês) e a lista
 *    lia `lead.status`, mas o backend persiste `stage` com valores em português
 *    ('novo'|'contactado'|'qualificado'|'perdido'). Todo lead aparecia com
 *    Status "—" e o filtro de status nunca encontrava nada. Verificado no
 *    registro real: `{name:"Sem nome", stage:"novo"}` e a tabela mostrando "—".
 * 2) SEM IDENTIDADE: o formulário não tinha nome/e-mail/telefone, então o
 *    backend caía no default e todo lead nascia como "Sem nome".
 * 3) CLIENT SEM TIMEOUT: `useCrmApi` usava `fetch` cru (mesma classe do painel).
 * 4) TEXTO MISTO: resumo dos filtros dizia `with source "..."`.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const LER = (rel) => readFileSync(join(AQUI, rel), 'utf8');

function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('CRM Leads — status canônico (stage) e identidade do lead', () => {
  const pagina = semComentarios(LER('LeadsPage.jsx'));

  it('envia e lê o campo canônico `stage`', () => {
    expect(pagina).toContain('stage:');
    expect(pagina).toContain('formData.stage');
    expect(pagina).toContain('lead?.stage');
  });

  it('normaliza status legado em inglês para não quebrar registro antigo', () => {
    expect(pagina).toContain('LEGACY_STATUS_ALIASES');
    expect(pagina).toMatch(/new:\s*'novo'/);
  });

  it('o filtro usa os mesmos valores canônicos da API', () => {
    expect(pagina).toContain('option value="novo"');
    expect(pagina).toContain('option value="contactado"');
    expect(pagina).not.toContain('option value="new"');
  });

  it('o formulário exige e envia nome/e-mail/telefone', () => {
    expect(pagina).toContain('formData.name');
    expect(pagina).toContain('formData.email');
    expect(pagina).toContain('formData.phone');
    expect(pagina).toContain('Informe o nome do lead');
  });

  it('resumo dos filtros em português (sem texto misto)', () => {
    expect(pagina).not.toContain('with source');
  });
});

describe('CRM — client compartilhado com timeout (sem fetch cru)', () => {
  const hook = semComentarios(LER('../../hooks/crm/useCrmApi.js'));

  it('usa fetchJson com timeout explícito', () => {
    expect(hook).toContain('fetchJson(');
    expect(hook).toMatch(/timeoutMs:\s*\d+/);
  });

  it('não usa fetch cru', () => {
    expect(hook).not.toMatch(/(^|[^.\w])fetch\s*\(/);
  });
});
