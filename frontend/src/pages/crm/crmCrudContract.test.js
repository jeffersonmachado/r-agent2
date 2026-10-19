import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

/**
 * REGRESSÃO — CRUD do CRM: guarda de resposta, contrato de campos e kanban.
 *
 * DEFEITOS MEDIDOS na jornada real (2026-10-19, systemadmin/tenant system):
 *
 * 1) CONTAS — silêncio após salvar: `if (response.account)` nunca era verdadeiro
 *    porque a API devolve a conta DIRETO. A conta era gravada, o modal ficava
 *    aberto, a lista não recarregava e nenhum toast aparecia (clique duplo criou
 *    2 registros iguais).
 * 2) CONTAS — filtro "Ativo" escondia tudo: a UI tem coluna e filtro de Status,
 *    mas a API não persistia `status`.
 * 3) OPORTUNIDADES — título descartado: a UI enviava `title`, a API grava `name`
 *    (nascia "Nova Oportunidade"); `expectedClosureDate`/`description` também
 *    divergiam de `expectedCloseDate`/`notes`.
 * 4) OPORTUNIDADES — kanban sempre vazio: filtrava por `pipeline_id`/`stage_id`
 *    enquanto a API devolve `pipelineId`/`stageId`.
 * 5) OPORTUNIDADES — card avançava de etapa em QUALQUER `dragEnd`.
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

describe('CRM Contas — resposta direta da API não pode silenciar o salvamento', () => {
  const pagina = semComentarios(LER('AccountsPage.jsx'));

  it('não depende de wrapper `response.account`', () => {
    expect(pagina).not.toMatch(/if \(response\.account\)/);
    expect(pagina).toContain('response?.account');
    expect(pagina).toContain('response?.id');
  });

  it('status da conta é exibido com rótulo legível', () => {
    expect(pagina).toContain('ACCOUNT_STATUS_LABELS');
  });
});

describe('CRM Oportunidades — contrato de campos e kanban', () => {
  const pagina = semComentarios(LER('OpportunitiesPage.jsx'));

  it('mapeia os campos da UI para o contrato da API', () => {
    expect(pagina).toContain('name: formData.title');
    expect(pagina).toContain('expectedCloseDate:');
    expect(pagina).toContain('notes: formData.description');
  });

  it('kanban usa camelCase com fallback para registro legado', () => {
    expect(pagina).toContain('opp.pipelineId || opp.pipeline_id');
    expect(pagina).toContain('opp.stageId || opp.stage_id');
  });

  it('não depende de wrapper `response.opportunity`', () => {
    expect(pagina).not.toMatch(/if \(response\.opportunity\)/);
  });

  it('mover etapa exige soltar na coluna de destino (sem dragEnd cego)', () => {
    expect(pagina).not.toContain('onDragEnd');
    expect(pagina).toContain('onDrop');
    expect(pagina).toContain("e.dataTransfer.getData('text/plain')");
  });
});
