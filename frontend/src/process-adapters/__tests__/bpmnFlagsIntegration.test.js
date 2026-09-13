/**
 * Testes para Adaptador BPMN e Sistema de Feature Flags
 * 
 * @group phase4/adapters-flags
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// DOMParser e XMLSerializer são providos pelo ambiente happy-dom do Vitest
import {
  bpmnToCanonical,
  canonicalToBpmn,
  getElementSupport,
  validateBpmnXml,
} from '../bpmnAdapter';
import {
  FeatureFlagManager,
  RolloutStrategy,
  getFeatureFlagManager,
  initializeFeatureFlagManager,
} from '../../../../lib/featureFlags';

describe('BPMN Adapter', () => {
  const validBpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                   id="definitions_Process_123"
                   name="TestProcess">
  <bpmn:process id="Process_123" name="My Process">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:task id="Task_1" name="Do Something" />
    <bpmn:endEvent id="End_1" name="End" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  describe('bpmnToCanonical', () => {
    it('deve converter BPMN XML válido para canônico', () => {
      const canonical = bpmnToCanonical(validBpmnXml);

      expect(canonical).toBeDefined();
      expect(canonical.id).toBe('Process_123');
      expect(canonical.name).toBe('My Process');
      expect(canonical.nodes).toHaveLength(3);
      expect(canonical.edges).toHaveLength(2);
    });

    it('deve mapear tipos de nó BPMN para tipos canônicos', () => {
      const canonical = bpmnToCanonical(validBpmnXml);

      expect(canonical.nodes.some((n) => n.type === 'canonical.start')).toBe(
        true
      );
      expect(canonical.nodes.some((n) => n.type === 'canonical.task')).toBe(
        true
      );
      expect(canonical.nodes.some((n) => n.type === 'canonical.end')).toBe(
        true
      );
    });

    it('deve preservar nomes de elementos', () => {
      const canonical = bpmnToCanonical(validBpmnXml);

      const startNode = canonical.nodes.find((n) => n.id === 'Start_1');
      expect(startNode?.label).toBe('Start');

      const taskNode = canonical.nodes.find((n) => n.id === 'Task_1');
      expect(taskNode?.label).toBe('Do Something');
    });

    it('deve converter sequenceFlows para edges', () => {
      const canonical = bpmnToCanonical(validBpmnXml);

      expect(canonical.edges).toHaveLength(2);
      expect(canonical.edges.some((e) => e.source === 'Start_1')).toBe(true);
      expect(canonical.edges.some((e) => e.target === 'Task_1')).toBe(true);
    });

    it('deve lançar erro para XML inválido', () => {
      expect(() => bpmnToCanonical('invalid xml')).toThrow();
    });

    it('deve lançar erro se nenhum process element encontrado', () => {
      const noBpmnProcess = `<?xml version="1.0"?>
<root><element>test</element></root>`;
      expect(() => bpmnToCanonical(noBpmnProcess)).toThrow();
    });

    it('deve suportar gateways de decisão', () => {
      const bpmnWithGateway = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="p1">
    <bpmn:startEvent id="s1" />
    <bpmn:exclusiveGateway id="g1" name="Decisão" />
    <bpmn:endEvent id="e1" />
    <bpmn:sequenceFlow id="f1" sourceRef="s1" targetRef="g1" />
    <bpmn:sequenceFlow id="f2" sourceRef="g1" targetRef="e1" />
  </bpmn:process>
</bpmn:definitions>`;

      const canonical = bpmnToCanonical(bpmnWithGateway);
      const gatewayNode = canonical.nodes.find((n) =>
        n.type.includes('gateway')
      );

      expect(gatewayNode).toBeDefined();
      expect(gatewayNode?.type).toBe('canonical.gateway.exclusive');
    });
  });

  describe('canonicalToBpmn', () => {
    it('deve converter canônico para XML BPMN válido', () => {
      const canonical = {
        id: 'test-process',
        name: 'Test',
        nodes: [
          { id: 'n1', type: 'canonical.start', label: 'Start' },
          { id: 'n2', type: 'canonical.task', label: 'Task' },
          { id: 'n3', type: 'canonical.end', label: 'End' },
        ],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            type: 'canonical.edge',
            config: {},
          },
          {
            id: 'e2',
            source: 'n2',
            target: 'n3',
            type: 'canonical.edge',
            config: {},
          },
        ],
      };

      const bpmnXml = canonicalToBpmn(canonical);

      expect(bpmnXml).toContain('<?xml version');
      expect(bpmnXml).toContain('bpmn:definitions');
      expect(bpmnXml).toContain('bpmn:process');
      expect(bpmnXml).toContain('bpmn:startEvent');
      expect(bpmnXml).toContain('bpmn:task');
      expect(bpmnXml).toContain('bpmn:endEvent');
    });

    it('deve incluir BPMN DI para visualização', () => {
      const canonical = {
        id: 'p1',
        name: 'Test',
        nodes: [
          { id: 'n1', type: 'canonical.start', label: 'Start' },
        ],
        edges: [],
      };

      const bpmnXml = canonicalToBpmn(canonical);

      expect(bpmnXml).toContain('bpmndi:BPMNDiagram');
      expect(bpmnXml).toContain('bpmndi:BPMNPlane');
      expect(bpmnXml).toContain('bpmndi:BPMNShape');
    });

    it('deve lançar erro para canônico inválido', () => {
      expect(() => canonicalToBpmn(null)).toThrow();
      expect(() => canonicalToBpmn({ name: 'no id' })).toThrow();
    });
  });

  describe('Element Support', () => {
    it('deve indicar suporte para elementos padrão', () => {
      expect(getElementSupport('startEvent').supported).toBe(true);
      expect(getElementSupport('task').supported).toBe(true);
      expect(getElementSupport('endEvent').supported).toBe(true);
    });

    it('deve indicar falta de suporte para elementos avançados', () => {
      expect(getElementSupport('callActivity').supported).toBe(false);
      expect(getElementSupport('callActivity').fallback).toBeDefined();
    });
  });

  describe('BPMN XML Validation', () => {
    it('deve validar XML válido', () => {
      const result = validateBpmnXml(validBpmnXml);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('deve detectar XML inválido', () => {
      const result = validateBpmnXml('invalid xml');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('deve avisar sobre múltiplos processos', () => {
      const multiProcess = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="p1" />
  <bpmn:process id="p2" />
</bpmn:definitions>`;

      const result = validateBpmnXml(multiProcess);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe('Feature Flag Manager', () => {
  let manager;

  beforeEach(() => {
    manager = new FeatureFlagManager({
      canonicalRuntime: false,
      bpmnNativeSupport: false,
      canonicalUI: true,
    });
  });

  describe('Base Configuration', () => {
    it('deve retornar flag base quando nenhum override', () => {
      expect(manager.isEnabled('canonicalUI')).toBe(true);
      expect(manager.isEnabled('canonicalRuntime')).toBe(false);
    });

    it('deve retornar false para flag desconhecida', () => {
      expect(manager.isEnabled('unknownFlag')).toBe(false);
    });
  });

  describe('Tenant Overrides', () => {
    it('deve permitir override por tenant', () => {
      manager.setTenantFlags('tenant-1', {
        canonicalRuntime: true,
      });

      expect(
        manager.isEnabled('canonicalRuntime', { tenantId: 'tenant-1' })
      ).toBe(true);
      expect(
        manager.isEnabled('canonicalRuntime', { tenantId: 'tenant-2' })
      ).toBe(false);
    });

    it('deve atualizar flags de tenant existente', () => {
      manager.setTenantFlags('tenant-1', {
        canonicalRuntime: true,
      });
      manager.setTenantFlags('tenant-1', {
        bpmnNativeSupport: true,
      });

      const flags = manager.getFeatureStatus({ tenantId: 'tenant-1' });

      expect(flags.canonicalRuntime).toBe(true);
      expect(flags.bpmnNativeSupport).toBe(true);
    });
  });

  describe('User Overrides', () => {
    it('deve permitir override por usuário', () => {
      manager.setUserFlags('user-1', {
        canonicalRuntime: true,
      });

      expect(manager.isEnabled('canonicalRuntime', { userId: 'user-1' })).toBe(
        true
      );
    });

    it('deve ter prioridade mais alta que tenant override', () => {
      manager.setTenantFlags('tenant-1', {
        canonicalRuntime: false,
      });
      manager.setUserFlags('user-1', {
        canonicalRuntime: true,
      });

      expect(
        manager.isEnabled('canonicalRuntime', {
          tenantId: 'tenant-1',
          userId: 'user-1',
        })
      ).toBe(true);
    });
  });

  describe('Status de Recursos', () => {
    it('deve retornar status de todas as features', () => {
      const status = manager.getFeatureStatus();

      expect(status.canonicalUI).toBe(true);
      expect(status.canonicalRuntime).toBe(false);
      expect(status.bpmnNativeSupport).toBe(false);
    });

    it('deve incluir overrides no status', () => {
      manager.setTenantFlags('tenant-1', {
        canonicalRuntime: true,
      });

      const status = manager.getFeatureStatus({ tenantId: 'tenant-1' });

      expect(status.canonicalRuntime).toBe(true);
    });
  });

  describe('Export/Import', () => {
    it('deve exportar configuração', () => {
      manager.setTenantFlags('tenant-1', { canonicalRuntime: true });

      const exported = manager.export();

      expect(exported.config).toBeDefined();
      expect(exported.tenantOverrides).toBeDefined();
      expect(exported.exportedAt).toBeDefined();
    });

    it('deve importar configuração', () => {
      manager.setTenantFlags('tenant-1', { canonicalRuntime: true });
      const exported = manager.export();

      const manager2 = new FeatureFlagManager();
      manager2.import(exported);

      expect(
        manager2.isEnabled('canonicalRuntime', { tenantId: 'tenant-1' })
      ).toBe(true);
    });
  });
});

describe('Rollout Strategies', () => {
  describe('Gradual Rollout', () => {
    it('deve retornar percentual correto da fase', () => {
      const strategy = RolloutStrategy.gradual({
        startDate: new Date(Date.now() - 10000), // 10s atrás
        phase1: { percentage: 10, duration: '1s' },
        phase2: { percentage: 50, duration: '5s' },
        phase4: { percentage: 100 },
      });

      const phase = strategy.getCurrentPhase();

      expect(phase.percentage).toBeGreaterThan(0);
    });
  });

  describe('Whitelist Strategy', () => {
    it('deve permitir apenas tenants na whitelist', () => {
      const strategy = RolloutStrategy.whitelist(['tenant-1', 'tenant-2']);

      expect(strategy.isEnabled('tenant-1')).toBe(true);
      expect(strategy.isEnabled('tenant-3')).toBe(false);
    });
  });

  describe('Blacklist Strategy', () => {
    it('deve bloquear apenas tenants na blacklist', () => {
      const strategy = RolloutStrategy.blacklist(['tenant-excluded']);

      expect(strategy.isEnabled('tenant-1')).toBe(true);
      expect(strategy.isEnabled('tenant-excluded')).toBe(false);
    });
  });

  describe('Group Strategy', () => {
    it('deve aplicar versão por grupo', () => {
      const strategy = RolloutStrategy.byGroup({
        'premium': { enabled: true },
        'free': { enabled: false },
      });

      expect(strategy.isEnabled({ group: 'premium' })).toBe(true);
      expect(strategy.isEnabled({ group: 'free' })).toBe(false);
    });
  });
});

describe('Global Feature Flag Manager', () => {
  it('deve ter singleton global', () => {
    const manager1 = getFeatureFlagManager();
    const manager2 = getFeatureFlagManager();

    expect(manager1).toBe(manager2);
  });

  it('deve permitir inicialização customizada', () => {
    initializeFeatureFlagManager({
      customFeature: true,
    });

    const manager = getFeatureFlagManager();
    expect(manager.isEnabled('customFeature')).toBe(true);
  });
});
