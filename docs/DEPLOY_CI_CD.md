# Deployment: CI/CD (GitHub Actions / Jenkins / GitLab)

Guia para integração contínua e deployment automatizado no r-agent2.

---

## 1. GitHub Actions

### 1.1. Workflow Estrutura

**`.github/workflows/ci-system-validate.yml`:**

```yaml
name: CI - System Validate

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: ragent2_ci
          POSTGRES_PASSWORD: ci_password
          POSTGRES_DB: ragent2_ci
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7-alpine
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Setup RUNTIME_ROOT
        run: |
          export RUNTIME_ROOT=/tmp/ragent2-ci-${{ github.run_id }}
          mkdir -p $RUNTIME_ROOT
          echo "RUNTIME_ROOT=$RUNTIME_ROOT" >> $GITHUB_ENV

      - name: Setup database
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: ragent2_ci
          DB_PASSWORD: ci_password
          DB_NAME: ragent2_ci
         run: npm run db:migrate

      - name: Core Test Gates
        run: |
           npm run test:unit
           npm run test:flow
           npm run test:data

      - name: CI Test Suite
        run: npm run test:ci

      - name: Extended Regression
        run: npm run test:system

      - name: System Validate (Smoke Tests)
        env:
          NODE_ENV: test
          RUNTIME_ROOT: /tmp/ragent2-ci-${{ github.run_id }}
          DB_HOST: localhost
          REDIS_HOST: localhost
        run: npm run system:validate

      - name: Check GO/NO-GO
        env:
          RUNTIME_ROOT: /tmp/ragent2-ci-${{ github.run_id }}
        run: |
          npm run system:release-gate
          EXIT_CODE=$(npm run system:go-no-go || true)
          if [ $EXIT_CODE -eq 1 ]; then
            echo "❌ NO_GO detection"
            exit 1
          fi

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results-${{ github.run_id }}
          path: |
            qa-mesh/system-validate/
            qa/l*.json
            coverage/

      - name: Comment PR with Results
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('/tmp/ragent2-ci-${{ github.run_id }}/qa-mesh/system-validate/meshReport.json', 'utf8');
            const parsed = JSON.parse(report);
            
            let comment = `## ✅ System Validate Results\n\n`;
            comment += `- Pass Rate: ${parsed.passRate}%\n`;
            comment += `- Domains Passed: ${parsed.domainsPass.join(', ')}\n`;
            comment += `- Exit: ${parsed.decision}\n`;
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

### 1.2. Build & Push to Registry

**`.github/workflows/build-and-push.yml`:**

```yaml
name: Build & Push Docker Image

on:
  push:
    branches: [main]
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Login to Registry
        uses: docker/login-action@v2
        with:
          registry: ${{ secrets.REGISTRY_HOST }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v4
        with:
          images: ${{ secrets.REGISTRY_HOST }}/ragent2
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          file: ./api/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan image for vulnerabilities
        run: |
          docker pull ${{ secrets.REGISTRY_HOST }}/ragent2:latest
          docker scan ${{ secrets.REGISTRY_HOST }}/ragent2:latest || true
```

### 1.3. Deploy to Production

**`.github/workflows/deploy-production.yml`:**

```yaml
name: Deploy to Production

on:
  workflow_run:
    workflows: ["Build & Push Docker Image"]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Deploy to Production Server
        env:
          DEPLOY_KEY: ${{ secrets.PROD_DEPLOY_KEY }}
          DEPLOY_HOST: ${{ secrets.PROD_DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.PROD_DEPLOY_USER }}
        run: |
          # Setup SSH
          mkdir -p ~/.ssh
          echo "$DEPLOY_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          
          # SSH into production
          ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=no \
            $DEPLOY_USER@$DEPLOY_HOST << 'EOF'
            
            cd /opt/ragent2
            
            # Backup current
            docker-compose -f docker-compose.prod.yml exec ragent2-api \
              npm run system:go-no-go || exit 1
            
            # Pull latest
            docker-compose -f docker-compose.prod.yml pull
            
            # Update
            docker-compose -f docker-compose.prod.yml up -d
            
            # Verify
            docker-compose -f docker-compose.prod.yml exec ragent2-api \
              npm run check:green || (
                docker-compose -f docker-compose.prod.yml rollback
                exit 1
              )
            
            echo "✅ Deployment successful"
          EOF

      - name: Notify Slack
        if: always()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'Production deployment ${{ job.status }}'
          webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

---

## 2. Jenkins

### 2.1. Pipeline Groovy Script

**`Jenkinsfile`:**

```groovy
pipeline {
  agent any
  
  options {
    timeout(time: 1, unit: 'HOURS')
    buildDiscarder(logRotator(numToKeepStr: '10'))
  }

  environment {
    REGISTRY = credentials('registry-credentials')
    RUNTIME_ROOT = "/tmp/ragent2-ci-${BUILD_ID}"
    NODE_ENV = 'test'
  }

  stages {
    stage('Setup') {
      steps {
        script {
          sh '''
            node --version
            npm --version
            mkdir -p ${RUNTIME_ROOT}
            npm ci
          '''
        }
      }
    }

    stage('Core Test Gates') {
      steps {
        sh '''
           npm run test:unit
           npm run test:flow
           npm run test:data
        '''
      }
    }

     stage('CI Test Suite') {
      steps {
         sh 'npm run test:ci'
      }
      post {
        always {
           archiveArtifacts artifacts: 'qa-mesh/**/*.json,qa/**/*.json', allowEmptyArchive: true
        }
      }
    }

    stage('Extended Regression') {
      steps {
        sh 'npm run test:system'
      }
    }

    stage('System Validate') {
      steps {
        sh '''
          export RUNTIME_ROOT=${RUNTIME_ROOT}
           npm run db:migrate
          npm run system:validate
        '''
      }
      post {
        always {
          archiveArtifacts artifacts: 'qa-mesh/**/*.json'
        }
      }
    }

    stage('Build Docker Image') {
      when {
        branch 'main'
      }
      steps {
        script {
          sh '''
            docker build -t ${REGISTRY}/ragent2:${BUILD_NUMBER} .
            docker tag ${REGISTRY}/ragent2:${BUILD_NUMBER} ${REGISTRY}/ragent2:latest
          '''
        }
      }
    }

    stage('Push to Registry') {
      when {
        branch 'main'
      }
      steps {
        script {
          sh '''
            docker login -u ${REGISTRY_USR} -p ${REGISTRY_PSW} ${REGISTRY_HOST}
            docker push ${REGISTRY}/ragent2:${BUILD_NUMBER}
            docker push ${REGISTRY}/ragent2:latest
          '''
        }
      }
    }

    stage('Deploy to Staging') {
      when {
        branch 'main'
      }
      steps {
        script {
          sh '''
            # Deploy to staging
            ssh deploy@staging "cd /opt/ragent2 && \
              docker-compose pull && \
              docker-compose up -d && \
              docker-compose exec ragent2-api npm run system:validate"
          '''
        }
      }
    }

    stage('Health Check') {
      when {
        branch 'main'
      }
      steps {
        timeout(time: 5, unit: 'MINUTES') {
          waitUntil {
            script {
              def response = sh(script: '''
                curl -s http://staging:3000/health | jq '.status'
              ''', returnStdout: true).trim()
              return response == '"ok"'
            }
          }
        }
      }
    }

    stage('Deploy to Production') {
      when {
        branch 'main'
        expression { currentBuild.result == null || currentBuild.result == 'SUCCESS' }
      }
      input {
        message "Deploy to Production?"
        ok "Deploy"
      }
      steps {
          services:
            - postgres:14
            - redis:7-alpine
        script {
           - npm run test:unit
           - npm run test:flow
           - npm run test:data
              docker-compose -f docker-compose.prod.yml pull && \
              docker-compose -f docker-compose.prod.yml up -d && \
              docker-compose -f docker-compose.prod.yml exec ragent2-api npm run system:go-no-go"
          '''
        }
      }
    }
  }

  post {
    always {
      cleanWs()
    }
           - npm run test:ci
      mail(
        subject: "Build Failed: ${env.BUILD_NUMBER}",
        body: "Build ${env.BUILD_NUMBER} failed. Check ${env.BUILD_URL}",
        to: 'devops@seu-dominio.com'
      )
    }
    success {
      script {
        if (env.BRANCH_NAME == 'main') {
          slackSend(
           - npm run db:migrate
            message: "✅ Build ${env.BUILD_NUMBER} succeeded and deployed to production"
          )
        }
      }
    }
  }
}
```

---

## 3. GitLab CI

### 3.1. CI Configuration

**`.gitlab-ci.yml`:**

```yaml
image: node:18-alpine

variables:
  REGISTRY_HOST: "registry.gitlab.com"
  REGISTRY_IMAGE: "${REGISTRY_HOST}/seu-grupo/ragent2"
  RUNTIME_ROOT: "/tmp/ragent2-ci-${CI_PIPELINE_ID}"

stages:
  - build
  - test
  - validate
  - deploy

cache:
  paths:
    - node_modules/
    - .npm/

install:
  stage: build
  script:
    - npm ci --cache .npm --prefer-offline
  artifacts:
    paths:
      - node_modules/

core_test_gates:
  stage: test
  needs: ["install"]
  script:
    - npm run test:unit
    - npm run test:flow
    - npm run test:data
  allow_failure: false

ci_test_suite:
  stage: test
  needs: ["install"]
  services:
    - postgres:14
    - redis:7-alpine
  variables:
    POSTGRES_DB: ragent2_ci
    POSTGRES_USER: ragent2_ci
    POSTGRES_PASSWORD: ci_password
  script:
    - npm run test:ci

extended_regression:
  stage: test
  needs: ["install"]
  services:
    - postgres:14
    - redis:7-alpine
  script:
    - npm run test:system
  allow_failure: true

system_validate:
  stage: validate
  needs: ["install"]
  services:
    - postgres:14
    - redis:7-alpine
  script:
    - mkdir -p ${RUNTIME_ROOT}
    - export RUNTIME_ROOT=${RUNTIME_ROOT}
    - npm run db:migrate
    - npm run system:validate
  artifacts:
    paths:
      - qa-mesh/
      - qa/
    reports:
      junit: qa-mesh/system-validate/junit.xml
  allow_failure: false

build_docker:
  stage: deploy
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - docker build -t ${REGISTRY_IMAGE}:${CI_COMMIT_SHA} .
    - docker tag ${REGISTRY_IMAGE}:${CI_COMMIT_SHA} ${REGISTRY_IMAGE}:latest
    - docker push ${REGISTRY_IMAGE}:${CI_COMMIT_SHA}
    - docker push ${REGISTRY_IMAGE}:latest
  only:
    - main

deploy_staging:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add openssh-client
    - mkdir -p ~/.ssh
    - echo "$STAGING_DEPLOY_KEY" | tr -d '\r' > ~/.ssh/deploy_key
    - chmod 600 ~/.ssh/deploy_key
  script:
    - ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=no \
      deploy@staging "cd /opt/ragent2 && \
      docker-compose pull && \
      docker-compose up -d && \
      docker-compose exec -T ragent2-api npm run system:validate"
  environment:
    name: staging
    url: https://staging.seu-dominio.com
    deployment_tier: staging
  only:
    - main

deploy_production:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add openssh-client
    - mkdir -p ~/.ssh
    - echo "$PROD_DEPLOY_KEY" | tr -d '\r' > ~/.ssh/deploy_key
    - chmod 600 ~/.ssh/deploy_key
  script:
    - ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=no \
      deploy@production "cd /opt/ragent2 && \
      docker-compose -f docker-compose.prod.yml pull && \
      docker-compose -f docker-compose.prod.yml up -d && \
      docker-compose -f docker-compose.prod.yml exec -T ragent2-api npm run system:go-no-go"
  environment:
    name: production
    url: https://api.seu-dominio.com
    deployment_tier: production
  when: manual
  only:
    - main
```

---

## 4. Environment Variables (CI/CD Context)

### 4.1. GitHub Actions Secrets

Set in repository Settings → Secrets and variables:

```
REGISTRY_HOST=registry.seu-host.com
REGISTRY_USERNAME=username
REGISTRY_PASSWORD=token
PROD_DEPLOY_KEY=<SSH_PRIVATE_KEY>
PROD_DEPLOY_HOST=production.seu-dominio.com
PROD_DEPLOY_USER=deploy
SLACK_WEBHOOK=https://hooks.slack.com/...
```

### 4.2. Env File Template (CI)

```bash
# .env.ci - used in all CI/CD runs
NODE_ENV=test
LOG_LEVEL=debug

# Database (CI services)
DB_HOST=localhost
DB_PORT=5432
DB_USER=ragent2_ci
DB_PASSWORD=ci_password
DB_NAME=ragent2_ci

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Runtime (isolated per build)
RUNTIME_ROOT=/tmp/ragent2-ci-${BUILD_ID}

# QA
QA_MESH_SYSTEM_VALIDATE_DIR=${RUNTIME_ROOT}/qa-mesh/system-validate
RELEASE_EVIDENCE_BASE_DIR=${RUNTIME_ROOT}/qa
```

---

## 5. Common CI/CD Patterns

### 5.1. Conditional Deployment

```yaml
# Only deploy on main branch + successful tests
if:
  - branch == main
  - all_tests_passed == true

# Only deploy on tag push
if:
  - event == push
  - ref.startswith("refs/tags/v")
```

### 5.2. Manual Approval Gates

```yaml
# GitHub Actions
- name: Approve Production
  uses: trstringer/manual-approval@v1
  with:
    secret: ${{ secrets.GITHUB_TOKEN }}
    approvers: devops-team

# Jenkins
stage('Deploy to Production') {
  input {
    message "Deploy to Production?"
    ok "Deploy"
  }
}

# GitLab
deploy_production:
  when: manual  # Require manual trigger
```

### 5.3. Rollback Strategy

```bash
# Keep previous successful build
LAST_GOOD_IMAGE=$(docker images --filter "label=last-good" -q | head -1)

# If deployment fails
if [ $? -eq 1 ]; then
  docker tag ${LAST_GOOD_IMAGE} current
  docker-compose up -d
  exit 1
fi

# Mark current as good
docker tag current:latest current:last-good
```

---

## 6. Monitoring & Reporting

### 6.1. Test Reports

```yaml
# GitHub Actions
- uses: dorny/test-reporter@v1
  with:
    name: Test Results
    path: '**/junit.xml'
    reporter: java-junit

# Jenkins
junit 'test-results/**/*.xml'

# GitLab
artifacts:
  reports:
    junit: test-results.xml
```

### 6.2. Coverage Gates

```bash
# Fail if coverage drops below threshold
COVERAGE=$(npm exec -- jest tests/unit --coverage --coverageReporters=text-summary | grep "Statements" | awk '{print $3}')
THRESHOLD=80

if [ ${COVERAGE%.*} -lt $THRESHOLD ]; then
  echo "❌ Coverage ${COVERAGE}% below threshold ${THRESHOLD}%"
  exit 1
fi
```

### 6.3. Notifications

```yaml
# Slack
- slackSend(
    color: 'good',
    message: "✅ Deployed to production",
    channel: '#deployments'
  )

# Email
- mail(
    subject: "Build ${BUILD_NUMBER} Success",
    body: "Deployment successful",
    to: 'devops@seu-dominio.com'
  )

# Webhooks
curl -X POST https://your-webhook.com/deploy \
  -d "status=success&build=${BUILD_ID}"
```

---

## 7. Quick Reference

| Step | GitHub Actions | Jenkins | GitLab |
|------|---|---|---|
| Core gates | `npm run test:unit && npm run test:flow && npm run test:data` | `npm run test:unit && npm run test:flow && npm run test:data` | `npm run test:unit && npm run test:flow && npm run test:data` |
| CI suite | `npm run test:ci` | `npm run test:ci` | `npm run test:ci` |
| Extended regression | `npm run test:system` | `npm run test:system` | `npm run test:system` |
| Validate | `npm run system:validate` | `npm run system:validate` | `npm run system:validate` |
| Build | `docker build` | `docker build` | `docker build` |
| Deploy | SSH exec | SSH exec + input | SSH exec (manual) |

---

## 8. Related Documentation

- [DOUTRINA_OPERACIONAL.md](./DOUTRINA_OPERACIONAL.md#82-cicd-github-actions--jenkins--gitlab)
- [DEPLOY_DOCKER_COMPOSE.md](./DEPLOY_DOCKER_COMPOSE.md)

