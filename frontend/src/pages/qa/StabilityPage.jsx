import React, { useEffect, useMemo, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { Button } from '../../styles/Button';
import { useToast } from '../../components/Toast';
import * as qaStabilityApi from '../../api/qaStability';
import * as qaCheckpointsApi from '../../api/qaCheckpoints';
import * as qaLearnApi from '../../api/qaLearn';

function metric(value, suffix = '') {
	if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/d';
	return `${Number(value).toFixed(1)}${suffix}`;
}

function panel(title, content) {
	return (
		<div className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-2 text-xs uppercase text-text-secondary">{title}</div>
			<div className="text-2xl font-semibold text-text-primary">{content}</div>
		</div>
	);
}

function StabilityHeaderCards({ data, checkpoints }) {
	return (
		<section className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
			{panel('Stability Score', metric(data?.global?.stabilityScore, '%'))}
			{panel('Release Readiness', metric(data?.global?.releaseReadiness, '%'))}
			{panel('Replay Consistency', metric(data?.global?.replayConsistency, '%'))}
			{panel('Flaky Rate', metric(data?.global?.flakyRate, '%'))}
			{panel('Critical Flow Success', metric(data?.global?.criticalFlowSuccess, '%'))}
			{panel('Checkpoints concluidos', checkpoints?.progress?.completedWaves?.length || 0)}
		</section>
	);
}

function StabilityTrendChart({ history }) {
	const points = useMemo(() => {
		return (history?.snapshots || []).slice(0, 12).reverse();
	}, [history]);

	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Tendencia temporal</div>
			<div className="space-y-2 text-sm text-text-secondary">
				{points.length === 0 ? <div>Sem historico suficiente.</div> : null}
				{points.map((point) => (
					<div key={`${point.generatedAt}-${point.file}`} className="rounded-lg border border-border-default bg-bg-primary p-3">
						<div className="font-medium text-text-primary">{new Date(point.generatedAt).toLocaleString()}</div>
						<div>stability: {metric(point.stabilityScore, '%')} | readiness: {metric(point.releaseReadiness, '%')} | falhas: {point.failures ?? 0}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function ReleaseGatePanel({ gate }) {
	const items = [
		['backend build', gate?.backendBuild],
		['frontend build', gate?.frontendBuild],
		['QA tecnico', gate?.technicalQA],
		['QA business', gate?.businessQA],
		['replay critico', gate?.criticalReplay],
		['integridade artefato', gate?.artifactIntegrity],
	];

	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Release Gate</div>
			<div className="grid gap-2 md:grid-cols-2">
				{items.map(([label, status]) => (
					<div key={label} className="rounded-lg border border-border-default bg-bg-primary p-3 text-sm">
						<div className="text-text-secondary">{label}</div>
						<div className="font-semibold text-text-primary">{status || 'unknown'}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function ModuleHeatmapTable({ domains }) {
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Heatmap por dominio</div>
			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead>
						<tr className="border-b border-border-default text-left text-text-secondary">
							<th className="py-2">Nome</th>
							<th className="py-2">Score</th>
							<th className="py-2">Pass Rate</th>
							<th className="py-2">Falhas recorrentes</th>
							<th className="py-2">Replay</th>
							<th className="py-2">Avg Runtime</th>
							<th className="py-2">Criticidade</th>
						</tr>
					</thead>
					<tbody>
						{(domains || []).map((item) => (
							<tr key={item.name} className="border-b border-border-default">
								<td className="py-2 text-text-primary">{item.name}</td>
								<td className="py-2">{metric(item.score, '%')}</td>
								<td className="py-2">{metric(item.passRate, '%')}</td>
								<td className="py-2">{item.recurringFailures ?? 0}</td>
								<td className="py-2">{metric(item.replayConsistency, '%')}</td>
								<td className="py-2">{item.avgRuntimeMs ?? 0} ms</td>
								<td className="py-2">{item.criticality || 'n/d'}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function RecurringFailuresPanel({ failures }) {
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Top falhas recorrentes</div>
			<div className="space-y-2 text-sm">
				{(failures || []).slice(0, 10).map((item) => (
					<div key={item.signature} className="rounded-lg border border-border-default bg-bg-primary p-3">
						<div className="font-medium text-text-primary">{item.signature}</div>
						<div className="text-text-secondary">modulo: {item.module} | frequencia: {item.count} | impacto: {item.impact} | tendencia: {item.trend}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function VerticalCoverageGrid({ verticals }) {
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Matriz por vertical</div>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
				{(verticals || []).map((item) => (
					<div key={item.name} className="rounded-lg border border-border-default bg-bg-primary p-3 text-sm">
						<div className="font-semibold text-text-primary">{item.name}</div>
						<div className="text-text-secondary">cenarios: {item.scenarios || 0}</div>
						<div className="text-text-secondary">criticos: {item.criticalScenarios || 0}</div>
						<div className="text-text-secondary">sucesso: {metric(item.passRate, '%')}</div>
						<div className="text-text-secondary">score: {metric(item.score, '%')}</div>
						<div className="text-text-secondary">readiness: {item.readiness || 'blocked'}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function ChannelHealthGrid({ channels }) {
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Matriz por canal</div>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
				{(channels || []).map((item) => (
					<div key={item.name} className="rounded-lg border border-border-default bg-bg-primary p-3 text-sm">
						<div className="font-semibold text-text-primary">{item.name}</div>
						<div className="text-text-secondary">success rate: {metric(item.passRate, '%')}</div>
						<div className="text-text-secondary">latencia media: {item.avgLatencyMs || 0} ms</div>
						<div className="text-text-secondary">falhas criticas: {item.criticalFailures || 0}</div>
						<div className="text-text-secondary">replay: {metric(item.replayConsistency, '%')}</div>
						<div className="text-text-secondary">confidence: {metric(item.confidenceScore, '%')}</div>
					</div>
				))}
			</div>
		</section>
	);
}

function CheckpointProgressPanel({ checkpoints }) {
	const progress = checkpoints?.progress || {};
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Checkpoint Progress</div>
			<div className="space-y-1 text-sm text-text-secondary">
				<div>onda atual: <strong className="text-text-primary">{progress.currentWave || 'n/d'}</strong></div>
				<div>concluidas: <strong className="text-text-primary">{(progress.completedWaves || []).join(', ') || 'nenhuma'}</strong></div>
				<div>falhadas: <strong className="text-text-primary">{(progress.failedWaves || []).join(', ') || 'nenhuma'}</strong></div>
				<div>status global: <strong className="text-text-primary">{progress.globalStatus || 'running'}</strong></div>
				<div>blockers: <strong className="text-text-primary">{(checkpoints?.failures || []).length}</strong></div>
			</div>
		</section>
	);
}

function AutoCorrectionPanel({ summary }) {
	return (
		<section className="rounded-xl border border-border-default bg-bg-elevated p-4">
			<div className="mb-3 text-lg font-semibold text-text-primary">Auto-correcao / Learn</div>
			<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
				<div className="rounded-lg border border-border-default bg-bg-primary p-3">falhas elegiveis: {summary?.ranked ?? 0}</div>
				<div className="rounded-lg border border-border-default bg-bg-primary p-3">sugestoes: {summary?.suggestions ?? 0}</div>
				<div className="rounded-lg border border-border-default bg-bg-primary p-3">patches em validacao: {summary?.memory?.patched ?? 0}</div>
				<div className="rounded-lg border border-border-default bg-bg-primary p-3">promovidos/rejeitados: {summary?.memory?.promoted ?? 0}/{summary?.memory?.rejected ?? 0}</div>
			</div>
		</section>
	);
}

export function StabilityPage() {
	const { showToast, ToastContainer } = useToast();
	const [stability, setStability] = useState(null);
	const [history, setHistory] = useState(null);
	const [checkpoints, setCheckpoints] = useState(null);
	const [learnSummary, setLearnSummary] = useState(null);
	const [loading, setLoading] = useState(true);
	const [autoRefresh, setAutoRefresh] = useState(true);

	async function loadAll() {
		setLoading(true);
		try {
			const [stabilityData, historyData, checkpointsData, learnData] = await Promise.all([
				qaStabilityApi.getQaStability(),
				qaStabilityApi.getQaStabilityHistory(),
				qaCheckpointsApi.getQaCheckpoints(),
				qaLearnApi.getQaLearnSummary(),
			]);
			setStability(stabilityData);
			setHistory(historyData);
			setCheckpoints(checkpointsData);
			setLearnSummary(learnData);
		} catch (error) {
			showToast(error.message || 'Falha ao carregar dashboard de estabilidade', 'error');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadAll();
		if (!autoRefresh) return;
		const timer = setInterval(loadAll, 30000);
		return () => clearInterval(timer);
	}, [autoRefresh]);

	if (loading) {
		return (
			<CrudPageBase>
				<div className="flex min-h-[60vh] items-center justify-center text-text-secondary">Carregando estabilidade...</div>
				<ToastContainer />
			</CrudPageBase>
		);
	}

	return (
		<CrudPageBase>
			<section className="mb-6 rounded-2xl border border-border-default bg-gradient-to-r from-[#ecf8ff] via-[#f8fbff] to-[#f4fff5] p-6 shadow-sm">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h1 className="text-3xl font-bold text-text-primary">Painel de Estabilidade QA</h1>
						<p className="mt-1 text-sm text-text-secondary">Saude operacional em tempo real com checkpoints, release gate e RAP Learn.</p>
					</div>
					<div className="flex items-center gap-3">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={autoRefresh}
								onChange={(e) => setAutoRefresh(e.target.checked)}
								className="w-4 h-4"
							/>
							<span className="text-sm text-text-primary">Auto-atualizar</span>
						</label>
						<Button onClick={loadAll}>Atualizar</Button>
					</div>
				</div>
			</section>

			<div className="space-y-6">
				<StabilityHeaderCards data={stability} checkpoints={checkpoints} />

				<div className="grid gap-4 lg:grid-cols-2">
					<StabilityTrendChart history={history} />
					<ReleaseGatePanel gate={stability?.releaseGate} />
				</div>

				<ModuleHeatmapTable domains={stability?.domains} />

				<div className="grid gap-4 lg:grid-cols-2">
					<RecurringFailuresPanel failures={stability?.failures} />
					<ChannelHealthGrid channels={stability?.channels} />
				</div>

				<div className="grid gap-4 lg:grid-cols-2">
					<VerticalCoverageGrid verticals={stability?.verticals} />
					<AutoCorrectionPanel summary={learnSummary} />
				</div>

				<CheckpointProgressPanel checkpoints={checkpoints} />
			</div>

			<ToastContainer />
		</CrudPageBase>
	);
}

