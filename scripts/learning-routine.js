#!/usr/bin/env node
'use strict';

/**
 * Learning Routine — rotina agregadora de aprendizado (RAP Learn).
 *
 * Roda uma vez e sai — agendar via systemd timer ou cron (NUNCA setInterval).
 * Exemplo cron (diário às 6h):  0 6 * * * cd /opt/results/ria/r-agent2 && npm run learning:routine
 *
 * Variáveis:
 *   LEARN_TENANT_ID     tenant alvo (default: system)
 *   LEARN_WINDOW_HOURS  janela de análise em horas (default: 24)
 *   LEARN_MIN_GROUP     ocorrências mínimas p/ processar grupo (default: 3)
 *   LEARN_DRY_RUN=1     não persiste nada, só gera relatório
 *   LEARN_NO_AI=1       pula geração de sugestão via IA (usa determinística)
 *   LEARN_AUTOPROMOTE=1 ativa auto-promoção com QA gate (DESLIGADO por padrão;
 *                       decisão de política de 2026-07-22 — ver
 *                       api/services/learningAutoPromotionService.js)
 *   LEARN_MIN_CONFIDENCE limiar de confiança p/ auto-promoção (default: 0.8)
 *   LEARN_AUTOPROMOTE_QA_CMD comando do gate de QA (default:
 *                       node scripts/governance/validate-qa-governance.js)
 *
 * Saída: reports/learning-routine-latest.json + exit 0 (sucesso) / 1 (falha dura).
 */

const fs = require('fs');
const path = require('path');

const { connect, getSequelize } = require('../api/db/sequelize');
const { runLearningRoutine } = require('../api/services/learningRoutineService');
const logger = require('../api/utils/logger');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const LATEST_REPORT = path.join(REPORTS_DIR, 'learning-routine-latest.json');

async function main() {
  const tenantId = process.env.LEARN_TENANT_ID || 'system';
  const dryRun = process.env.LEARN_DRY_RUN === '1';
  const useAi = process.env.LEARN_NO_AI !== '1';

  await connect(30, 1000);

  // IA é opcional e best-effort: se não houver provider configurado para o
  // tenant, o serviço cai no fallback determinístico (registrado no relatório).
  let generateAiText = null;
  if (useAi) {
    const { generateAiResponse } = require('../api/services/aiProviderService');
    generateAiText = async (prompt, tid) => {
      const result = await generateAiResponse(prompt, tid, { caller: 'learning-routine' });
      return result?.text || '';
    };
  }

  const report = await runLearningRoutine({
    tenantId,
    windowHours: process.env.LEARN_WINDOW_HOURS,
    minGroupSize: process.env.LEARN_MIN_GROUP,
    dryRun,
    generateAiText,
  });

  // Estágio opcional de auto-promoção (Opção 3): DESLIGADO por padrão.
  // Ativação exige LEARN_AUTOPROMOTE=1 explícito. O gate de QA executável
  // roda dentro do serviço; aqui apenas repassamos comando/limiar.
  let autoPromotionReport = null;
  if (process.env.LEARN_AUTOPROMOTE === '1') {
    const { runAutoPromotion } = require('../api/services/learningAutoPromotionService');
    autoPromotionReport = await runAutoPromotion({
      tenantId,
      minConfidence: process.env.LEARN_MIN_CONFIDENCE,
      dryRun,
      cwd: path.join(__dirname, '..'),
      ...(process.env.LEARN_AUTOPROMOTE_QA_CMD
        ? { qaCommand: process.env.LEARN_AUTOPROMOTE_QA_CMD, qaArgs: [] }
        : {}),
    });
    report.autoPromotion = autoPromotionReport;
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(LATEST_REPORT, JSON.stringify(report, null, 2));

  console.log(`[learning-routine] tenant=${tenantId} janela=${report.windowHours}h dryRun=${dryRun}`);
  console.log(`[learning-routine] falhas na janela: ${report.failuresInWindow} | pendentes: ${report.pendingDetected}`);
  console.log(`[learning-routine] grupos: ${report.groupsFound} | processados: ${report.groupsProcessed} | classificados: ${report.classified} | sugestões: ${report.suggestions}`);
  if (autoPromotionReport) {
    console.log(`[learning-routine] auto-promoção: candidatos=${autoPromotionReport.candidates} | promovidos=${autoPromotionReport.promoted} | rejeitados=${autoPromotionReport.rejected} | ignorados=${autoPromotionReport.skipped}`);
  }
  if (report.aiFallbacks.length > 0) {
    console.log(`[learning-routine] IA indisponível em ${report.aiFallbacks.length} grupo(s) — fallback determinístico aplicado`);
  }
  if (report.errors.length > 0) {
    console.log(`[learning-routine] ${report.errors.length} erro(s) parciais — ver ${path.relative(process.cwd(), LATEST_REPORT)}`);
  }
  console.log(`[learning-routine] relatório: ${LATEST_REPORT}`);
}

main()
  .then(async () => {
    const sequelize = getSequelize();
    if (sequelize) await sequelize.close().catch(() => {});
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('[learning-routine] Falha dura na rotina', { error: error.message });
    console.error(`[learning-routine] FALHA: ${error.message}`);
    process.exit(1);
  });
