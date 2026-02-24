'use strict';

function hasTruthy(v) {
  return !(v == null || v === false || v === '');
}

function evaluatePillars(smokes) {
  const reasons = [];

  const l01 = smokes?.l01 || null;
  const l02 = smokes?.l02 || null;
  const l03 = smokes?.l03 || null;
  const l04 = smokes?.l04 || null;
  const l05 = smokes?.l05 || null;
  const l06 = smokes?.l06 || null;
  const hasL06 = !!l06;

  if (!l01 || l01.status !== 'pass') reasons.push('l01_not_pass');
  if (!l02 || l02.status !== 'pass') reasons.push('l02_not_pass');
  if (!l03 || l03.status !== 'pass') reasons.push('l03_not_pass');
  if (!l04 || l04.status !== 'pass') reasons.push('l04_not_pass');
  if (!l05 || l05.status !== 'pass') reasons.push('l05_not_pass');
  if (hasL06 && l06.status !== 'pass') reasons.push('l06_not_pass');

  const l01Done = Number(l01?.evidence?.metrics?.doneCount || 0);
  const l01Transitions = l01?.evidence?.transitions || {};
  const queuePillarOk = (
    hasTruthy(l01?.evidence?.queueId)
    && hasTruthy(l01?.evidence?.ticketId)
    && l01Transitions.callNext === true
    && l01Transitions.start === true
    && l01Transitions.pause === true
    && l01Transitions.resume === true
    && l01Transitions.finish === true
    && l01Done >= 1
  );
  if (!queuePillarOk) reasons.push('l01_evidence_invalid');

  const click2callStatus = String(l03?.evidence?.realCall?.click2callStatus || '').toLowerCase();
  const cdrFound = l03?.evidence?.realCall?.cdrFound === true;
  const originated = click2callStatus === 'originated';
  const pbxL03Ok = (
    l03?.evidence?.ok === true
    && l03?.evidence?.realCall?.attempted === true
    && originated
  );
  if (!pbxL03Ok) reasons.push('l03_real_call_invalid');

  const pbxL04Ok = (
    l04?.evidence?.ok === true
    && hasTruthy(l04?.evidence?.flow?.executionId)
    && Number(l04?.evidence?.flow?.nodesCount || 0) > 0
  );
  if (!pbxL04Ok) reasons.push('l04_runtime_invalid');

  const l05Ops = l05?.evidence?.operations || {};
  const chatProPillarOk = (
    l05?.evidence?.ok === true
    && hasTruthy(l05?.evidence?.ticket?.id)
    && l05Ops.assign === true
    && l05Ops.transfer === true
    && l05Ops.note === true
    && l05Ops.addTag === true
    && l05Ops.removeTag === true
    && l05Ops.quickReplyCreate === true
    && l05Ops.quickReplyUse === true
    && l05Ops.quickReplyList === true
  );
  if (!chatProPillarOk) reasons.push('l05_omnichannel_invalid');

  const l06OpportunitiesCount = Number(l06?.evidence?.opportunitiesCount || 0);
  const l06StagesMovedCount = Number(l06?.evidence?.stagesMovedCount || 0);
  const l06TimelineItemsCount = Number(l06?.evidence?.timelineItemsCount || 0);
  const crmPillarOk = (
    l06?.evidence?.ok === true
    && hasTruthy(l06?.evidence?.opportunityId)
    && l06OpportunitiesCount >= 1
    && l06StagesMovedCount >= 1
    && l06TimelineItemsCount >= 3
  );
  if (hasL06 && !crmPillarOk) reasons.push('l06_crm_invalid');

  const allSmokesPass = reasons.every((r) => !r.endsWith('_not_pass'));

  return {
    ok: reasons.length === 0,
    reasons,
    allSmokesPass,
    pillars: {
      chatpro: {
        ok: chatProPillarOk,
        ticketId: l05?.evidence?.ticket?.id || null,
      },
      queue: {
        ok: queuePillarOk,
        queueId: l01?.evidence?.queueId || null,
        ticketId: l01?.evidence?.ticketId || null,
        doneCount: l01Done,
      },
      pbx: {
        ok: pbxL03Ok && pbxL04Ok,
        l03: {
          ok: pbxL03Ok,
          click2callStatus,
          originated,
          cdrFound,
          acceptedWithoutCdr: !cdrFound && originated,
        },
        l04: {
          ok: pbxL04Ok,
          executionId: l04?.evidence?.flow?.executionId || null,
          nodesCount: Number(l04?.evidence?.flow?.nodesCount || 0),
        },
      },
      crm: {
        ok: hasL06 ? crmPillarOk : true,
        opportunityId: l06?.evidence?.opportunityId || null,
        opportunitiescount: l06OpportunitiesCount,
        stagesMoved: l06StagesMovedCount,
        timelineItems: l06TimelineItemsCount,
      },
    },
  };
}

module.exports = {
  evaluatePillars,
};
