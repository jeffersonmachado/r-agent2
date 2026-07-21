-- ============================================================================
-- Agent Operating System — Migration DDL
-- RAP/r-agent2 — 2026-06-11
-- ============================================================================
-- Execute: psql -U <user> -d <db> -f migrations/agent-os-2026-06-11.sql
-- ============================================================================

-- 1. Corporate Agents (Agent Registry)
CREATE TABLE IF NOT EXISTS corporate_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    owner VARCHAR(255),
    department VARCHAR(255),
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    classification VARCHAR(20) NOT NULL DEFAULT 'DEVELOPMENT'
        CHECK (classification IN ('PRODUCTION', 'SUPPORT', 'DEVELOPMENT')),
    capabilities JSONB NOT NULL DEFAULT '[]',
    tools JSONB NOT NULL DEFAULT '[]',
    knowledge_sources JSONB NOT NULL DEFAULT '[]',
    permissions JSONB NOT NULL DEFAULT '[]',
    connected_systems JSONB NOT NULL DEFAULT '[]',
    metrics JSONB NOT NULL DEFAULT '{"executions":0,"successRate":0,"latency":0,"cost":0,"satisfaction":0}',
    governance JSONB NOT NULL DEFAULT '{"approvedBy":null,"approvedAt":null,"riskLevel":"low","auditEnabled":false}',
    lifecycle VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (lifecycle IN ('draft','validation','approved','active','deprecated','archived')),
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS corporate_agents_tenant_idx ON corporate_agents(tenant_id);
CREATE INDEX IF NOT EXISTS corporate_agents_slug_idx ON corporate_agents(slug);
CREATE INDEX IF NOT EXISTS corporate_agents_classification_idx ON corporate_agents(classification);
CREATE INDEX IF NOT EXISTS corporate_agents_lifecycle_idx ON corporate_agents(lifecycle);
CREATE INDEX IF NOT EXISTS corporate_agents_status_idx ON corporate_agents(status);

-- 2. Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS kg_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    type VARCHAR(50) NOT NULL
        CHECK (type IN (
            'Customer','Lead','Conversation','Ticket','Journey',
            'Agent','Replay','Wave','Campaign','Appointment',
            'Contract','Invoice','Knowledge','Decision','Document',
            'Product','Service','Event','Insight'
        )),
    label VARCHAR(255) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}',
    external_ref VARCHAR(255),
    external_type VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kg_nodes_tenant_type_idx ON kg_nodes(tenant_id, type);
CREATE INDEX IF NOT EXISTS kg_nodes_external_idx ON kg_nodes(external_ref, external_type);
CREATE INDEX IF NOT EXISTS kg_nodes_label_idx ON kg_nodes(tenant_id, label);

-- 3. Knowledge Graph Edges
CREATE TABLE IF NOT EXISTS kg_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    source_node_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relationship VARCHAR(255) NOT NULL,
    weight FLOAT NOT NULL DEFAULT 1.0,
    properties JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS kg_edges_tenant_idx ON kg_edges(tenant_id);
CREATE INDEX IF NOT EXISTS kg_edges_nodes_idx ON kg_edges(source_node_id, target_node_id);
CREATE INDEX IF NOT EXISTS kg_edges_relationship_idx ON kg_edges(relationship);

-- 4. Journey Registry
CREATE TABLE IF NOT EXISTS journey_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    domain VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    owner VARCHAR(255),
    criticality VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (criticality IN ('low','medium','high','critical')),
    sla JSONB NOT NULL DEFAULT '{}',
    kpis JSONB NOT NULL DEFAULT '{}',
    success_criteria JSONB NOT NULL DEFAULT '[]',
    scenarios JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','deprecated','archived')),
    metrics JSONB NOT NULL DEFAULT '{"totalExecutions":0,"successRate":0,"avgDuration":0,"failureRate":0}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS journey_registry_tenant_domain_idx ON journey_registry(tenant_id, domain);
CREATE INDEX IF NOT EXISTS journey_registry_slug_idx ON journey_registry(slug);
CREATE INDEX IF NOT EXISTS journey_registry_status_idx ON journey_registry(status);
CREATE INDEX IF NOT EXISTS journey_registry_criticality_idx ON journey_registry(criticality);

-- 5. RAP Learn — Learning Records
CREATE TABLE IF NOT EXISTS learning_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    type VARCHAR(20) NOT NULL
        CHECK (type IN ('failure','regression','pattern','improvement','correction','promotion')),
    source VARCHAR(255),
    source_ref VARCHAR(255),
    classification VARCHAR(255),
    root_cause TEXT,
    suggestion JSONB,
    validation_result JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'detected'
        CHECK (status IN ('detected','classified','analyzed','suggested','validated','promoted','rejected')),
    affected_agents JSONB NOT NULL DEFAULT '[]',
    affected_journeys JSONB NOT NULL DEFAULT '[]',
    metrics JSONB NOT NULL DEFAULT '{}',
    promoted_at TIMESTAMPTZ,
    promoted_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS learning_records_tenant_type_idx ON learning_records(tenant_id, type);
CREATE INDEX IF NOT EXISTS learning_records_status_idx ON learning_records(status);
CREATE INDEX IF NOT EXISTS learning_records_classification_idx ON learning_records(classification);
CREATE INDEX IF NOT EXISTS learning_records_source_idx ON learning_records(source, source_ref);

-- 6. AI Governance Records
CREATE TABLE IF NOT EXISTS ai_governance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    agent_id UUID,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('create','approve','reject','publish','deprecate','archive','execute','decision','audit')),
    actor VARCHAR(255),
    actor_role VARCHAR(255),
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    decision JSONB,
    data_accessed JSONB NOT NULL DEFAULT '[]',
    tools_used JSONB NOT NULL DEFAULT '[]',
    cost FLOAT NOT NULL DEFAULT 0,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low'
        CHECK (risk_level IN ('low','medium','high','critical')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_gov_tenant_idx ON ai_governance_records(tenant_id);
CREATE INDEX IF NOT EXISTS ai_gov_agent_idx ON ai_governance_records(agent_id);
CREATE INDEX IF NOT EXISTS ai_gov_event_type_idx ON ai_governance_records(event_type);
CREATE INDEX IF NOT EXISTS ai_gov_created_idx ON ai_governance_records(created_at);

-- 7. Vertical Templates
CREATE TABLE IF NOT EXISTS vertical_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL DEFAULT 'system',
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL
        CHECK (category IN ('Beauty','Fitness','Food','Clinic','Bakery','Services','Retail','Education','Health','Custom')),
    description TEXT,
    icon VARCHAR(50),
    color VARCHAR(50),
    journeys JSONB NOT NULL DEFAULT '[]',
    agents JSONB NOT NULL DEFAULT '[]',
    knowledge JSONB NOT NULL DEFAULT '[]',
    automations JSONB NOT NULL DEFAULT '[]',
    kpis JSONB NOT NULL DEFAULT '[]',
    config JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','deprecated','archived')),
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vt_tenant_category_idx ON vertical_templates(tenant_id, category);
CREATE INDEX IF NOT EXISTS vt_slug_idx ON vertical_templates(slug);
CREATE INDEX IF NOT EXISTS vt_status_idx ON vertical_templates(status);
