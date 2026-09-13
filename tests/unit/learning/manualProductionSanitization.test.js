'use strict';

/**
 * A1–A6 — SANITIZAÇÃO DE MANUAL PRODUCTION (RED→GREEN).
 *
 * Reprodução do defeito real (2026-09-12):
 *   - `api/modules/learning-core/manualService.js#renderManualMarkdown` emitia
 *     `> Fonte: replay real \`<replayId>\`` e `(alvo \`#selector\`)` em manual
 *     classificado `MANUAL_CLASSIFICATION = 'PRODUCTION'`;
 *   - `docs/roteiros/jornada-*.md` (que o `scripts/rag-sync.js` classifica como
 *     OPERATIONAL/PRODUCTION e indexa no RAG) continham `replay=true`,
 *     `Replay (se aplicável)`, `waveScenarioSchema.js`,
 *     `POST /api/qa-waves/intelligence/generate-scenario`, `npx playwright install`
 *     e `npm run validate:replay-governance`.
 */

const fs = require('fs');
const path = require('path');

const {
  detectProductionLeaks,
  sanitizeProductionText,
  assertProductionClean,
} = require('../../../api/services/learning/manualSanitizer');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ROTEIROS_DIR = path.join(REPO_ROOT, 'docs', 'roteiros');

describe('A — sanitizacao de conteudo PRODUCTION', () => {
  describe('detector de vazamento', () => {
    it.each([
      ['replay id', 'Fonte: replay real `abc-123`'],
      ['replay generico', 'Falhou no replay da jornada'],
      ['palavra selector tecnica', 'Use o selector: #save-button'],
      ['seletor tecnico com igual', 'seletor = .confirm-btn'],
      ['xpath', 'xpath=//div[@id="x"]'],
      ['crase de seletor css', 'Clique no alvo `#membership-button`'],
      ['crase de classe', 'Acione o elemento `.btn-primary`'],
      ['atributo css', 'Localize [data-testid="save"]'],
      ['engine playwright', 'css=#main > div'],
      ['qa wave', 'validado na QA Wave 3'],
      ['qa mesh', 'executado no QA Mesh'],
      ['wave schema', 'conforme waveScenarioSchema.js'],
      ['endpoint interno', 'use POST /api/qa-waves/intelligence/generate-scenario'],
      ['caminho qa', 'a evidencia fica em qa-mesh/meshHistory/'],
      ['comando de gate', 'rode npm run validate:replay-governance'],
      ['playwright', 'instale com npx playwright install'],
      ['uiTrace', 'o passo veio do uiTrace'],
      ['scenarioId', 'cenario scenarioId=abc'],
      ['seedId', 'semente seedId=abc'],
      ['atribuicao de seed', 'seed = 42'],
      ['onda de QA numerada', 'validado na Wave 3'],
      ['rota tecnica de dev', 'abra a pagina /dev/tools'],
      ['rota tecnica de replays', 'navegue para /rpa-replays'],
      ['trace bruto', 'raw trace anexado a execucao'],
    ])('detecta %s', (_label, text) => {
      expect(detectProductionLeaks(text).length).toBeGreaterThan(0);
    });

    it.each([
      ['titulo markdown', '# Passo a passo'],
      ['numeracao', 'Passo #1 da jornada'],
      ['palavra legitima com replay dentro', 'A plataforma permite reproduzir o atendimento'],
      ['matricula', 'Acesse Matrícula para liberar o acesso'],
      ['texto operacional comum', 'Confirme o pagamento e entregue o comprovante ao aluno.'],
      ['decimal', 'O valor total é R$ 129,90 (12x de 10,83)'],
      ['hifen comum', 'check-in e check-out do aluno'],
      ['moldura entre colchetes nao-seletor', 'Veja o item [Importante] no rodapé'],
      ['nome de componente de UI', 'Seletor de data no formato dd/MM/yyyy. Clique na seta para avançar ou recuar dias.'],
      ['prosa comum com a palavra selector', 'Use o seletor de canal para escolher por onde responder.'],
      ['recurso de produto QA/RPA', 'Busca de entidade unificada por contato, conversa, ticket, QA/RPA e operação.'],
      ['painel de qualidade', 'QA, estabilidade e malha de execução unificada.'],
      ['gerador de seeds do produto', 'Gerador de sistemas, fluxos, RPAs e seeds via IA.'],
      ['nome de campanha com QA', 'Campo "QA Beauty Campaign" identifica qual campanha de disparo gerou o lead.'],
    ])('NAO produz falso positivo em %s', (_label, text) => {
      expect(detectProductionLeaks(text)).toEqual([]);
    });
  });

  describe('sanitizacao', () => {
    it('remove replayId e mantem o restante da frase util', () => {
      const { text } = sanitizeProductionText('Acesse Matrícula e confirme. Fonte: replay real `r-1`.');
      expect(detectProductionLeaks(text)).toEqual([]);
      expect(text).toContain('Acesse Matrícula');
    });

    it('transforma alvo tecnico em orientacao operacional sem sobrar parentese orfao', () => {
      const { text } = sanitizeProductionText('Ação: **Clique** (alvo `#membership-button`)');
      expect(detectProductionLeaks(text)).toEqual([]);
      expect(text).not.toContain('(');
      expect(text).toContain('Clique');
    });

    it('remove bloco de citacao de rastreabilidade interna', () => {
      const md = ['# Manual', '', '> Fonte: replay real `x` · Jornada: `j`', '> Valores de campos anonimizados (3).', '', 'Acesse Matrícula.'].join('\n');
      const { text, findings } = sanitizeProductionText(md);
      expect(findings.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/>\s*Fonte/i);
      expect(text).toContain('Acesse Matrícula.');
    });

    it('assertProductionClean falha fechado com codigo auditavel', () => {
      expect(() => assertProductionClean('rode npm run validate:replay-governance', 'teste')).toThrow(/production_content_leak/);
      try {
        assertProductionClean('uso de replay', 'teste');
      } catch (error) {
        expect(error.code).toBe('PRODUCTION_CONTENT_LEAK');
        expect(Array.isArray(error.findings)).toBe(true);
      }
    });

    it('texto limpo passa inalterado', () => {
      const clean = '# Manual do operador\n\nAcesse Matrícula e confirme o pagamento.';
      const result = sanitizeProductionText(clean);
      expect(result.changed).toBe(false);
      expect(result.text).toBe(clean);
    });
  });

  describe('A4 — artefatos reais do repositorio classificados como PRODUCTION', () => {
    const files = fs.existsSync(ROTEIROS_DIR)
      ? fs.readdirSync(ROTEIROS_DIR).filter((f) => f.startsWith('jornada-') && f.endsWith('.md'))
      : [];

    it('existe ao menos um runbook de jornada para validar', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('docs/roteiros/%s nao expoe detalhe interno', (file) => {
      const content = fs.readFileSync(path.join(ROTEIROS_DIR, file), 'utf8');
      const leaks = detectProductionLeaks(content);
      expect(leaks.map((l) => `${l.ruleId}:${l.match}`)).toEqual([]);
    });

    it('a prova interna continua auditavel (nao foi destruida)', () => {
      // A rastreabilidade tecnica migra para artefato interno, nao some.
      const provenanceDir = path.join(REPO_ROOT, 'qa-waves', 'journey-provenance');
      expect(fs.existsSync(provenanceDir)).toBe(true);
      const files2 = fs.readdirSync(provenanceDir).filter((f) => f.endsWith('.json'));
      expect(files2.length).toBeGreaterThan(0);
      const sample = JSON.parse(fs.readFileSync(path.join(provenanceDir, files2[0]), 'utf8'));
      expect(sample.classification).toBe('DEVELOPMENT');
    });
  });

  describe('A1 — manual gerado pelo Learning Core nao vaza replay nem seletor', () => {
    const manualService = require('../../../api/modules/learning-core/manualService');

    it('MANUAL_CLASSIFICATION continua PRODUCTION', () => {
      expect(manualService.MANUAL_CLASSIFICATION || 'PRODUCTION').toBe('PRODUCTION');
    });

    it('render do manual nao contem replay/selector/tecnico', () => {
      const rendered = manualService.__renderManualMarkdownForTest({
        title: 'Manual de teste',
        replayId: 'replay-abc-123',
        journeyKey: 'fitness_customer_checkin',
        stats: { redactions: 2 },
        steps: [
          { order: 1, name: 'Abrir matrícula', label: 'Clique em Matrícula', selector: '#membership-button', value: null, success: true, image: null },
          { order: 2, name: 'Confirmar', label: 'Confirme o pagamento', selector: '.confirm-btn', value: 'ok', success: false, image: null },
        ],
      });

      expect(detectProductionLeaks(rendered)).toEqual([]);
      expect(rendered).not.toContain('replay-abc-123');
      expect(rendered).not.toContain('#membership-button');
      expect(rendered).not.toContain('.confirm-btn');
      expect(rendered).toContain('Abrir matrícula');
    });
  });
});
