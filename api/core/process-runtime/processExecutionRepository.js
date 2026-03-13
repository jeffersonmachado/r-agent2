'use strict';

const { getSequelize } = require('../../db/sequelize');
const { ProcessExecutionEvent } = require('../../db/models');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function dbAvailable() {
  return !!getSequelize();
}

function normalizeEvent(event = {}) {
  return {
    eventId: event.eventId ? String(event.eventId) : `${String(event.executionId || 'exec')}:${String(event.sequence || 0)}:${Date.now()}`,
    executionId: String(event.executionId || ''),
    sequence: Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : 0,
    processId: String(event.processId || ''),
    processVersion: Number.isFinite(Number(event.processVersion)) ? Number(event.processVersion) : 1,
    nodeId: event.nodeId != null ? String(event.nodeId) : null,
    nodeType: event.nodeType != null ? String(event.nodeType) : null,
    eventType: String(event.eventType || 'PROCESS_EVENT'),
    timestamp: event.timestamp || new Date().toISOString(),
    payload: clone(event.payload || {}),
    metadata: clone(event.metadata || {}),
  };
}

class InMemoryProcessExecutionRepository {
  constructor() {
    this._eventsByExecution = new Map();
    this._sequences = new Map();
  }

  async getNextSequence(executionId) {
    const key = String(executionId || '');
    const next = (this._sequences.get(key) || 0) + 1;
    this._sequences.set(key, next);
    return next;
  }

  async appendEvent(event) {
    const key = String(event?.executionId || '');
    const list = this._eventsByExecution.get(key) || [];
    const persistedSequence = list.length > 0
      ? Number(list[list.length - 1].sequence || 0)
      : 0;
    const requestedSequence = Number.isFinite(Number(event?.sequence)) ? Number(event.sequence) : 0;
    const normalized = normalizeEvent({
      ...event,
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
    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await this.appendEvent(event));
    }
    return saved;
  }

  async listEventsByExecution(executionId) {
    const list = this._eventsByExecution.get(String(executionId || '')) || [];
    return list.map((event) => normalizeEvent(event));
  }

  async getLastEvent(executionId) {
    const list = await this.listEventsByExecution(executionId);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  async listEventsAfter(executionId, sequence) {
    const list = await this.listEventsByExecution(executionId);
    const safeSequence = Number.isFinite(Number(sequence)) ? Number(sequence) : 0;
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
      where: { execution_id: String(executionId || '') },
      order: [['sequence', 'DESC']],
    });
    const lastSequence = last ? Number((last.toJSON ? last.toJSON() : last).sequence || 0) : 0;
    return lastSequence + 1;
  }

  async appendEvent(event) {
    if (!dbAvailable()) return this._fallback.appendEvent(event);
    const key = String(event?.executionId || '');
    const requestedSequence = Number.isFinite(Number(event?.sequence)) ? Number(event.sequence) : 0;
    const persistedSequence = await this.getLastEvent(key).then((last) => Number(last?.sequence || 0));
    const normalized = normalizeEvent({
      ...event,
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
      payload: clone(normalized.payload || {}),
      metadata: clone(normalized.metadata || {}),
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
    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      saved.push(await this.appendEvent(event));
    }
    return saved;
  }

  async listEventsByExecution(executionId) {
    if (!dbAvailable()) return this._fallback.listEventsByExecution(executionId);
    const rows = await this.model.findAll({
      where: { execution_id: String(executionId || '') },
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
    const safeSequence = Number.isFinite(Number(sequence)) ? Number(sequence) : 0;
    const list = await this.listEventsByExecution(executionId);
    return list.filter((event) => event.sequence > safeSequence);
  }
}

module.exports = {
  InMemoryProcessExecutionRepository,
  SequelizeProcessExecutionRepository,
  normalizeEvent,
};
