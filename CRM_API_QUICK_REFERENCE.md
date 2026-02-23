# CRM API Quick Reference & Usage Guide

## Quick Start

### Installation & Setup

```bash
# Install dependencies
npm install

# Run database migrations
npm run db:migrate

# Start server (default: port 3000)
npm start

# Run performance tests
npm run test:crm:performance

# Run CI/CD pipeline
git push main  # Triggers GitHub Actions
```

### Environment Variables

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=crm_db
DB_USER=crm_user
DB_PASSWORD=crm_pass

# API
API_PORT=3000
API_BASE_URL=http://localhost:3000

# Auth
JWT_SECRET=your-secret-key-here

# Webhooks
WEBHOOK_RETRY_ATTEMPTS=3
WEBHOOK_RETRY_INTERVAL_SECONDS=60
```

---

## API Endpoints

### Base URL
```
http://localhost:3000/api/crm
```

### Authentication
All requests require:
```
Headers:
  Authorization: Bearer <token>
  X-Tenant-Key: your-tenant-key
  Content-Type: application/json
```

---

## Core CRM Operations

### Accounts

```bash
# Create account
POST /api/crm/accounts
{
  "name": "Acme Corporation",
  "ownerUserId": "user-123",
  "status": "active",
  "attributes": { "website": "acme.com" }
}

# List accounts
GET /api/crm/accounts?limit=20&offset=0

# Get account
GET /api/crm/accounts/{accountId}

# Update account
PUT /api/crm/accounts/{accountId}

# Delete account
DELETE /api/crm/accounts/{accountId}
```

### Contacts

```bash
# Create contact
POST /api/crm/contacts
{
  "accountId": "crmacc-123",
  "name": "John Doe",
  "email": "john@acme.com",
  "phone": "+5511999999999",
  "role": "CEO",
  "status": "active"
}

# List contacts (by account)
GET /api/crm/contacts?accountId=crmacc-123

# Get/Update/Delete
GET /api/crm/contacts/{contactId}
PUT /api/crm/contacts/{contactId}
DELETE /api/crm/contacts/{contactId}
```

### Leads

```bash
# Create lead
POST /api/crm/leads
{
  "contactId": "crmctt-123",
  "source": "website",
  "status": "new",
  "score": 0
}

# List leads (filter by status/source)
GET /api/crm/leads?status=qualified&source=website

# Score leads (RPA)
POST /api/crm/rpa/score-leads
{
  "leads": [
    { "id": "lead-1", "email": "john@company.com", "company_size": "enterprise" }
  ]
}
```

### Pipelines

```bash
# Create pipeline
POST /api/crm/pipelines
{
  "name": "Standard Sales",
  "isDefault": true,
  "stages": [
    { "id": "lead", "name": "Lead" },
    { "id": "qualified", "name": "Qualified" },
    { "id": "proposal", "name": "Proposal" },
    { "id": "negotiation", "name": "Negotiation" },
    { "id": "won", "name": "Won" }
  ]
}

# List pipelines
GET /api/crm/pipelines

# Get pipeline
GET /api/crm/pipelines/{pipelineId}
```

### Opportunities

```bash
# Create opportunity
POST /api/crm/opportunities
{
  "pipelineId": "crmpl-123",
  "stageId": "lead",
  "title": "ABC Corp Deal",
  "accountId": "crmacc-123",
  "valueCents": 500000,
  "currency": "BRL",
  "status": "open",
  "expectedCloseAt": "2024-03-31"
}

# List opportunities
GET /api/crm/opportunities?pipelineId=crmpl-123&status=open

# Move opportunity to stage
POST /api/crm/opportunities/{opportunityId}/move-stage
{
  "toStageId": "qualified"
}

# Analyze deal health (RPA)
POST /api/crm/rpa/deal-health
{
  "opportunity": { "id": "opp-123", "stage_id": "proposal", ... }
}
```

### Activities

```bash
# Log activity
POST /api/crm/activities
{
  "type": "call",
  "status": "completed",
  "opportunityId": "crmopp-123",
  "dueAt": "2024-02-21",
  "completedAt": "2024-02-21",
  "payload": { "duration": 45, "notes": "Good conversation" }
}

# Get timeline
GET /api/crm/timeline/crm_opportunity/crmopp-123
```

---

## Analytics

```bash
# Get dashboard metrics
GET /api/crm/analytics/dashboard

# Get pipeline report
GET /api/crm/analytics/pipeline/{pipelineId}

# Get account report
GET /api/crm/analytics/account/{accountId}

# Get lead analysis
GET /api/crm/analytics/leads?status=qualified&source=website

# Response example:
{
  "ok": true,
  "report": {
    "type": "dashboard",
    "data": {
      "totalAccounts": 24,
      "totalContacts": 127,
      "totalLeads": 18,
      "pipelineValue": "R$ 2.5M",
      "stages": { "lead": 5, "qualified": 8, "proposal": 3 }
    }
  }
}
```

---

## Webhooks & Integrations

### Webhooks

```bash
# Register webhook
POST /api/crm/webhooks
{
  "name": "Slack Integration",
  "url": "https://hooks.slack.com/services/...",
  "events": ["opportunity.created", "opportunity.stage_changed"],
  "retry_attempts": 3,
  "retry_interval_seconds": 60
}

# List webhooks
GET /api/crm/webhooks

# Test webhook
POST /api/crm/webhooks/{webhookId}/test

# Get queue status
GET /api/crm/webhooks/{webhookId}/queue

# Delete webhook
DELETE /api/crm/webhooks/{webhookId}
```

### External Integrations

```bash
# Create integration
POST /api/crm/integrations
{
  "provider": "hubspot",
  "credentials": {
    "api_key": "your-hubspot-api-key"
  },
  "sync_direction": "bidirectional"
}

# List integrations
GET /api/crm/integrations

# Sync data
POST /api/crm/integrations/{integrationId}/sync?entity=accounts

# Delete integration
DELETE /api/crm/integrations/{integrationId}
```

---

## RBAC & Security

### Create role
```bash
POST /api/crm/roles
{
  "name": "Sales Manager",
  "permissions": [
    "crm:accounts:read",
    "crm:accounts:write",
    "crm:opportunities:read",
    "crm:opportunities:write",
    "crm:leads:read"
  ]
}
```

### Assign role to user
```bash
POST /api/crm/users/{userId}/roles
{
  "roleId": "role-123"
}
```

### Grant resource permission
```bash
POST /api/crm/resources/{resourceType}/{resourceId}/permissions
{
  "userId": "user-123",
  "level": "edit"  # view, edit, delete, owner
}
```

### Get audit logs
```bash
GET /api/crm/audit-logs?entity_type=opportunity&limit=100
```

---

## RPA Automation

### Score leads
```bash
POST /api/crm/rpa/score-leads
{
  "leads": [
    {
      "id": "lead-1",
      "email": "john@company.com",
      "page_views": 15,
      "email_opens": 5,
      "company_size": "enterprise",
      "industry": "SaaS"
    }
  ],
  "customRules": [ ... ] # Optional
}

# Response:
{
  "ok": true,
  "summary": {
    "totalLeads": 1,
    "hottestLeads": 1,
    "warmLeads": 0,
    "coldLeads": 0,
    "avgScore": 85
  },
  "qualified": [
    {
      "leadId": "lead-1",
      "score": 85,
      "grade": "A",
      "gradeLevel": "hot",
      "status": "qualified",
      "recommendedAction": "immediate_outreach",
      "assignedTo": "rep-saas-1"
    }
  ]
}
```

### Check opportunity auto-progression
```bash
POST /api/crm/rpa/auto-progression
{
  "opportunity": {
    "id": "opp-123",
    "stage_id": "discovery",
    "needs_documented": true,
    "stakeholders_aligned": true,
    "decision_timeline_known": true
  }
}

# Response:
{
  "ok": true,
  "progression": {
    "shouldProgress": true,
    "fromStage": "discovery",
    "toStage": "proposal",
    "ruleId": "rule-proposal-ready",
    "ruleName": "Ready for Proposal"
  }
}
```

### Analyze pipeline risks
```bash
POST /api/crm/rpa/pipeline-risks
{
  "opportunities": [ ... ]
}

# Response:
{
  "ok": true,
  "risks": {
    "at_risk": [...],
    "stalled": [...],
    "accelerating": [...],
    "near_close": [...]
  },
  "summary": {
    "at_risk_count": 3,
    "stalled_count": 2,
    "accelerating_count": 5,
    "near_close_count": 8
  }
}
```

---

## Data Migration

### Export data
```bash
GET /api/crm/data/export?exportType=accounts&format=csv
# Returns: CSV file with all accounts

GET /api/crm/data/export?exportType=leads&format=json
# Returns: JSON array of leads
```

### Import data
```bash
POST /api/crm/data/import?importType=contacts&format=csv
{ "fileContent": "name,email,phone\nJohn Doe,john@acme.com,..." }

# Response:
{
  "ok": true,
  "import": {
    "importType": "contacts",
    "totalRecords": 100,
    "successful": 98,
    "failed": 2,
    "errors": [ ... ]
  }
}
```

### Bulk update
```bash
POST /api/crm/data/bulk-update?updateType=leads
{
  "updates": [
    { "id": "lead-1", "status": "qualified", "score": 75 },
    { "id": "lead-2", "status": "qualified", "score": 68 }
  ]
}
```

### Detect duplicates
```bash
GET /api/crm/data/duplicates?entityType=contacts&threshold=0.8

# Response:
{
  "ok": true,
  "duplicateAnalysis": {
    "entityType": "contacts",
    "totalRecords": 150,
    "duplicatesFound": 3,
    "duplicates": [
      {
        "record1Id": "crmctt-1",
        "record2Id": "crmctt-2",
        "similarity": 95,
        "matchedFields": ["name", "email"]
      }
    ]
  }
}
```

---

## Error Handling

All endpoints return consistent error format:

```json
{
  "ok": false,
  "error": "descriptive error message"
}
```

### Common Status Codes
- `200` - OK
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Performance Tips

1. **Pagination**: Always use `limit` and `offset` for large datasets
   ```
   GET /api/crm/accounts?limit=100&offset=0
   ```

2. **Filtering**: Use query parameters to filter results
   ```
   GET /api/crm/leads?status=qualified&source=website
   ```

3. **Batch Operations**: Use RPA endpoints for bulk processing
   ```
   POST /api/crm/rpa/score-leads  # Process 1000s of leads at once
   ```

4. **Webhook Async**: Let webhooks run async, don't wait for delivery
5. **Connection Pooling**: Use persistent DB connections

---

## Testing

### Unit Tests
```bash
npm run test:crm
```

### Integration Tests
```bash
npm run test:crm:integration
```

### Load Tests (k6)
```bash
k6 run api/tests/crm-performance.js

# Limits:
# - 10 VUs for 30 seconds
# - P95 response < 500ms
# - P99 response < 1000ms
# - 90%+ success rate
```

---

## Production Deployment

### Docker
```bash
docker build -t crm-api:latest .
docker run -e DB_HOST=postgres -p 3000:3000 crm-api:latest
```

### Environment Secrets
```bash
# Set in GitHub Secrets for CI/CD
DB_PASSWORD=xxxx
JWT_SECRET=xxxx
WEBHOOK_SECRET=xxxx
```

### Health Check
```bash
curl http://localhost:3000/health
```

---

## Useful Commands

```bash
# List all endpoints
npm run api:docs  # Generate API docs

# Run database migrations
npm run db:migrate

# Rollback migrations
npm run db:migrate:undo

# Seed database
npm run db:seed

# Check database status
npm run db:status

# Monitor webhooks
npm run webhooks:monitor

# Sync external integrations
npm run integrations:sync

# Generate test data
npm run db:generate-test-data
```

---

## Architecture Diagram

```
Client (Web/Mobile)
    ↓
    ↓ HTTP Request + Bearer Token + Tenant Key
    ↓
CRM API Gateway (Node.js)
    ↓
    ├─ CRM Auth Middleware (verify token, extract tenant, load permissions)
    ├─ CRM Handler Layer (REST endpoints)
    ├─ CRM Service Layer (business logic)
    ├─ CRM Webhook Interceptor (auto-trigger webhooks)
    ├─ CRM Database (PostgreSQL)
    ├─ Event Ledger (event sourcing)
    └─ Webhook Queue (async delivery)
        ↓
        External Integrations (Salesforce, HubSpot, Slack, etc.)
```

---

## Support & Documentation

- **API Docs**: `/api/docs` (OpenAPI/Swagger)
- **GitHub**: https://github.com/...
- **Issues**: https://github.com/.../issues
- **Discussions**: https://github.com/.../discussions

---

Last Updated: $(date)
