#!/usr/bin/env node
'use strict';

console.log(JSON.stringify({
  wave: 'workspace-core',
  status: 'registered',
  scenario: 'qa/workspace-core/workspace-core.wave.json',
  checks: ['entity', 'links', 'timeline', 'insight', 'action', 'replay'],
}, null, 2));
