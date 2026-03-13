import React from 'react';

const DEFAULT_LABEL_BAND_WIDTH = 30;

function toStageBounds(bounds, _viewport) {
  if (!bounds) return null;

  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function hasLabelBounds(labelBounds) {
  if (!labelBounds) return false;
  return Number.isFinite(labelBounds.x)
    && Number.isFinite(labelBounds.y)
    && Number.isFinite(labelBounds.width)
    && Number.isFinite(labelBounds.height);
}

function toLabelBoundsStyle(labelBounds) {
  return {
    left: labelBounds.x,
    top: labelBounds.y,
    width: labelBounds.width,
    height: labelBounds.height,
  };
}

function isVerticalLabelBounds(labelBounds) {
  if (!hasLabelBounds(labelBounds)) return false;
  return labelBounds.height > labelBounds.width * 1.35;
}

function getVisibleLabel(item, fallbackLabel) {
  const rawName = String(item?.name || '').trim();
  if (rawName && rawName !== String(item?.id || '')) {
    return rawName;
  }
  return fallbackLabel;
}

function getHoverTitle(item, fallbackLabel) {
  const lines = [];
  const label = getVisibleLabel(item, fallbackLabel);
  if (label) {
    lines.push(label);
  }
  if (item?.id) {
    lines.push(`ID: ${item.id}`);
  }
  return lines.join('\n');
}

function getFallbackLabelBandWidth(itemBounds, candidateWidths) {
  const positiveWidths = candidateWidths.filter((width) => Number.isFinite(width) && width > 0);
  if (positiveWidths.length > 0) {
    return Math.max(18, Math.min(...positiveWidths));
  }

  if (!itemBounds?.width) {
    return DEFAULT_LABEL_BAND_WIDTH;
  }

  return Math.max(18, Math.min(DEFAULT_LABEL_BAND_WIDTH, itemBounds.width * 0.2));
}

function getParticipantLabelBandBounds(participant, lanes) {
  if (!participant?.bounds) return null;

  const laneInsetCandidates = lanes
    .filter((lane) => lane?.participantRef === participant.id && lane?.bounds)
    .map((lane) => lane.bounds.x - participant.bounds.x);

  const width = getFallbackLabelBandWidth(participant.bounds, laneInsetCandidates);

  return {
    x: participant.bounds.x,
    y: participant.bounds.y,
    width,
    height: participant.bounds.height,
  };
}

function getLaneLabelBandBounds(lane, participant, participantLabelBandBounds) {
  if (!lane?.bounds) return null;

  const insetFromParticipant = participant?.bounds
    ? lane.bounds.x - participant.bounds.x
    : null;

  const width = getFallbackLabelBandWidth(lane.bounds, [
    insetFromParticipant,
    participantLabelBandBounds?.width,
  ]);

  return {
    // Lane labels live inside lane bounds; participant label uses its own left band.
    x: lane.bounds.x,
    y: lane.bounds.y,
    width,
    height: lane.bounds.height,
  };
}

export function BpmnPoolLaneLayer({
  participants,
  lanes,
  viewport,
  selection,
  onSelect,
}) {
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  return (
    <div className="bpmn-pool-lane-layer">
      {participants.map((participant) => {
        const style = toStageBounds(participant.bounds, viewport);
        if (!style) return null;

        const selected = selection?.kind === 'participant' && selection?.id === participant.id;
        const visibleLabel = getVisibleLabel(participant, 'Pool');
        const usesDiLabel = hasLabelBounds(participant?.labelBounds);
        const usesVerticalDiLabel = isVerticalLabelBounds(participant?.labelBounds);
        const fallbackLabelBandBounds = !usesDiLabel
          ? getParticipantLabelBandBounds(participant, lanes)
          : null;

        return (
          <React.Fragment key={participant.id}>
            <button
              type="button"
              className={`bpmn-pool ${selected ? 'is-selected' : ''}`}
              style={style}
              onClick={() => onSelect?.({ kind: 'participant', id: participant.id })}
              title={getHoverTitle(participant, 'Pool')}
            />
            {visibleLabel && fallbackLabelBandBounds ? (
              <button
                type="button"
                className={`bpmn-pool__label-band ${selected ? 'is-selected' : ''}`}
                style={toStageBounds(fallbackLabelBandBounds, viewport)}
                onClick={() => onSelect?.({ kind: 'participant', id: participant.id })}
                title={getHoverTitle(participant, 'Pool')}
              >
                <span className="bpmn-pool__label bpmn-pool__label--vertical">{visibleLabel}</span>
              </button>
            ) : null}
            {visibleLabel && usesDiLabel ? (
              <div
                className={`bpmn-pool__label-di ${usesVerticalDiLabel ? 'is-vertical' : ''}`}
                style={toLabelBoundsStyle(participant.labelBounds)}
              >
                {visibleLabel}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}

      {lanes.map((lane) => {
        const style = toStageBounds(lane.bounds, viewport);
        if (!style) return null;

        const selected = selection?.kind === 'lane' && selection?.id === lane.id;
        const visibleLabel = getVisibleLabel(lane, 'Lane');
        const usesDiLabel = hasLabelBounds(lane?.labelBounds);
        const usesVerticalDiLabel = isVerticalLabelBounds(lane?.labelBounds);
        const participant = participantById.get(lane.participantRef);
        const participantLabelBandBounds = getParticipantLabelBandBounds(participant, lanes);
        const fallbackLabelBandBounds = !usesDiLabel
          ? getLaneLabelBandBounds(lane, participant, participantLabelBandBounds)
          : null;

        return (
          <React.Fragment key={lane.id}>
            <button
              type="button"
              className={`bpmn-lane ${selected ? 'is-selected' : ''}`}
              style={style}
              onClick={() => onSelect?.({ kind: 'lane', id: lane.id })}
              title={getHoverTitle(lane, 'Lane')}
            />
            {visibleLabel && fallbackLabelBandBounds ? (
              <button
                type="button"
                className={`bpmn-lane__label-band ${selected ? 'is-selected' : ''}`}
                style={toStageBounds(fallbackLabelBandBounds, viewport)}
                onClick={() => onSelect?.({ kind: 'lane', id: lane.id })}
                title={getHoverTitle(lane, 'Lane')}
              >
                <span className="bpmn-lane__label bpmn-lane__label--vertical">{visibleLabel}</span>
              </button>
            ) : null}
            {visibleLabel && usesDiLabel ? (
              <div
                className={`bpmn-lane__label-di ${usesVerticalDiLabel ? 'is-vertical' : ''}`}
                style={toLabelBoundsStyle(lane.labelBounds)}
              >
                {visibleLabel}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}

      {participants.map((participant) => {
        const style = toStageBounds(participant.bounds, viewport);
        if (!style) return null;

        return (
          <div
            key={`${participant.id}__frame`}
            className="bpmn-pool__frame"
            style={style}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

export default BpmnPoolLaneLayer;