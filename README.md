
# Results Autonomous Platform

The **Results Autonomous Platform (RAP)** is an **Autonomous Operations Platform** designed to:

- understand operational events
- maintain operational state
- make decisions
- execute actions
- continuously learn

## Core Loop

Events → State → Decision → Execution → Learning

## Documentation

See `/docs` for architecture, capabilities, verticals, and roadmap.

## Test Setup

Run `npm install` before any Jest-based validation. The default source ZIP for this repository excludes `node_modules`, so tests are only reproducible after a clean install in the unpacked workspace.

Vertical Beauty/Fitness validation commands:

- `npm run test:vertical:unit`
- `npm run test:vertical:integration`
- `node scripts/vertical-e2e-validate.js`
