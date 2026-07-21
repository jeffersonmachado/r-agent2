# Prompt — Gestão Anti-Spam Results (infra-mail)
# Use com: "Siga o prompt em prompts/anti-spam-management.md"

## Contexto da infraestrutura

Servidor: 10.10.2.30 (Alpine Linux, Docker 27.3.1)
Projeto compose: `/opt/results/infra` (project name: `infra-mail`)

Containers:
- `results-mail-postfix` (MX1, IP 10.10.2.3) — Postfix com Rspamd milter
- `results-mail-postfix-mx2` (MX2, IP 10.10.2.23) — Postfix secundário
- `results-mail-rspamd` — Rspamd 3.8 (anti-spam)
- `results-mail-clamav` — ClamAV 1.4 (antivírus)
- `results-mail-dovecot` — Dovecot 2.3.21 (IMAP/POP3)
- `results-mail-redis` — Redis (cache Rspamd)
- `results-mail-ldap` — OpenLDAP (autenticação)
- `observe-icinga2` — Icinga2 (monitoramento)

Rede Docker: `infra-mail_default` (172.27.0.0/16)
Acesso: `sshpass -p 'resu100gabao' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@10.10.2.30`

---

## Tarefa 1 — Reiniciar e concluir treino do Bayes

O classificador Bayes do Rspamd está parcialmente treinado (HAM ~22/200, SPAM 128/200).
Precisa atingir mínimo de 200 HAM e 200 SPAM para ativação automática.

### Script de treino (criar em `/opt/results/infra/scripts/train-bayes.sh`)

```bash
#!/bin/bash
# train-bayes.sh — Treina classificador Bayes do Rspamd
# Uso: bash train-bayes.sh [--ham] [--spam] [--target 200]
set -e

POSTFIX="results-mail-postfix"
RSPAMD="results-mail-rspamd"
TARGET="${TARGET:-200}"
MODE="${1:-both}"
TMPDIR="/tmp/rspamd-training"
mkdir -p "$TMPDIR"

train_ham() {
  echo "[$(date)] Treinando HAM (target: $TARGET)..."
  for dir in $(docker exec "$POSTFIX" find /var/mail/vhosts -type d -name cur -path "*/Maildir/cur" 2>/dev/null); do
    COUNT=$(docker exec "$POSTFIX" sh -c "ls '$dir' 2>/dev/null | wc -l" 2>/dev/null | tr -d ' ')
    [ "$COUNT" -lt 10 ] && continue
    echo "  $dir ($COUNT emails)"
    for f in $(docker exec "$POSTFIX" find "$dir" -type f 2>/dev/null); do
      docker exec "$POSTFIX" cat "$f" 2>/dev/null >> "$TMPDIR/ham.eml"
      SIZE=$(wc -c < "$TMPDIR/ham.eml")
      if [ "$SIZE" -gt 3000000 ]; then
        docker exec -i "$RSPAMD" rspamc -h 127.0.0.1:11334 -t 60 learn_ham < "$TMPDIR/ham.eml" > /dev/null 2>&1
        > "$TMPDIR/ham.eml"
      fi
    done
    HAM=$(docker exec "$RSPAMD" rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep BAYES_HAM | grep -oP 'learned: \K\d+')
    echo "    HAM=$HAM"
    [ "${HAM:-0}" -ge "$TARGET" ] && break
  done
}

train_spam() {
  echo "[$(date)] Treinando SPAM (target: $TARGET)..."
  for dir in $(docker exec "$POSTFIX" find /var/mail/vhosts -type d \( -name .Junk -o -name .Spam \) -path "*/Maildir/*" 2>/dev/null); do
    SPAMDIR="${dir}/cur"
    docker exec "$POSTFIX" sh -c "cat '$SPAMDIR'/* 2>/dev/null" > "$TMPDIR/spam.eml" 2>/dev/null
    SIZE=$(wc -c < "$TMPDIR/spam.eml")
    [ "$SIZE" -lt 1000 ] && continue
    docker exec -i "$RSPAMD" rspamc -h 127.0.0.1:11334 -t 60 learn_spam < "$TMPDIR/spam.eml" > /dev/null 2>&1
    SPAM=$(docker exec "$RSPAMD" rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep BAYES_SPAM | grep -oP 'learned: \K\d+')
    echo "  $SPAMDIR → SPAM=$SPAM"
    [ "${SPAM:-0}" -ge "$TARGET" ] && break
  done
}

case "$MODE" in
  ham)  train_ham ;;
  spam) train_spam ;;
  both) train_ham; train_spam ;;
esac

rm -rf "$TMPDIR"
echo "[$(date)] Concluído."
docker exec "$RSPAMD" rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep -iE "BAYES_HAM|BAYES_SPAM|learned"
```

### Execução (rodar no servidor):
```bash
# Treino completo (HAM + SPAM) — pode levar 30-60 min
TARGET=200 bash /opt/results/infra/scripts/train-bayes.sh

# Apenas HAM
bash /opt/results/infra/scripts/train-bayes.sh --ham

# Verificar progresso durante treino:
docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat | grep BAYES
```

---

## Tarefa 2 — Verificar e manter configurações Postfix

Após rebuild dos containers, o template `main.cf.template` pode reverter ao original da imagem Docker.
A correção atual está no arquivo host: `/opt/results/infra/mail/postfix/main.cf.template`

### Script de verificação e reaplicação:
```bash
#!/bin/bash
# check-postfix-anti-spam.sh — Verifica e reaplica config anti-spam nos MX

check_and_fix() {
  local CONTAINER=$1
  echo "=== $CONTAINER ==="

  # Verificar restrições atuais
  HELO=$(docker exec "$CONTAINER" postconf -h smtpd_helo_restrictions 2>/dev/null)
  SENDER=$(docker exec "$CONTAINER" postconf -h smtpd_sender_restrictions 2>/dev/null)
  RCPT=$(docker exec "$CONTAINER" postconf -h smtpd_recipient_restrictions 2>/dev/null)

  NEEDS_FIX=false
  [ -z "$HELO" ] && NEEDS_FIX=true
  [ -z "$SENDER" ] && NEEDS_FIX=true
  echo "$RCPT" | grep -q "reject_rbl_client" || NEEDS_FIX=true

  if $NEEDS_FIX; then
    echo "  ⚠️ Config incompleta — reaplicando..."
    docker cp /opt/results/infra/mail/postfix/main.cf.template "$CONTAINER:/templates/main.cf.template"
    docker exec "$CONTAINER" sh -c "envsubst < /templates/main.cf.template > /etc/postfix/main.cf && postfix reload"
    echo "  ✅ Corrigido"
  else
    echo "  ✅ OK"
  fi
}

check_and_fix "results-mail-postfix"
check_and_fix "results-mail-postfix-mx2"
```

### Restrições esperadas:
```
smtpd_helo_restrictions = permit_mynetworks, permit_sasl_authenticated,
    reject_invalid_helo_hostname, reject_non_fqdn_helo_hostname,
    reject_unknown_helo_hostname

smtpd_sender_restrictions = permit_mynetworks, permit_sasl_authenticated,
    reject_non_fqdn_sender, reject_unknown_sender_domain

smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated,
    reject_unauth_destination, reject_unknown_recipient_domain,
    reject_rbl_client zen.spamhaus.org,
    reject_rbl_client bl.spamcop.net,
    reject_rbl_client b.barracudacentral.org
```

---

## Tarefa 3 — Painel Icinga anti-spam

### Script de check (já existe em `/opt/results/infra/scripts/check-antispam.sh`):
- Consulta `rspamc stat` no container Rspamd
- Extrai: scanned, rejected, greylisted, add_header, BAYES_HAM, BAYES_SPAM
- Calcula block_rate = (rejected + greylisted) / scanned * 100
- Thresholds: <30% CRITICAL, <50% WARNING
- Saída formato Icinga com perfdata

### Configs Icinga (já copiadas para o container):
- `/etc/icinga2/conf.d/mail-hosts.conf` — Hosts mx1-results, mx2-results, imap-results
- `/etc/icinga2/conf.d/antispam-commands.conf` — CheckCommand "antispam"
- `/etc/icinga2/conf.d/antispam-services.conf` — Service "antispam-health"

### Recarregar Icinga após mudanças:
```bash
docker exec observe-icinga2 icinga2 daemon -C && docker exec observe-icinga2 pkill -HUP icinga2
```

### Reaplicar configs se container for recriado:
```bash
for f in mail-hosts antispam-commands antispam-services; do
  docker cp /tmp/icinga-${f}.conf observe-icinga2:/etc/icinga2/conf.d/${f}.conf
done
```

### Verificar no IcingaWeb2:
- URL: `https://10.10.2.30/icinga/`
- Host: `mx1-results` → Service: `antispam-health`
- Dashboard: criar view com todos os serviços de email

---

## Tarefa 4 — Manutenção contínua (cron)

### Script de verificação diária (`/opt/results/infra/scripts/anti-spam-daily.sh`):
```bash
#!/bin/bash
# anti-spam-daily.sh — Verificação diária da saúde anti-spam
# Executar via cron: 0 8 * * * /opt/results/infra/scripts/anti-spam-daily.sh

LOG="/var/log/anti-spam-daily.log"
echo "=== $(date) ===" >> "$LOG"

# 1. Status atual
echo "Status anti-spam:" >> "$LOG"
/opt/results/infra/scripts/check-antispam.sh >> "$LOG" 2>&1

# 2. Bayes health
echo "Bayes:" >> "$LOG"
docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep -E "BAYES_HAM|BAYES_SPAM" >> "$LOG"

# 3. Verificar config Postfix
echo "Postfix config:" >> "$LOG"
docker exec results-mail-postfix postconf smtpd_recipient_restrictions 2>/dev/null | grep "reject_rbl_client" >> "$LOG" && echo "  RBL: OK" >> "$LOG" || echo "  RBL: FALHANDO!" >> "$LOG"

# 4. Verificar Rspamd
echo "Rspamd:" >> "$LOG"
docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep "scanned" >> "$LOG"

# 5. Alertar se Bayes não treinado
HAM=$(docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat 2>/dev/null | grep BAYES_HAM | grep -oP 'learned: \K\d+')
if [ "${HAM:-0}" -lt 200 ]; then
  echo "⚠️ ALERTA: Bayes HAM=$HAM (mínimo 200). Executar train-bayes.sh" >> "$LOG"
fi

echo "---" >> "$LOG"
```

### Configurar cron:
```bash
# Check a cada 5 min (já configurado)
# */5 * * * * /opt/results/infra/scripts/check-antispam.sh >> /var/log/antispam-check.log 2>&1

# Relatório diário às 8h
# 0 8 * * * /opt/results/infra/scripts/anti-spam-daily.sh
```

---

## Tarefa 5 — Troubleshooting rápido

### Comandos de diagnóstico:
```bash
# Status geral anti-spam
/opt/results/infra/scripts/check-antispam.sh

# Bayes
docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat

# Postfix filas e rejeições
docker exec results-mail-postfix postconf smtpd_recipient_restrictions smtpd_helo_restrictions smtpd_sender_restrictions
docker exec results-mail-postfix mailq | tail -20

# Logs recentes (spam/reject)
docker logs results-mail-postfix --tail 100 | grep -iE "reject|block|spam|NOQUEUE"

# Rspamd logs (últimas 50 linhas)
docker logs results-mail-rspamd --tail 50

# Verificar se Rspamd está processando
docker exec results-mail-rspamd rspamc -h 127.0.0.1:11334 stat | grep -E "scanned|reject|greylist"

# Verificar se ClamAV está ativo
docker exec results-mail-clamav nc -z 127.0.0.1 3310 && echo "OK" || echo "DOWN"
```

### Sinais de alerta:
| Sintoma | Causa provável | Ação |
|---|---|---|
| Block rate < 30% | RBLs offline ou Bayes não treinado | Verificar DNS, executar train-bayes.sh |
| BAYES_HAM = 0 | Container Rspamd recriado (Redis volátil) | Executar train-bayes.sh |
| Postfix sem RBL | Container recriado sem template injetado | Executar check-postfix-anti-spam.sh |
| Rspamd offline | Crash ou OOM | `docker restart results-mail-rspamd` |
| ClamAV lento | DB desatualizado | Aguardar freshclam, ou `docker restart results-mail-clamav` |

---

## Tarefa 6 — DKIM

### Chave gerada:
- Local: `/var/lib/rspamd/dkim/results.com.br.dkim.key` (dentro do container Rspamd)
- Config: `/etc/rspamd/local.d/dkim_signing.conf` (montado do host: `/opt/results/infra/mail/rspamd/local.d/dkim_signing.conf`)

### Registro DNS (pendente de publicação):
```
default._domainkey.results.com.br IN TXT "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDUM3ky84ywF7BKxOydWIIUezI686JNUG1hTuEBTrrG5hedaS1clYepLsbEJvK9BBvXPMP5v1wr/dIHbiz6oC6HP+s6zlZ0S8F1C62ZSx6pHfyXJv2h3WKUv0sxWPbRJrtpIeXf1sGKgXwwfyN7tg8rzF4UK1sVeNA2I9vXwBvywIDAQAB"
```

### Publicar no PowerDNS:
```bash
# Via MySQL (PowerDNS usa MariaDB em 10.10.2.99, banco 'results'):
# INSERT INTO records (domain_id, name, type, content, ttl) 
# VALUES (<domain_id>, 'default._domainkey.results.com.br', 'TXT', 
# '"v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDUM3ky84ywF7BKxOydWIIUezI686JNUG1hTuEBTrrG5hedaS1clYepLsbEJvK9BBvXPMP5v1wr/dIHbiz6oC6HP+s6zlZ0S8F1C62ZSx6pHfyXJv2h3WKUv0sxWPbRJrtpIeXf1sGKgXwwfyN7tg8rzF4UK1sVeNA2I9vXwBvywIDAQAB"', 3600);
```

---

## Tarefa 7 — Resiliência (persistência pós-rebuild)

O template `main.cf.template` NÃO persiste no rebuild porque o Docker build cache não detecta a mudança.
Solução: adicionar hook pós-deploy.

### Script de hook (`/opt/results/infra/scripts/post-deploy-mail.sh`):
```bash
#!/bin/bash
# post-deploy-mail.sh — Executar após docker compose up na stack mail
sleep 5
for MX in results-mail-postfix results-mail-postfix-mx2; do
  docker cp /opt/results/infra/mail/postfix/main.cf.template "$MX:/templates/main.cf.template"
  docker exec "$MX" sh -c "envsubst < /templates/main.cf.template > /etc/postfix/main.cf && postfix reload"
  echo "✅ $MX config atualizada"
done
```

---

## Resumo de arquivos criados no servidor

| Arquivo | Função |
|---|---|
| `/opt/results/infra/mail/postfix/main.cf.template` | Template Postfix com RBL/HELO/sender checks |
| `/opt/results/infra/mail/rspamd/local.d/dkim_signing.conf` | Config DKIM signing |
| `/opt/results/infra/scripts/check-antispam.sh` | Check Icinga (rspamc stat → perfdata) |
| `/opt/results/infra/scripts/train-bayes.sh` | Treino do classificador Bayes |
| `/opt/results/infra/scripts/anti-spam-daily.sh` | Relatório diário (criar) |
| `/opt/results/infra/scripts/check-postfix-anti-spam.sh` | Verifica/reaplica config Postfix (criar) |
| `/opt/results/infra/scripts/post-deploy-mail.sh` | Hook pós-deploy (criar) |
| `/var/log/antispam-check.log` | Log do check a cada 5 min |
| Crontab | `*/5 * * * * check-antispam.sh` |

---

## Instruções para o agente

1. **Sempre verificar** o estado atual antes de agir: `check-antispam.sh` + `rspamc stat`
2. **Nunca reiniciar** o Docker daemon (derruba VPN)
3. **Sempre usar** `-p infra-mail` no compose para evitar conflitos de projeto
4. **Após rebuild** dos containers Postfix, executar `post-deploy-mail.sh`
5. **Template persistente**: o arquivo canônico é `/opt/results/infra/mail/postfix/main.cf.template`
6. **Senha SSH**: `resu100gabao` (NUNCA commitar em arquivos)
7. **Redis do Rspamd**: configurado SEM persistência (`--save "" --appendonly no`). Se container Redis for recriado, Bayes volta a 0.
