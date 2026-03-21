import { useCallback } from 'react';
import { reteJsonToEngineFlow } from '../../engine-mapper/engineMapper';
import { bpmnXmlToViewModel } from '../../bpmn/bpmnXmlToViewModel';
import { engineFlowToBpmnXml } from '../../bpmn/engineFlowToBpmnXml';
import logger from '../../utils/logger';

export function useFlowEditorExport({
  canRenderBpmn,
  bpmnViewModel,
  editorRef,
  draftMeta,
  currentFlow,
  activeFlow,
  draftFlow,
  activeFlowMetadata,
  agent,
  showToast,
}) {
  const escapeXml = useCallback((value) => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }, []);

  const createBpmnSvgMarkup = useCallback((viewModel, title = 'BPMN Export') => {
    const viewport = viewModel?.viewport;
    if (!viewModel || !viewport) {
      throw new Error('VIEWMODEL_INDISPONIVEL');
    }

    const width = Math.max(Math.ceil(viewport.width + 120), 800);
    const height = Math.max(Math.ceil(viewport.height + 120), 500);
    const offsetX = 60 - viewport.minX;
    const offsetY = 60 - viewport.minY;

    const rootStyles = getComputedStyle(document.documentElement);
    const css = (name, fallback) => String(rootStyles.getPropertyValue(name) || '').trim() || fallback;
    const palette = {
      bgPrimary: css('--color-bg-primary', '#ffffff'),
      bgSecondary: css('--color-bg-secondary', '#f4f6f8'),
      bgElevated: css('--color-bg-elevated', '#ffffff'),
      borderDefault: css('--color-border-default', '#d0d7de'),
      borderFocus: css('--color-border-focus', '#34495e'),
      borderHover: css('--color-border-hover', '#7f8c8d'),
      textPrimary: css('--color-text-primary', '#111827'),
      textSecondary: css('--color-text-secondary', '#4b5563'),
      accentPrimary: css('--color-accent-primary', '#2563eb'),
      accentLight: css('--color-accent-light', 'rgba(37, 99, 235, 0.18)'),
    };

    const participants = (viewModel.participants || []).map((participant) => {
      if (!participant?.bounds) return '';
      const x = participant.bounds.x + offsetX;
      const y = participant.bounds.y + offsetY;
      const w = participant.bounds.width;
      const h = participant.bounds.height;
      const label = escapeXml((participant.name && participant.name !== participant.id) ? participant.name : 'Pool');
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${palette.bgElevated}" stroke="${palette.borderHover}" stroke-width="2" />`,
        `<text x="${x + 10}" y="${y + 22}" fill="${palette.textPrimary}" font-size="12" font-weight="700">${label}</text>`,
      ].join('');
    }).join('');

    const lanes = (viewModel.lanes || []).map((lane) => {
      if (!lane?.bounds) return '';
      const x = lane.bounds.x + offsetX;
      const y = lane.bounds.y + offsetY;
      const w = lane.bounds.width;
      const h = lane.bounds.height;
      const label = escapeXml((lane.name && lane.name !== lane.id) ? lane.name : 'Lane');
      return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${palette.bgSecondary}" stroke="${palette.borderDefault}" stroke-width="1" />`,
        `<text x="${x + 10}" y="${y + 22}" fill="${palette.textPrimary}" font-size="12" font-weight="600">${label}</text>`,
      ].join('');
    }).join('');

    const edgePath = (flow, dashed = false) => {
      const points = Array.isArray(flow?.waypoints)
        ? flow.waypoints.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }))
        : [];
      if (points.length < 2) return '';

      const pathData = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');

      const label = flow?.name && flow.name !== flow.id
        ? `<text x="${points[Math.floor(points.length / 2)].x}" y="${points[Math.floor(points.length / 2)].y - 10}" fill="${palette.textPrimary}" text-anchor="middle" font-size="12">${escapeXml(flow.name)}</text>`
        : '';

      return [
        `<path d="${pathData}" fill="none" stroke="${palette.textSecondary}" stroke-width="2.4" ${dashed ? 'stroke-dasharray="7 5"' : ''} marker-end="url(#${dashed ? 'message' : 'sequence'}-arrow)" />`,
        label,
      ].join('');
    };

    const sequenceFlows = (viewModel.sequenceFlows || []).map((flow) => edgePath(flow, false)).join('');
    const messageFlows = (viewModel.messageFlows || []).map((flow) => edgePath(flow, true)).join('');

    const nodes = (viewModel.nodes || []).map((node) => {
      if (!node?.bounds) return '';

      const x = node.bounds.x + offsetX;
      const y = node.bounds.y + offsetY;
      const w = node.bounds.width;
      const h = node.bounds.height;
      const bpmnType = String(node.bpmnType || 'task');
      const category = String(node.category || 'task');
      const label = String(node?.name || '').trim() && String(node?.name || '').trim() !== String(node?.id || '')
        ? escapeXml(node.name)
        : '';

      let shapeMarkup = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" ry="14" fill="${palette.bgElevated}" stroke="${palette.borderFocus}" stroke-width="2" />`;

      if (category === 'gateway') {
        const cx = x + w / 2;
        const cy = y + h / 2;
        shapeMarkup = `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${palette.bgElevated}" stroke="${palette.borderFocus}" stroke-width="2" />`;
      } else if (bpmnType === 'startEvent' || bpmnType === 'endEvent' || bpmnType === 'intermediateCatchEvent' || bpmnType === 'boundaryEvent') {
        const cx = x + w / 2;
        const cy = y + h / 2;
        const radius = Math.max(4, Math.min(w, h) / 2 - 2);
        shapeMarkup = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${palette.bgElevated}" stroke="${palette.borderFocus}" stroke-width="${bpmnType === 'endEvent' ? 4 : 2}" />`;
        if (bpmnType === 'intermediateCatchEvent' || bpmnType === 'boundaryEvent') {
          const innerRadius = Math.max(2, radius - 6);
          shapeMarkup += `<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="none" stroke="${palette.borderHover}" stroke-width="2" />`;
        }
      }

      const textMarkup = label
        ? `<text x="${x + w / 2}" y="${y + h + 18}" fill="${palette.textPrimary}" text-anchor="middle" font-size="12">${label}</text>`
        : '';

      return `${shapeMarkup}${textMarkup}`;
    }).join('');

    return {
      width,
      height,
      svg: [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<title>${escapeXml(title)}</title>`,
        '<defs>',
        `<marker id="sequence-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">`,
        `<path d="M 0 0 L 10 5 L 0 10 z" fill="${palette.textSecondary}" stroke="${palette.textSecondary}" />`,
        '</marker>',
        `<marker id="message-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">`,
        `<path d="M 0 0 L 10 5 L 0 10" fill="none" stroke="${palette.textSecondary}" />`,
        '</marker>',
        '</defs>',
        `<rect x="0" y="0" width="${width}" height="${height}" fill="${palette.bgPrimary}" />`,
        `<g>${participants}${lanes}${sequenceFlows}${messageFlows}${nodes}</g>`,
        '</svg>',
      ].join(''),
    };
  }, [escapeXml]);

  const resolveExportViewModel = useCallback(async () => {
    if (canRenderBpmn && bpmnViewModel) {
      return bpmnViewModel;
    }

    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      throw new Error('EDITOR_NOT_READY');
    }

    const reteJson = await editor.toJSON();
    const flowDefinition = reteJsonToEngineFlow(reteJson, {
      tenantId: draftMeta?.tenantId || currentFlow?.tenantId || activeFlow?.tenantId || agent?.tenantId || 'demo-tenant',
      id: draftMeta?.id || currentFlow?.id || activeFlow?.id,
      name: draftMeta?.name || currentFlow?.name || activeFlow?.name || 'Fluxo sem nome',
      kind: currentFlow?.kind || draftFlow?.kind || activeFlow?.kind || draftMeta?.kind || 'chat',
      metadata: {
        ...(activeFlowMetadata && typeof activeFlowMetadata === 'object' ? activeFlowMetadata : {}),
      },
    });

    const exported = engineFlowToBpmnXml(flowDefinition);
    return bpmnXmlToViewModel(exported.xml, {
      name: flowDefinition?.name || activeFlow?.name || 'Flow',
    });
  }, [
    activeFlow?.id,
    activeFlow?.name,
    activeFlow?.tenantId,
    activeFlowMetadata,
    agent?.tenantId,
    bpmnViewModel,
    canRenderBpmn,
    currentFlow?.id,
    currentFlow?.kind,
    currentFlow?.name,
    currentFlow?.tenantId,
    draftFlow?.kind,
    draftMeta,
    editorRef,
  ]);

  const svgToPngBlob = useCallback((svgMarkup, width, height) => {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();

      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const scale = window.devicePixelRatio > 1 ? 2 : 1;
          canvas.width = Math.max(1, Math.floor(width * scale));
          canvas.height = Math.max(1, Math.floor(height * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            URL.revokeObjectURL(url);
            reject(new Error('CANVAS_CONTEXT_INDISPONIVEL'));
            return;
          }
          context.setTransform(scale, 0, 0, scale, 0, 0);
          context.drawImage(image, 0, 0, width, height);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error('PNG_EXPORT_FAILED'));
              return;
            }
            resolve(blob);
          }, 'image/png');
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('SVG_IMAGE_LOAD_FAILED'));
      };

      image.src = url;
    });
  }, []);

  const downloadBlob = useCallback((blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const buildExportBaseName = useCallback(() => {
    return String(activeFlow?.name || currentFlow?.name || 'flow')
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      || 'flow';
  }, [activeFlow?.name, currentFlow?.name]);

  const handleExportSVG = useCallback(async () => {
    try {
      const vm = await resolveExportViewModel();
      const title = `${activeFlow?.name || currentFlow?.name || 'Flow'} - SVG`;
      const result = createBpmnSvgMarkup(vm, title);
      const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(blob, `${buildExportBaseName()}.svg`);
      showToast('Export SVG concluído', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao exportar SVG', err);
      showToast('Erro ao exportar SVG', 'error', 2200);
    }
  }, [activeFlow?.name, buildExportBaseName, createBpmnSvgMarkup, currentFlow?.name, downloadBlob, resolveExportViewModel, showToast]);

  const handleExportPNG = useCallback(async () => {
    try {
      const vm = await resolveExportViewModel();
      const title = `${activeFlow?.name || currentFlow?.name || 'Flow'} - PNG`;
      const result = createBpmnSvgMarkup(vm, title);
      const pngBlob = await svgToPngBlob(result.svg, result.width, result.height);
      downloadBlob(pngBlob, `${buildExportBaseName()}.png`);
      showToast('Export PNG concluído', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao exportar PNG', err);
      showToast('Erro ao exportar PNG', 'error', 2200);
    }
  }, [activeFlow?.name, buildExportBaseName, createBpmnSvgMarkup, currentFlow?.name, downloadBlob, resolveExportViewModel, showToast, svgToPngBlob]);

  const handleExportPDF = useCallback(async () => {
    try {
      const vm = await resolveExportViewModel();
      const title = `${activeFlow?.name || currentFlow?.name || 'Flow'} - PDF`;
      const result = createBpmnSvgMarkup(vm, title);
      const pngBlob = await svgToPngBlob(result.svg, result.width, result.height);
      const imageUrl = URL.createObjectURL(pngBlob);

      const popup = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
      if (!popup) {
        URL.revokeObjectURL(imageUrl);
        showToast('Bloqueio de popup detectado. Permita popups para exportar PDF.', 'warning', 3500);
        return;
      }

      popup.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>${escapeXml(title)}</title>
            <style>
              body { margin: 0; display: grid; place-items: center; background: #fff; }
              img { max-width: 100%; max-height: 100vh; object-fit: contain; }
              .hint { position: fixed; top: 12px; left: 12px; right: 12px; font: 13px/1.4 sans-serif; color: #334155; }
              @media print { .hint { display: none; } body { margin: 0; } }
            </style>
          </head>
          <body>
            <div class="hint">Use "Salvar como PDF" na janela de impressão para concluir a exportação.</div>
            <img src="${imageUrl}" alt="${escapeXml(title)}" />
            <script>
              window.onload = () => {
                setTimeout(() => window.print(), 120);
              };
            </script>
          </body>
        </html>
      `);
      popup.document.close();

      setTimeout(() => {
        URL.revokeObjectURL(imageUrl);
      }, 10000);
      showToast('Janela de impressão aberta para exportar PDF', 'info', 3000);
    } catch (err) {
      logger.error('Erro ao exportar PDF', err);
      showToast('Erro ao exportar PDF', 'error', 2200);
    }
  }, [activeFlow?.name, createBpmnSvgMarkup, currentFlow?.name, escapeXml, resolveExportViewModel, showToast, svgToPngBlob]);

  return {
    handleExportSVG,
    handleExportPNG,
    handleExportPDF,
  };
}
