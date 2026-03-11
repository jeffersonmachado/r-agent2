import { createBpmnElementRegistry } from './bpmnElementRegistry';
import { registerAdvancedGatewayHandlers } from './bpmnAdvancedGatewayHandlers';
import { registerBoundaryEventHandlers } from './bpmnBoundaryEventHandlers';
import { registerDiagramInterchangeHandlers } from './bpmnDiagramInterchangeHandlers';
import { registerMessageFlowHandlers } from './bpmnMessageFlowHandlers';
import { registerPoolLaneHandlers } from './bpmnPoolLaneHandlers';

/**
 * Create and configure a complete BPMN handler registry
 * Chains all handler registrations in proper dependency order:
 * 1. Base element registry
 * 2. Advanced gateway handlers (parallelGateway, conditionalGateway)
 * 3. Boundary event handlers (timer, error events)
 * 4. Message flow handlers (messageFlow, participant references)
 * 5. Pool/lane handlers (participant, lane, process swimlanes)
 * 6. Diagram interchange handlers (shapes, edges, bounds, waypoints)
 * 
 * @param {Object} config
 * @param {Object} config.flags - Feature flags for export behavior
 * @returns {Object} Fully configured BPMN handler registry
 */
export function createBpmnHandlerRegistry(config = {}) {
  const flags = config.flags || {};

  return registerDiagramInterchangeHandlers(
    registerPoolLaneHandlers(
      registerMessageFlowHandlers(
        registerBoundaryEventHandlers(
          registerAdvancedGatewayHandlers(
            createBpmnElementRegistry({ flags })
          )
        )
      )
    )
  );
}
