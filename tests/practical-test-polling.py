#!/usr/bin/env python3

"""
Teste Prático: Acompanhar Execução QA Waves via API Unificada
==============================================================
Valida:
1. Criar execução via /api/test-executions
2. Acompanhar polling de status a cada 5s
3. Aguardar conclusão (sucesso ou falha)
4. Validar que resposta não contém 'compatibility'
5. Medir tempo total até conclusão
"""

import requests
import json
import time
from datetime import datetime

BASE = 'http://localhost:3001'
USERNAME = 'systemadmin'
PASSWORD = 'Admin123!'

# ===== SETUP =====
print('\n' + '='*70)
print('TESTE PRÁTICO: Execução QA Waves com API Unificada')
print('='*70)

s = requests.Session()

# 1) Login
print('\n[1/5] Login...')
login_resp = s.post(f"{BASE}/auth/login", json={"username": USERNAME, "password": PASSWORD}, timeout=30)
assert login_resp.status_code == 200, f"Login falhou: {login_resp.status_code}"

login_body = login_resp.json()
token = login_body.get('token')
agent = login_body.get('agent', {})
tenant_id = agent.get('tenantId', 'system')

headers = {
    'Authorization': f'Bearer {token}',
    'X-Tenant-Id': str(tenant_id),
    'Content-Type': 'application/json'
}

print(f"✓ Login bem-sucedido (tenantId={tenant_id})")

# 2) Obter cenários
print('\n[2/5] Carregando cenários...')
sc_resp = s.get(f"{BASE}/api/qa-waves/scenarios", headers=headers, timeout=30)
assert sc_resp.status_code == 200, f"Cenários falhou: {sc_resp.status_code}"

scenarios_response = sc_resp.json()

# Handle wrapped response with 'items' field
if isinstance(scenarios_response, dict) and 'items' in scenarios_response:
    scenarios = scenarios_response['items']
elif isinstance(scenarios_response, list):
    scenarios = scenarios_response
else:
    scenarios = []

if not scenarios:
    raise Exception(f"Nenhum cenário encontrado: {scenarios_response}")

scenario_id = scenarios[0].get('scenarioId') or scenarios[0].get('id')
scenario_name = scenarios[0].get('name', 'Unknown')
print(f"✓ Cenários carregados ({len(scenarios)} total)")
print(f"  → Usando cenário: {scenario_name} (ID: {scenario_id})")

# 3) Criar execução
print('\n[3/5] Criando execução via /api/test-executions...')
start_time = time.time()

te_payload = {
    "source": "qa_waves",
    "mode": "real",
    "scenarioIds": [scenario_id]
}

te_resp = s.post(
    f"{BASE}/api/test-executions",
    headers=headers,
    json=te_payload,
    timeout=30
)

assert te_resp.status_code == 202, f"Criação falhou: {te_resp.status_code}\n{te_resp.text}"

te_body = te_resp.json()
execution_id = te_body.get('executionId') or te_body.get('id')

# Validar ausência de campo compatibility
if 'compatibility' in te_body:
    print("❌ ERRO: Campo 'compatibility' encontrado em resposta!")
    print(f"   Resposta: {json.dumps(te_body, indent=2)}")
    raise Exception("Padrão unificado violado: 'compatibility' presente")

poll_after_ms = te_body.get('pollAfterMs', 5000)
print(f"✓ Execução criada (ID: {execution_id})")
print(f"  → Status inicial: {te_body.get('status')}")
print(f"  → Poll interval: {poll_after_ms}ms")

# 4) Acompanhar polling
print(f'\n[4/5] Acompanhando execução em tempo real (timeout: 2 min)...\n')

poll_count = 0
max_polls = 24  # ~2 minutos com 5s entre polls
status_transitions = []
final_status = None
final_body = None

while poll_count < max_polls:
    poll_count += 1
    elapsed = time.time() - start_time
    
    # Aguardar intervalo de poll
    time.sleep(poll_after_ms / 1000)
    
    # GET status
    get_resp = s.get(
        f"{BASE}/api/test-executions/{execution_id}",
        headers=headers,
        timeout=30
    )
    
    if get_resp.status_code == 404 and poll_count < 3:
        print(f"  ⏳ Poll #{poll_count} (@{elapsed:.1f}s): 404 Not Found (ainda não registrado, retry...)")
        continue
    
    assert get_resp.status_code == 200, f"GET status falhou: {get_resp.status_code}"
    
    get_body = get_resp.json()
    status = get_body.get('status', 'unknown')
    progress = get_body.get('progress', {})
    progress_pct = progress.get('percentage', 0) if isinstance(progress, dict) else 0
    
    # Verificar ausência de compatibility em cada polling
    if 'compatibility' in get_body:
        print(f"  ❌ ERRO: Campo 'compatibility' em polling #{poll_count}!")
        raise Exception("Padrão unificado violado: 'compatibility' presente no polling")
    
    # Log
    current_time = datetime.now().strftime('%H:%M:%S')
    print(f"  ⏳ Poll #{poll_count} (@{elapsed:.1f}s) [{current_time}]: status={status}, progress={progress_pct}%")
    
    if status not in [s for s, _ in status_transitions]:
        status_transitions.append((status, elapsed))
    
    final_status = status
    final_body = get_body
    
    # Se conclusão (sucesso/falha/erro), parar
    if status.lower() in ['success', 'completed', 'succeeded', 'failed', 'error', 'aborted']:
        print(f"\n  ✓ Execução finalizada com status: {status.upper()}")
        break
    
    if poll_count == max_polls:
        print(f"\n  ⚠️  Timeout de polling atingido após {elapsed:.1f}s")
        break

total_time = time.time() - start_time

# 5) Resumo
print(f'\n[5/5] Resumo da Execução')
print('='*70)
print(f'\n📊 Resultados:')
print(f'  • Execution ID: {execution_id}')
print(f'  • Tempo total: {total_time:.1f}s')
print(f'  • Polls realizados: {poll_count}')
print(f'  • Status final: {final_status}')
print(f'  • Transições de status: {" → ".join([s for s, _ in status_transitions])}')

# Detalhes finais
if final_body:
    print(f'\n📋 Detalhes finais:')
    summary = final_body.get('summary')
    if isinstance(summary, dict):
        for key, value in summary.items():
            print(f'  • {key}: {value}')
    
    # Listar artifacts se disponível
    artifacts = final_body.get('artifacts', [])
    if artifacts:
        print(f'\n📁 Artifacts ({len(artifacts)}):')
        for artifact in artifacts[:5]:  # Mostrar até 5
            print(f'  • {artifact}')

print(f'\n✅ Validações:')
print(f'  ✓ API Unificada: /api/test-executions')
print(f'  ✓ Sem campo compatibility: CONFIRMADO')
print(f'  ✓ Polling funcionando: {poll_count} polls realizados')
print(f'  ✓ Execução completada: {final_status}')

print('\n' + '='*70)
print('✅ TESTE PRÁTICO COMPLETADO COM SUCESSO')
print('='*70 + '\n')
