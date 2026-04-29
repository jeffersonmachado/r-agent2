export type WaveScenario = {
  id: string;
  waveId: string;
  vertical: string;
  journey: string;
  name: string;
  description?: string;
  source: 'ai_inferred' | 'manual' | 'imported' | 'replay_regression';
  status: 'draft' | 'reviewed' | 'approved' | 'regression' | 'disabled';
  version: string;
  channels: Array<'whatsapp' | 'chat' | 'pbx' | 'api'>;
  risk: 'low' | 'medium' | 'high' | 'critical';
  priority: 'low' | 'medium' | 'high' | 'critical';
  preconditions?: Array<{ type: string; description?: string; data?: Record<string, any> }>;
  steps: WaveScenarioStep[];
  seeds: WaveScenarioSeed[];
  validations?: {
    slaMs?: number;
    fallbackAllowed?: boolean;
    requireBackendValidation?: boolean;
    requireReplay?: boolean;
  };
  tags?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type WaveScenarioStep = {
  id: string;
  order: number;
  type:
    | 'send_message'
    | 'validate_intent'
    | 'provide_data'
    | 'validate_response'
    | 'check_availability'
    | 'select_slot'
    | 'create_booking'
    | 'create_payment'
    | 'validate_backend'
    | 'validate_sla'
    | 'validate_context'
    | 'validate_fallback'
    | 'validate_flow_transition'
    | 'validate_access_release'
    | 'wait_for_event'
    | 'trigger_channel_event';
  name?: string;
  description?: string;
  adapter:
    | 'whatsapp'
    | 'chat'
    | 'pbx'
    | 'api'
    | 'db'
    | 'aiIntentService'
    | 'ragService'
    | 'schedulingService'
    | 'paymentService'
    | 'accessControlService'
    | 'flowEngine';
  channel?: 'whatsapp' | 'chat' | 'pbx' | 'api';
  input?: { text?: string; variants?: string[]; data?: Record<string, any> };
  expected?: {
    intent?: string;
    confidenceMin?: number;
    semantic?: string;
    contains?: string[];
    entity?: string;
    nextStep?: string;
    backendEntity?: string;
    backendExists?: boolean;
    event?: string;
    fallbackTriggered?: boolean;
  };
  data?: Record<string, any>;
  timeoutMs?: number;
  enabled: boolean;
};

export type WaveScenarioSeed = {
  id: string;
  scenarioId: string;
  source: 'ai_generated' | 'manual' | 'from_replay';
  status: 'draft' | 'reviewed' | 'approved' | 'regression' | 'disabled';
  persona: {
    type: string;
    behavior: string;
    priceSensitivity?: 'low' | 'medium' | 'high';
    urgency?: 'low' | 'medium' | 'high';
  };
  inputVariants: string[];
  data: Record<string, any>;
  expected?: {
    intent?: string;
    nextAction?: string;
    shouldCreateLead?: boolean;
    shouldCreateBooking?: boolean;
    shouldCreatePayment?: boolean;
    shouldReleaseAccess?: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export const ALLOWED_STEP_TYPES = [
  'send_message',
  'validate_intent',
  'provide_data',
  'validate_response',
  'check_availability',
  'select_slot',
  'create_booking',
  'create_payment',
  'validate_backend',
  'validate_sla',
  'validate_context',
  'validate_fallback',
  'validate_flow_transition',
  'validate_access_release',
  'wait_for_event',
  'trigger_channel_event',
] as const;

export const FORBIDDEN_STEP_TYPES = [
  'click',
  'click_button',
  'fill_input',
  'xpath',
  'css_selector',
  'selenium_action',
  'open_modal',
  'click_dropdown',
] as const;
