'use strict';

const { getSequelize } = require('../../db/sequelize');
const { ProcessExecutionEvent } = require('../../db/models');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeClone(value, fallbackValue = null) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallbackValue;
  }
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
  } catch (_) {
    return fallbackValue;
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function safeFiniteNumber(value, fallbackValue = 0) {
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallbackValue;
}

function safeArrayCopy(value) {
  try {
    return Array.isArray(value) ? value.slice() : [];
  } catch (_) {
    return [];
  }
}

function safeShallowCloneRecord(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function dbAvailable() {
  return !!getSequelize();
}

function normalizeEvent(event = {}) {
  const safeEvent = safeShallowCloneRecord(event);
  const executionId = safeToString(safeGet(safeEvent, 'executionId', ''), '');
  const sequence = safeFiniteNumber(safeGet(safeEvent, 'sequence', 0), 0);
  const rawEventId = safeGet(safeEvent, 'eventId', null);
  const eventId = rawEventId != null && rawEventId !== ''
    ? safeToString(rawEventId, '')
    : `${executionId || 'exec'}:${sequence}:${Date.now()}`;
  return {
    eventId,
    executionId,
    sequence,
    processId: safeToString(safeGet(safeEvent, 'processId', ''), ''),
    processVersion: safeFiniteNumber(safeGet(safeEvent, 'processVersion', 1), 1),
    nodeId: safeGet(safeEvent, 'nodeId', null) != null ? safeToString(safeGet(safeEvent, 'nodeId', null), null) : null,
    nodeType: safeGet(safeEvent, 'nodeType', null) != null ? safeToString(safeGet(safeEvent, 'nodeType', null), null) : null,
    eventType: safeToString(safeGet(safeEvent, 'eventType', 'PROCESS_EVENT'), 'PROCESS_EVENT') || 'PROCESS_EVENT',
    timestamp: safeGet(safeEvent, 'timestamp', null) || new Date().toISOString(),
    payload: safeClone(safeGet(safeEvent, 'payload', {}), {}) ?? {},
    metadata: safeClone(safeGet(safeEvent, 'metadata', {}), {}) ?? {},
  };
}

class InMemoryProcessExecutionRepository {
  constructor() {
    this._eventsByExecution = new Map();
    this._sequences = new Map();
  }

  async getNextSequence(executionId) {
    const key = safeToString(executionId || '', '');
    const next = (this._sequences.get(key) || 0) + 1;
    this._sequences.set(key, next);
    return next;
  }

  async appendEvent(event) {
    const safeEvent = safeShallowCloneRecord(event);
    const key = safeToString(safeGet(safeEvent, 'executionId', ''), '');
    const list = this._eventsByExecution.get(key) || [];
    const persistedSequence = list.length > 0
      ? safeFiniteNumber(safeGet(list[list.length - 1], 'sequence', 0), 0)
      : 0;
    const requestedSequence = safeFiniteNumber(safeGet(safeEvent, 'sequence', 0), 0);
    const normalized = normalizeEvent({
      ...safeEvent,
      sequence: requestedSequence > persistedSequence ? requestedSequence : persistedSequence + 1,
    });
    list.push(normalized);
    list.sort((a, b) => a.sequence - b.sequence);
    this._eventsByExecution.set(normalized.executionId, list);
    this._sequences.set(normalized.executionId, Math.max(this._sequences.get(normalized.executionId) || 0, normalized.sequence));
    return normalizeEvent(normalized);
  }

  async appendEvents(events = []) {
    const saved = [];
    const safeEvents = safeArrayCopy(events);
    for (const event of safeEvents) {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await this.appendEvent(event));
    }
    return saved;
  }

  async listEventsByExecution(executionId) {
    const list = this._eventsByExecution.get(safeToString(executionId || '', '')) || [];
    return list.map((event) => normalizeEvent(event));
  }

  async getLastEvent(executionId) {
    const list = await this.listEventsByExecution(executionId);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  async listEventsAfter(executionId, sequence) {
    const list = await this.listEventsByExecution(executionId);
    const safeSequence = safeFiniteNumber(sequence, 0);
    return list.filter((event) => event.sequence > safeSequence);
  }
}

class SequelizeProcessExecutionRepository {
  constructor() {
    this._fallback = new InMemoryProcessExecutionRepository();
  }

  get model() {
    return ProcessExecutionEvent();
  }

  async getNextSequence(executionId) {
    if (!dbAvailable()) return this._fallback.getNextSequence(executionId);
    const last = await this.model.findOne({
      where: { execution_id: safeToString(executionId || '', '') },
      order: [['sequence', 'DESC']],
    });
    const lastSequence = last ? safeFiniteNumber(safeGet((last.toJSON ? last.toJSON() : last), 'sequence', 0), 0) : 0;
    return lastSequence + 1;
  }

  async appendEvent(event) {
    if (!dbAvailable()) return this._fallback.appendEvent(event);
    const safeEvent = safeShallowCloneRecord(event);
    const key = safeToString(safeGet(safeEvent, 'executionId', ''), '');
    const requestedSequence = safeFiniteNumber(safeGet(safeEvent, 'sequence', 0), 0);
    const persistedSequence = await this.getLastEvent(key).then((last) => Number(last?.sequence || 0));
    const normalized = normalizeEvent({
      ...safeEvent,
      sequence: requestedSequence > persistedSequence ? requestedSequence : persistedSequence + 1,
    });
    const row = await this.model.create({
      event_id: normalized.eventId,
      execution_id: normalized.executionId,
      sequence: normalized.sequence,
      process_id: normalized.processId,
      process_version: normalized.processVersion,
      node_id: normalized.nodeId,
      node_type: normalized.nodeType,
      event_type: normalized.eventType,
      timestamp: normalized.timestamp,
      payload: safeClone(normalized.payload || {}, {}) || {},
      metadata: safeClone(normalized.metadata || {}, {}) || {},
    });
    const json = row.toJSON ? row.toJSON() : row;
    return normalizeEvent({
      eventId: json.event_id,
      executionId: json.execution_id,
      sequence: json.sequence,
      processId: json.process_id,
      processVersion: json.process_version,
      nodeId: json.node_id,
      nodeType: json.node_type,
      eventType: json.event_type,
      timestamp: json.timestamp,
      payload: json.payload,
      metadata: json.metadata,
    });
  }

  async appendEvents(events = []) {
    if (!dbAvailable()) return this._fallback.appendEvents(events);
    const saved = [];
    const safeEvents = safeArrayCopy(events);
    for (const event of safeEvents) {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await this.appendEvent(event));
    }
    return saved;
  }

  async listEventsByExecution(executionId) {
    if (!dbAvailable()) return this._fallback.listEventsByExecution(executionId);
    const rows = await this.model.findAll({
      where: { execution_id: safeToString(executionId || '', '') },
      order: [['sequence', 'ASC'], ['timestamp', 'ASC']],
      limit: 10000,
    });
    return rows.map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      return normalizeEvent({
        eventId: json.event_id,
        executionId: json.execution_id,
        sequence: json.sequence,
        processId: json.process_id,
        processVersion: json.process_version,
        nodeId: json.node_id,
        nodeType: json.node_type,
        eventType: json.event_type,
        timestamp: json.timestamp,
        payload: json.payload,
        metadata: json.metadata,
      });
    });
  }

  async getLastEvent(executionId) {
    const list = await this.listEventsByExecution(executionId);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  async listEventsAfter(executionId, sequence) {
    const safeSequence = safeFiniteNumber(sequence, 0);
    const list = await this.listEventsByExecution(executionId);
    return list.filter((event) => event.sequence > safeSequence);
  }
}

module.exports = {
  InMemoryProcessExecutionRepository,
  SequelizeProcessExecutionRepository,
  normalizeEvent,
};
