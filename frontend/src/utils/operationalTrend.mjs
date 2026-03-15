export const OPERATIONAL_TREND_FORMULA_TEXT = 'Formula: tendencia = score_atual - score_anterior.';
export const OPERATIONAL_TREND_NO_HISTORY_TEXT = 'Historico insuficiente para calcular delta.';
export const OPERATIONAL_STATE_LABELS = Object.freeze({
	sectionTitle: 'Estado operacional',
	health: 'Saude',
	score: 'Score',
	openInsights: 'Insights abertos',
	openRecommendations: 'Recomendacoes abertas',
	trend: 'Tendencia',
	noCriticalAlerts: 'Sem alertas criticos no momento.',
	updatedAt: 'atualizado em:',
});

function toFiniteOrNull(value) {
	if (value == null) return null;
	if (typeof value === 'string' && value.trim() === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

export function computeOperationalTrend(currentScore, previousScore) {
	const current = toFiniteOrNull(currentScore);
	const previous = toFiniteOrNull(previousScore);

	if (current == null || previous == null) {
		return {
			label: 'sem historico',
			detail: '-',
			delta: null,
			current,
			previous,
		};
	}

	const delta = Math.round(current - previous);
	if (Math.abs(delta) < 1) {
		return {
			label: 'estavel',
			detail: '(0)',
			delta: 0,
			current,
			previous,
		};
	}

	if (delta > 0) {
		return {
			label: 'alta',
			detail: `(+${delta})`,
			delta,
			current,
			previous,
		};
	}

	return {
		label: 'queda',
		detail: `(${delta})`,
		delta,
		current,
		previous,
	};
}

export function buildOperationalTrendTooltip(currentScore, previousScore) {
	const trend = computeOperationalTrend(currentScore, previousScore);
	if (!Number.isFinite(trend.current) || !Number.isFinite(trend.previous) || trend.delta == null) {
		return `${OPERATIONAL_TREND_FORMULA_TEXT} ${OPERATIONAL_TREND_NO_HISTORY_TEXT}`;
	}
	return `${OPERATIONAL_TREND_FORMULA_TEXT} score_atual=${trend.current}, score_anterior=${trend.previous}, delta=${trend.delta}.`;
}
