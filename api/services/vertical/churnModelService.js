'use strict';

/**
 * Churn Model Service (vertical fitness) — ML real, sem heurística.
 *
 * Modelo: regressão logística binária treinada por gradiente descendente
 * (batch, L2) sobre o histórico real de presenças do próprio tenant
 * (vertical_attendances + access_memberships). Sem dados sintéticos, sem
 * fallback heurístico: sem modelo treinado, o scoring falha fechado com
 * AI_ML_REQUIRED (política fail-closed preservada).
 *
 * Label de churn: ausência de retorno em `horizonDays` após o ponto de
 * observação (ou encerramento/cancelamento do plano dentro do horizonte).
 *
 * Features (encoding numérico fixo, versionado no modelo):
 *   - days_since_last_visit : dias desde o último check-in até o ponto de obs.
 *   - frequency_30d         : check-ins nos 30 dias anteriores ao ponto de obs.
 *   - billing_delinquent    : 1 se cobrança em atraso/grace period
 *   - billing_inactive      : 1 se plano cancelado/suspenso/expirado
 *
 * Padronização z-score (apenas features contínuas; flags binárias ficam em
 * 0/1) com médias/desvios do treino, persistidos junto com os pesos —
 * inferência é uma sigmoide pura, determinística e auditável.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const logger = require('../../utils/logger');

const MODEL_TYPE_FITNESS_CHURN = 'fitness_churn';
const FEATURES = ['days_since_last_visit', 'frequency_30d', 'billing_delinquent', 'billing_inactive'];

const MIN_SAMPLES = 30;
const MIN_CLASS_SAMPLES = 5;
const MAX_OBSERVATIONS_PER_SUBJECT = 40;
const DEFAULT_HORIZON_DAYS = 30;
const DEFAULT_SPACING_DAYS = 14;
const TRAIN_EPOCHS = 800;
const TRAIN_LEARNING_RATE = 0.1;
const TRAIN_L2 = 1e-4;

const DELINQUENT_STATUSES = new Set(['delinquent', 'past_due', 'overdue', 'grace_period']);
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'suspended', 'paused', 'inactive', 'expired']);

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

function safeStr(value) {
  return value == null ? '' : String(value);
}

// ── Feature encoding ──────────────────────────────────────────────────────

function encodeBilling(billingStatus) {
  const status = safeStr(billingStatus).toLowerCase();
  return {
    billing_delinquent: DELINQUENT_STATUSES.has(status) ? 1 : 0,
    billing_inactive: INACTIVE_STATUSES.has(status) ? 1 : 0,
  };
}

function featureVector(featureValues, featureNames = FEATURES) {
  return featureNames.map((name) => Number(featureValues[name]) || 0);
}

// ── Dataset builder ───────────────────────────────────────────────────────

/**
 * Constrói o dataset supervisionado a partir do histórico real do tenant.
 * Pontos de observação espaçados (`spacingDays`) ao longo do histórico de
 * cada aluno, limitados a `MAX_OBSERVATIONS_PER_SUBJECT` para nenhum aluno
 * dominar o treino. Só entram pontos cujo horizonte já é observável
 * (T + horizonDays <= now) — label nunca é especulativo.
 *
 * @returns {Promise<{X: number[][], y: number[], subjects: number, featureNames: string[]}>}
 */
async function buildFitnessChurnDataset({ tenantId, horizonDays = DEFAULT_HORIZON_DAYS, spacingDays = DEFAULT_SPACING_DAYS, now = Date.now() } = {}) {
  if (!dbAvailable()) return { X: [], y: [], subjects: 0, featureNames: FEATURES };

  const Attendance = models.VerticalAttendance();
  const attendances = await Attendance.findAll({
    where: { tenant_key: String(tenantId), vertical: 'fitness', checked_in_at: { [Op.ne]: null } },
    attributes: ['subject_id', 'membership_id', 'checked_in_at'],
    order: [['checked_in_at', 'ASC']],
    limit: 50000,
  }).catch(() => []);

  const Membership = models.AccessMembership();
  const memberships = await Membership.findAll({
    where: { tenant_key: String(tenantId), vertical: 'fitness' },
    attributes: ['id', 'subject_id', 'billing_status', 'status', 'end_at'],
    limit: 5000,
  }).catch(() => []);

  const membershipBySubject = new Map();
  for (const m of memberships) {
    const row = m.toJSON ? m.toJSON() : m;
    if (row.subject_id && !membershipBySubject.has(String(row.subject_id))) {
      membershipBySubject.set(String(row.subject_id), row);
    }
  }

  const bySubject = new Map();
  for (const a of attendances) {
    const row = a.toJSON ? a.toJSON() : a;
    const subjectId = safeStr(row.subject_id);
    const at = new Date(row.checked_in_at).getTime();
    if (!subjectId || Number.isNaN(at)) continue;
    if (!bySubject.has(subjectId)) bySubject.set(subjectId, []);
    bySubject.get(subjectId).push(at);
  }

  const X = [];
  const y = [];
  const horizonMs = horizonDays * 864e5;
  const spacingMs = Math.max(1, spacingDays) * 864e5;

  for (const [subjectId, times] of bySubject.entries()) {
    times.sort((a, b) => a - b);
    const membership = membershipBySubject.get(subjectId) || {};
    const billing = encodeBilling(membership.billing_status);

    const first = times[0];
    const last = times[times.length - 1];
    // Pontos de observação vão do primeiro check-in até o fim do período
    // observável (now - horizon), atravessando o silêncio pós-última visita:
    // é ali que days_since_last_visit cresce e o label de churn é informativo.
    // Parar no último check-in geraria positivos com features "saudáveis"
    // (vazamento temporal) e inverteria o aprendizado.
    const observableEnd = now - horizonMs;
    const points = [];
    for (let t = first; t <= observableEnd; t += spacingMs) points.push(t);
    if (last <= observableEnd && points[points.length - 1] !== last) points.push(last);

    const capped = points.slice(-MAX_OBSERVATIONS_PER_SUBJECT);
    for (const t of capped) {
      if (t + horizonMs > now) continue; // horizonte ainda não observável
      const prior = times.filter((ts) => ts <= t);
      if (prior.length === 0) continue;
      const daysSinceLastVisit = Math.floor((t - prior[prior.length - 1]) / 864e5);
      const frequency30d = prior.filter((ts) => ts > t - 30 * 864e5).length;
      const returned = times.some((ts) => ts > t && ts <= t + horizonMs);
      // Horizonte observável (t + horizon <= now): não retornou dentro do
      // horizonte ⇒ churn=1 (inclui quem voltou só depois do horizonte e
      // quem encerrou o plano — ambos são ausência de retorno observada).
      const label = returned ? 0 : 1;

      X.push(featureVector({ days_since_last_visit: daysSinceLastVisit, frequency_30d: frequency30d, ...billing }));
      y.push(label);
    }
  }

  return { X, y, subjects: bySubject.size, featureNames: FEATURES };
}

// ── Logistic regression (batch gradient descent, L2) ─────────────────────

function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function standardize(X) {
  const n = X.length;
  const d = X[0].length;
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j += 1) means[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j += 1) stds[j] += ((row[j] - means[j]) ** 2) / n;
  for (let j = 0; j < d; j += 1) {
    // Features binárias (0/1) NÃO são padronizadas: com desvio pequeno
    // (flag rara) o z-score explodiria a influência do coeficiente.
    // Identidade (mean=0, std=1) mantém o peso direto no coeficiente.
    const binary = X.every((row) => row[j] === 0 || row[j] === 1);
    if (binary) {
      means[j] = 0;
      stds[j] = 1;
    } else {
      stds[j] = Math.sqrt(stds[j]) || 1;
    }
  }
  const Xs = X.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  return { Xs, means, stds };
}

/**
 * Treina regressão logística. Determinístico: inicialização em zeros e
 * hiperparâmetros fixos — mesmos dados ⇒ mesmos pesos.
 *
 * @returns {{bias: number, coefficients: number[], means: number[], stds: number[], metrics: object}}
 */
function trainLogisticRegression({ X, y, epochs = TRAIN_EPOCHS, learningRate = TRAIN_LEARNING_RATE, l2 = TRAIN_L2 } = {}) {
  if (!Array.isArray(X) || X.length === 0 || X.length !== y.length) {
    throw new Error('TRAINING_DATA_INVALID: X e y devem ter o mesmo tamanho não-zero');
  }
  const n = X.length;
  const d = X[0].length;
  const { Xs, means, stds } = standardize(X);
  const w = new Array(d).fill(0);
  let b = 0;

  // class_weight='balanced' (mesma fórmula do sklearn): o histórico real de
  // academias é desbalanceado (muitos pontos de silêncio, poucos de
  // frequência saudável); sem ponderação o intercepto herda o prior da
  // classe majoritária e todo aluno normal vira "churn".
  const nPos = y.filter((v) => v === 1).length;
  const nNeg = n - nPos;
  const classWeight = [nNeg > 0 ? n / (2 * nNeg) : 1, nPos > 0 ? n / (2 * nPos) : 1];

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      let z = b;
      for (let j = 0; j < d; j += 1) z += w[j] * Xs[i][j];
      const err = (sigmoid(z) - y[i]) * classWeight[y[i]];
      for (let j = 0; j < d; j += 1) gradW[j] += err * Xs[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j += 1) w[j] -= learningRate * ((gradW[j] / n) + l2 * w[j]);
    b -= learningRate * (gradB / n);
  }

  const probabilities = Xs.map((row) => {
    let z = b;
    for (let j = 0; j < d; j += 1) z += w[j] * row[j];
    return sigmoid(z);
  });

  return {
    bias: b,
    coefficients: w,
    means,
    stds,
    metrics: {
      logloss: logLoss(probabilities, y),
      auc: aucRank(probabilities, y),
      accuracy: accuracyAt(probabilities, y, 0.5),
      samples: n,
      positives: y.filter((v) => v === 1).length,
      negatives: y.filter((v) => v === 0).length,
      epochs,
      learningRate,
      l2,
    },
  };
}

function logLoss(probabilities, y) {
  const eps = 1e-15;
  let sum = 0;
  for (let i = 0; i < y.length; i += 1) {
    const p = Math.min(1 - eps, Math.max(eps, probabilities[i]));
    sum += y[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / y.length;
}

/** AUC por ranking (Mann-Whitney). null se só houver uma classe. */
function aucRank(probabilities, y) {
  const pos = probabilities.filter((_, i) => y[i] === 1);
  const neg = probabilities.filter((_, i) => y[i] === 0);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) {
    for (const q of neg) {
      if (p > q) wins += 1;
      else if (p === q) wins += 0.5;
    }
  }
  return wins / (pos.length * neg.length);
}

function accuracyAt(probabilities, y, threshold) {
  let correct = 0;
  for (let i = 0; i < y.length; i += 1) {
    if ((probabilities[i] >= threshold ? 1 : 0) === y[i]) correct += 1;
  }
  return correct / y.length;
}

// ── Persistência e inferência ─────────────────────────────────────────────

/**
 * Treina e persiste um novo modelo de churn para o tenant. Versão anterior
 * é marcada como superseded; a nova vira ativa.
 */
async function trainFitnessChurnModel({ tenantId, horizonDays, spacingDays, now } = {}) {
  if (!dbAvailable()) throw new Error('persistence_required: banco indisponível para treinar modelo de churn');
  const dataset = await buildFitnessChurnDataset({ tenantId, horizonDays, spacingDays, now });
  const positives = dataset.y.filter((v) => v === 1).length;
  const negatives = dataset.y.length - positives;
  if (dataset.X.length < MIN_SAMPLES || positives < MIN_CLASS_SAMPLES || negatives < MIN_CLASS_SAMPLES) {
    throw Object.assign(
      new Error(`INSUFFICIENT_TRAINING_DATA: amostras=${dataset.X.length} positivos=${positives} negativos=${negatives} (mínimo ${MIN_SAMPLES} amostras, ${MIN_CLASS_SAMPLES} por classe)`),
      { code: 'INSUFFICIENT_TRAINING_DATA' },
    );
  }

  const trained = trainLogisticRegression({ X: dataset.X, y: dataset.y });
  const Model = models.VerticalMlModel();

  const latest = await Model.findOne({
    where: { tenant_key: String(tenantId), model_type: MODEL_TYPE_FITNESS_CHURN },
    order: [['version', 'DESC']],
  }).catch(() => null);
  const version = (latest ? Number((latest.toJSON ? latest.toJSON() : latest).version) || 0 : 0) + 1;

  await Model.update(
    { status: 'superseded' },
    { where: { tenant_key: String(tenantId), model_type: MODEL_TYPE_FITNESS_CHURN, status: 'active' } },
  ).catch(() => {});

  const id = makeId('vmm');
  const row = await Model.create({
    id,
    tenant_key: String(tenantId),
    model_type: MODEL_TYPE_FITNESS_CHURN,
    version,
    algorithm: 'logistic_regression',
    weights: {
      bias: trained.bias,
      coefficients: trained.coefficients,
      means: trained.means,
      stds: trained.stds,
      features: dataset.featureNames,
    },
    metrics: { ...trained.metrics, subjects: dataset.subjects, horizonDays: horizonDays || DEFAULT_HORIZON_DAYS },
    status: 'active',
    trained_at: new Date(),
  });

  logger.info('[ChurnModel] modelo fitness_churn treinado', {
    tenantId, version, samples: trained.metrics.samples, auc: trained.metrics.auc, logloss: trained.metrics.logloss,
  });

  const plain = row.toJSON ? row.toJSON() : row;
  return { id: plain.id, version, metrics: plain.metrics };
}

async function getActiveModel({ tenantId, modelType = MODEL_TYPE_FITNESS_CHURN } = {}) {
  if (!dbAvailable()) return null;
  const Model = models.VerticalMlModel();
  const row = await Model.findOne({
    where: { tenant_key: String(tenantId), model_type: modelType, status: 'active' },
    order: [['version', 'DESC']],
  }).catch(() => null);
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

/**
 * Inferência de churn. FAIL-CLOSED: sem modelo treinado do tenant, lança
 * AI_ML_REQUIRED — nunca inventa score por heurística.
 *
 * @returns {Promise<{score: number, modelId: string, modelVersion: number}>}
 */
async function scoreFitnessChurn({ tenantId, daysSinceLastVisit, frequency30d, billingStatus } = {}) {
  const model = await getActiveModel({ tenantId });
  if (!model) {
    throw Object.assign(
      new Error(`AI_ML_REQUIRED: nenhum modelo fitness_churn treinado para o tenant ${tenantId}. Treine com trainFitnessChurnModel sobre o histórico real do tenant.`),
      { code: 'AI_ML_REQUIRED' },
    );
  }
  const weights = model.weights || {};
  const features = Array.isArray(weights.features) && weights.features.length > 0 ? weights.features : FEATURES;
  const raw = featureVector({
    days_since_last_visit: Number(daysSinceLastVisit) || 0,
    frequency_30d: Number(frequency30d) || 0,
    ...encodeBilling(billingStatus),
  }, features);

  let z = Number(weights.bias) || 0;
  for (let j = 0; j < features.length; j += 1) {
    const mean = Number(weights.means?.[j]) || 0;
    const std = Number(weights.stds?.[j]) || 1;
    const coefficient = Number(weights.coefficients?.[j]) || 0;
    z += coefficient * ((raw[j] - mean) / std);
  }

  return { score: sigmoid(z), modelId: model.id, modelVersion: model.version };
}

module.exports = {
  MODEL_TYPE_FITNESS_CHURN,
  FEATURES,
  MIN_SAMPLES,
  MIN_CLASS_SAMPLES,
  buildFitnessChurnDataset,
  trainLogisticRegression,
  trainFitnessChurnModel,
  getActiveModel,
  scoreFitnessChurn,
  encodeBilling,
  sigmoid,
};
