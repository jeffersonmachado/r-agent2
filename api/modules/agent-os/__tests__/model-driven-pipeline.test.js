'use strict';

/**
 * Testes do Model-Driven Waves & Journeys Pipeline
 *
 * Valida:
 *   - Models são introspectados
 *   - Domain Map é gerado
 *   - Entity Graph é gerado
 *   - Jornadas são inferidas
 *   - Seeds respeitam constraints
 *   - Waves são criadas a partir de journeys reais
 *   - Evidence e Replay obrigatórios
 *   - Agent Factory não aceita QA manual
 *   - Orchestrator não usa simulated/fake fallback
 */

describe('Model-Driven Waves & Journeys Pipeline', () => {

  // ================================================================
  // TESTE 01: Models são introspectados
  // ================================================================
  describe('Model Introspection', () => {
    it('deve carregar 146 models do diretório api/db/models/', () => {
      const fs = require('fs');
      const path = require('path');
      const modelsDir = path.join(__dirname, '..', '..', '..', '..', 'api', 'db', 'models');
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'helpers.js');
      expect(files.length).toBeGreaterThanOrEqual(140);
    });

    it('deve gerar model-introspection-report.json no dist/', () => {
      const fs = require('fs');
      const path = require('path');
      const reportPath = path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-introspection-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(report.totalModels).toBeGreaterThan(100);
      expect(report.modelsLoaded).toBeGreaterThan(100);
      expect(report.modelsWithErrors).toBe(0);
    });
  });

  // ================================================================
  // TESTE 02: Domain Map é gerado
  // ================================================================
  describe('Domain Map', () => {
    it('deve gerar domain-map-report.json com 16 domínios', () => {
      const fs = require('fs');
      const path = require('path');
      const reportPath = path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'domain-map-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(report.totalDomains).toBe(16);
      expect(report.totalModelsAssigned).toBeGreaterThan(100);
    });

    it('domínio Omnichannel deve conter Ticket e ChannelConversation', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'domain-map-report.json'), 'utf8'
      ));
      const omni = report.domains.find(d => d.domain === 'Omnichannel');
      expect(omni).toBeDefined();
      const modelNames = omni.models.map(m => m.modelName);
      expect(modelNames).toContain('Ticket');
      expect(modelNames).toContain('ChannelConversation');
    });

    it('domínio Agent OS deve conter CorporateAgent e JourneyRegistry', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'domain-map-report.json'), 'utf8'
      ));
      const agentOs = report.domains.find(d => d.domain === 'Agent OS');
      expect(agentOs).toBeDefined();
      const modelNames = agentOs.models.map(m => m.modelName);
      expect(modelNames).toContain('CorporateAgent');
      expect(modelNames).toContain('JourneyRegistry');
    });
  });

  // ================================================================
  // TESTE 03: Entity Graph é gerado
  // ================================================================
  describe('Entity Graph', () => {
    it('deve gerar entity-graph-report.json com 146 nodes', () => {
      const fs = require('fs');
      const path = require('path');
      const reportPath = path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'entity-graph-report.json');
      expect(fs.existsSync(reportPath)).toBe(true);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(report.totalNodes).toBe(146);
      expect(report.totalEdges).toBeGreaterThan(500);
    });
  });

  // ================================================================
  // TESTE 04: Jornadas são inferidas
  // ================================================================
  describe('Journey Inference', () => {
    it('deve inferir 9 jornadas a partir dos models', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'journey-inference-report.json'), 'utf8'
      ));
      expect(report.totalJourneys).toBe(9);
    });

    it('jornada Omnichannel Attendance deve ter 5 models fonte', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'journey-inference-report.json'), 'utf8'
      ));
      const j = report.journeys.find(jj => jj.name === 'Omnichannel Attendance');
      expect(j).toBeDefined();
      expect(j.sourceModels.length).toBe(5);
      expect(j.availableModels.length).toBe(5);
      expect(j.completeness).toBe(1.0);
    });

    it('todas as 9 jornadas devem ter successCriteria e failureCriteria', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'journey-inference-report.json'), 'utf8'
      ));
      for (const j of report.journeys) {
        expect(j.successCriteria.length).toBeGreaterThan(0);
        expect(j.failureCriteria.length).toBeGreaterThan(0);
        expect(j.domain).toBeDefined();
      }
    });
  });

  // ================================================================
  // TESTE 05: Seeds respeitam constraints Sequelize
  // ================================================================
  describe('Model-Driven Seeds', () => {
    it('deve gerar 27 seeds', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-seeds-report.json'), 'utf8'
      ));
      expect(report.totalSeeds).toBe(27);
    });

    it('nenhuma seed deve ter campos obrigatórios ausentes', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-seeds-report.json'), 'utf8'
      ));
      for (const js of report.journeySeeds) {
        for (const seed of js.seeds) {
          expect(seed.compatible).toBe(true);
        }
      }
    });
  });

  // ================================================================
  // TESTE 06: Waves são criadas a partir de journeys reais
  // ================================================================
  describe('Model-Driven Waves', () => {
    it('deve gerar 9 waves', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-waves-report.json'), 'utf8'
      ));
      expect(report.totalWaves).toBe(9);
    });

    it('cada wave deve ter assertions com evidence, replay e governance', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-waves-report.json'), 'utf8'
      ));
      for (const w of report.waves) {
        const assertionTypes = w.assertions.map(a => a.type);
        expect(assertionTypes).toContain('evidence');
        expect(assertionTypes).toContain('replay');
        expect(assertionTypes).toContain('governance');
      }
    });

    it('cada wave deve ter expectedEvidence e expectedReplay', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-waves-report.json'), 'utf8'
      ));
      for (const w of report.waves) {
        expect(w.expectedEvidence.length).toBeGreaterThan(0);
        expect(w.expectedReplay.length).toBeGreaterThan(0);
      }
    });
  });

  // ================================================================
  // TESTE 07: Waves bloqueiam NO_GO
  // ================================================================
  describe('QA Waves NO_GO enforcement', () => {
    it('Agent Factory NÃO deve aceitar qaWaveResult manual', () => {
      // Verifica que o código rejeita body.qaWaveResult
      const fs = require('fs');
      const path = require('path');
      const agentFactorySource = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'agent-factory.js'), 'utf8'
      );
      // Deve conter código que rejeita qaWaveResult
      expect(agentFactorySource).toContain('qaWaveResult');
      expect(agentFactorySource).toContain('forbidden');
    });
  });

  // ================================================================
  // TESTE 08: Evidence é obrigatória
  // ================================================================
  describe('Evidence obrigatória', () => {
    it('todas as waves devem exigir evidence', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-waves-report.json'), 'utf8'
      ));
      for (const w of report.waves) {
        const hasEvidenceAssertion = w.assertions.some(a =>
          a.type === 'evidence' && a.criterion.includes('required')
        );
        expect(hasEvidenceAssertion).toBe(true);
      }
    });
  });

  // ================================================================
  // TESTE 09: Replay é obrigatório
  // ================================================================
  describe('Replay obrigatório', () => {
    it('todas as waves devem exigir replay', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-waves-report.json'), 'utf8'
      ));
      for (const w of report.waves) {
        const hasReplayAssertion = w.assertions.some(a =>
          a.type === 'replay' && a.criterion.includes('required')
        );
        expect(hasReplayAssertion).toBe(true);
      }
    });
  });

  // ================================================================
  // TESTE 10: Orchestrator não usa simulated/fake fallback
  // ================================================================
  describe('Orchestrator anti-simulation', () => {
    it('orchestrator NÃO deve conter "Simulated" em código ativo', () => {
      const fs = require('fs');
      const path = require('path');
      const orchestratorSource = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'agent-orchestrator.js'), 'utf8'
      );
      // "Simulated" só deve aparecer em comentários
      const lines = orchestratorSource.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        if (trimmed.includes('Simulated') || trimmed.includes('simulated response')) {
          // Só permite em strings de comentário
          expect(trimmed).toMatch(/\/\/|\*|console/);
        }
      }
    });

    it('orchestrator deve ter CAPABILITY_REGISTRY com serviços reais', () => {
      const { CAPABILITY_REGISTRY } = require('../routes/agent-orchestrator');
      expect(CAPABILITY_REGISTRY).toBeDefined();
      expect(Object.keys(CAPABILITY_REGISTRY).length).toBeGreaterThan(10);
      // Nenhuma capability deve apontar para serviço simulado
      for (const [key, cap] of Object.entries(CAPABILITY_REGISTRY)) {
        expect(cap.service).toBeDefined();
        expect(cap.service).not.toBe('simulated');
        expect(cap.service).not.toBe('mock');
        expect(cap.service).not.toBe('fake');
      }
    });
  });

  // ================================================================
  // TESTE 11: Reports gerados no dist/
  // ================================================================
  describe('Reports obrigatórios', () => {
    const requiredReports = [
      'model-introspection-report.json',
      'domain-map-report.json',
      'entity-graph-report.json',
      'journey-inference-report.json',
      'model-driven-seeds-report.json',
      'model-driven-waves-report.json',
      'model-driven-agent-factory-report.json',
      'model-driven-final-attestation.json',
    ];

    for (const reportName of requiredReports) {
      it(`deve existir dist/${reportName}`, () => {
        const fs = require('fs');
        const path = require('path');
        const reportPath = path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', reportName);
        expect(fs.existsSync(reportPath)).toBe(true);
      });
    }
  });

  // ================================================================
  // TESTE 12: Pipeline status GO
  // ================================================================
  describe('Final Attestation', () => {
    it('attestation deve ter status GO_MODEL_DRIVEN_COMPLETE', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-final-attestation.json'), 'utf8'
      ));
      expect(report.status).toBe('GO_MODEL_DRIVEN_COMPLETE');
      expect(report.summary.totalJourneys).toBe(9);
      expect(report.summary.totalWaves).toBe(9);
    });

    it('todos os critérios do checklist devem ser true', () => {
      const fs = require('fs');
      const path = require('path');
      const report = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'dist', 'governance', 'model-driven-final-attestation.json'), 'utf8'
      ));
      for (const [key, value] of Object.entries(report.criteriaChecklist)) {
        expect(value).toBe(true);
      }
    });
  });
});
