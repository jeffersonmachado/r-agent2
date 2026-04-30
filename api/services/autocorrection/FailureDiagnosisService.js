'use strict';

const fs = require('fs');
const path = require('path');

function safeReadJson(filePath, fallback = null) {
  if (!filePath) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeReadText(filePath, fallback = '') {
  if (!filePath) return fallback;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return fallback;
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function joinText(...parts) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter(Boolean)
    .map((part) => typeof part === 'string' ? part : JSON.stringify(part))
    .join('\n');
}

class FailureDiagnosisService {
  constructor(deps = {}) {
    this.logger = deps.logger || console;
  }

  collectArtifacts({ event = {}, evidence = null }) {
    const sourceRef = evidence?.source_ref || event?.payload?.source_ref || {};
    const metadata = evidence?.metadata || event?.payload?.metadata || {};

    const summaryJson = safeReadJson(sourceRef.summaryPath || metadata.summaryPath || null, null);
    const replayJson = safeReadJson(sourceRef.replayPath || metadata.replayPath || null, null);
    const logPaths = normalizeList(sourceRef.logPaths || metadata.logPaths || metadata.logs);
    const logs = logPaths.map((filePath) => ({ filePath, content: safeReadText(filePath, '') })).filter((item) => item.content);

    return {
      sourceRef,
      metadata,
      summaryJson,
      replayJson,
      logs,
      sourceEvidenceRef: evidence?.source_ref || null,
    };
  }

  inferAffectedModule({ event = {}, artifacts = {} }) {
    return artifacts.summaryJson?.module
      || artifacts.replayJson?.module
      || artifacts.metadata?.module
      || artifacts.sourceRef?.module
      || event?.payload?.module
      || event?.payload?.category
      || event?.source
      || 'workspace';
  }

  inferRootCause({ event = {}, artifacts = {}, timeline = [] }) {
    const combined = joinText(
      event.summary,
      event.payload,
      artifacts.summaryJson?.error,
      artifacts.summaryJson?.failureReason,
      artifacts.replayJson?.errors,
      artifacts.logs.map((item) => item.content),
      timeline.slice(0, 15).map((item) => `${item.type}: ${item.summary}`),
    ).toLowerCase();

    if (/timeout|timed out|tempo esgotado/.test(combined)) return 'Timeout durante execucao QA/RPA.';
    if (/auth|login|token|unauthorized|forbidden|credencial/.test(combined)) return 'Falha de autenticacao ou sessao invalida no fluxo testado.';
    if (/selector|locator|element|dom|nao encontrado|not found/.test(combined)) return 'Quebra de seletor ou elemento de interface nao encontrado.';
    if (/api|500|502|503|gateway|network|fetch|axios/.test(combined)) return 'Falha recorrente de integracao ou erro de API no fluxo.';
    if (/assert|expect|validator|validacao|mismatch/.test(combined)) return 'Validacao funcional falhou em assertivas do cenário.';
    if (/payment|checkout|cobranca|billing/.test(combined)) return 'Fluxo de pagamento ou cobrança apresentou inconsistência.';
    return 'Falha operacional detectada a partir de evidência QA/RPA com causa raiz ainda parcial.';
  }

  inferConfidence({ artifacts = {}, rootCause = '' }) {
    let confidence = 0.58;
    if (artifacts.summaryJson) confidence += 0.08;
    if (artifacts.replayJson) confidence += 0.08;
    if ((artifacts.logs || []).length > 0) confidence += 0.06;
    if (!/parcial/.test(rootCause)) confidence += 0.08;
    return Math.max(0.35, Math.min(0.97, Number(confidence.toFixed(2))));
  }

  inferRecommendedFix({ rootCause = '', affectedModule = '', artifacts = {} }) {
    if (/autentic/.test(rootCause.toLowerCase())) return `Revisar credenciais, renovacao de sessao e guards em ${affectedModule}.`;
    if (/timeout/.test(rootCause.toLowerCase())) return `Ajustar tempo de espera, retentativas e estabilidade do fluxo em ${affectedModule}.`;
    if (/seletor|elemento/.test(rootCause.toLowerCase())) return `Atualizar seletores, contratos de UI e replay base no modulo ${affectedModule}.`;
    if (/api/.test(rootCause.toLowerCase())) return `Revisar contrato de API, tratamento de erro e mocks relacionados ao modulo ${affectedModule}.`;
    if (/pagamento|cobrança|cobranca/.test(rootCause.toLowerCase())) return `Inspecionar regras de pagamento, reconciliação e eventos do modulo ${affectedModule}.`;
    return artifacts.summaryJson?.recommendedFix || `Criar patch candidato restrito ao modulo ${affectedModule} e validar com testes relacionados.`;
  }

  inferRisk({ rootCause = '', affectedModule = '', timeline = [] }) {
    const joined = `${rootCause} ${affectedModule}`.toLowerCase();
    const recentFailures = timeline.filter((item) => item.type === 'evidence').length;
    if (/auth|payment|billing|api/.test(joined) || recentFailures >= 3) return 'high';
    if (/timeout|seletor|assert/.test(joined) || recentFailures >= 2) return 'medium';
    return 'low';
  }

  async analyzeFailure({ tenantId, sourceType, sourceId, event = {}, evidence = null, timeline = [] } = {}) {
    const artifacts = this.collectArtifacts({ event, evidence });
    const affectedModule = this.inferAffectedModule({ event, artifacts });
    const rootCause = this.inferRootCause({ event, artifacts, timeline });
    const confidence = this.inferConfidence({ artifacts, rootCause });
    const recommendedFix = this.inferRecommendedFix({ rootCause, affectedModule, artifacts });
    const risk = this.inferRisk({ rootCause, affectedModule, timeline });

    return {
      tenantId,
      sourceType,
      sourceId,
      rootCause,
      affectedModule,
      confidence,
      recommendedFix,
      risk,
      analyzedArtifacts: {
        hasSummaryJson: Boolean(artifacts.summaryJson),
        hasReplayJson: Boolean(artifacts.replayJson),
        logFiles: artifacts.logs.map((item) => path.basename(item.filePath)),
        sourceEvidenceRef: artifacts.sourceEvidenceRef,
      },
    };
  }
}

module.exports = FailureDiagnosisService;