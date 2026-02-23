#!/usr/bin/env bash
set -euo pipefail

# adb-wifi.sh — ADB via Wi-Fi com perfis + fallback automático + integração Expo
# Perfis em: ~/.config/adb-wifi/profiles.env
#
# Uso:
#   ./scripts/adb-wifi.sh list
#   ./scripts/adb-wifi.sh usb <perfil> [porta]
#   ./scripts/adb-wifi.sh connect <perfil>
#   ./scripts/adb-wifi.sh disconnect <perfil>
#   ./scripts/adb-wifi.sh ip <perfil>
#   ./scripts/adb-wifi.sh expo <perfil>
#
# Exemplos:
#   ./scripts/adb-wifi.sh usb ragent2
#   ./scripts/adb-wifi.sh connect ragent2
#   ./scripts/adb-wifi.sh expo ragent2

GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"; NC="\033[0m"
info(){ echo -e "${YELLOW}>>${NC} $*"; }
ok(){ echo -e "${GREEN}OK:${NC} $*"; }
die(){ echo -e "${RED}Erro:${NC} $*" >&2; exit 1; }

need(){ command -v "$1" >/dev/null 2>&1 || die "Comando '$1' não encontrado"; }

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/adb-wifi"
PROFILES="$CONFIG_DIR/profiles.env"
mkdir -p "$CONFIG_DIR"; touch "$PROFILES"

restart_adb(){
  info "Reiniciando ADB..."
  adb kill-server >/dev/null 2>&1 || true
  adb start-server >/dev/null
}

devices(){
  echo
  adb devices -l || true
  echo
}

# -------- perfis --------

profile_set(){
  local name="$1" ip="$2" port="$3"
  local key="${name^^}"
  # remove linhas antigas do perfil
  if [[ -f "$PROFILES" ]]; then
    sed -i "/^${key}_/d" "$PROFILES" 2>/dev/null || true
  fi
  {
    echo "${key}_IP=${ip}"
    echo "${key}_PORT=${port}"
  } >> "$PROFILES"
}

profile_get(){
  local name="$1" key="${name^^}"
  # shellcheck disable=SC1090
  source "$PROFILES" 2>/dev/null || true
  local ip_var="${key}_IP"
  local port_var="${key}_PORT"
  [[ -n "${!ip_var:-}" && -n "${!port_var:-}" ]] || return 1
  echo "${!ip_var} ${!port_var}"
}

profile_list(){
  echo
  info "Perfis em $PROFILES"
  [[ -s "$PROFILES" ]] && cat "$PROFILES" || echo "(nenhum perfil salvo)"
  echo
}

# -------- util --------

ensure_usb(){
  local st
  st="$(adb devices | tail -n +2 | awk '{print $2}' | head -n1 || true)"
  [[ "$st" == "device" ]] || die "Nenhum device USB autorizado. Conecte no USB e aceite a depuração."
}

get_ip_usb(){
  # 1) via route src (bem confiável)
  local ip
  ip="$(adb shell 'ip route get 1.1.1.1 2>/dev/null | sed -n "s/.* src \([0-9.]*\).*/\1/p"' \
    | tr -d '\r' | head -n 1 || true)"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return 0
  fi
  # 2) fallback
  ip="$(adb shell 'getprop dhcp.wlan0.ipaddress' | tr -d '\r' | head -n 1 || true)"
  [[ -n "$ip" ]] && echo "$ip"
}

port_open(){
  timeout 0.25 bash -c "cat < /dev/null > /dev/tcp/$1/$2" >/dev/null 2>&1
}

adb_connect_checked(){
  # imprime a saída do adb connect e retorna 0 somente se conectou (ou já estava conectado)
  local out
  out="$(adb connect "$1:$2" 2>&1 || true)"
  echo "$out"
  echo "$out" | grep -Eqi "connected to|already connected"
}

find_port(){
  local ip="$1"

  # portas comuns (rápidas)
  local ports=(5555 37099 37100 37101 37102 37103 37200 37300 37400 37500 37600 37700 37800 37900)
  for p in "${ports[@]}"; do
    port_open "$ip" "$p" && { echo "$p"; return 0; }
  done

  # scan rápido em range (ajustado)
  for ((p=37000;p<=47999;p++)); do
    port_open "$ip" "$p" && { echo "$p"; return 0; }
  done

  return 1
}

# -------- comandos --------

cmd_usb(){
  local profile="$1"
  local port="${2:-5555}"

  info "Modo USB → Wi-Fi (auto-retry + scan)"

  ensure_usb

  local ip
  ip="$(get_ip_usb || true)"
  [[ -n "${ip:-}" ]] || die "Não consegui detectar o IP do celular via USB"
  ok "IP detectado: $ip"

  # tenta 2 vezes rearmar tcpip e conectar na porta pedida
  for attempt in 1 2; do
    info "Ativando adb tcpip $port (tentativa $attempt)..."
    adb tcpip "$port" >/dev/null 2>&1 || true
    sleep 0.5
    info "Tentando conectar em $ip:$port..."
    if adb_connect_checked "$ip" "$port"; then
      ok "Conectado em $ip:$port"
      profile_set "$profile" "$ip" "$port"
      devices
      return 0
    fi
  done

  info "Porta $port falhou. Procurando porta ADB automaticamente..."
  local found
  found="$(find_port "$ip")" || die "Não encontrei nenhuma porta ADB aberta no IP $ip. (Ative Depuração sem fio / verifique rede.)"

  ok "Porta encontrada: $found"
  info "Conectando em $ip:$found..."
  adb_connect_checked "$ip" "$found" || die "Falha ao conectar na porta encontrada ($found)"

  profile_set "$profile" "$ip" "$found"
  ok "Conectado via Wi-Fi"
  devices
}

cmd_connect(){
  local profile="$1"
  local vals
  vals="$(profile_get "$profile")" || die "Perfil '$profile' não encontrado. Use: ./scripts/adb-wifi.sh usb $profile"
  local ip port
  ip="$(echo "$vals" | awk '{print $1}')"
  port="$(echo "$vals" | awk '{print $2}')"

  info "Conectando $profile ($ip:$port)..."
  adb_connect_checked "$ip" "$port" || die "Falha ao conectar. Se o IP mudou, rode: ./scripts/adb-wifi.sh usb $profile"
  ok "Conectado"
  devices
}

cmd_disconnect(){
  local profile="$1"
  local vals
  vals="$(profile_get "$profile")" || die "Perfil '$profile' não encontrado"
  local ip port
  ip="$(echo "$vals" | awk '{print $1}')"
  port="$(echo "$vals" | awk '{print $2}')"

  info "Desconectando $profile ($ip:$port)..."
  adb disconnect "$ip:$port" >/dev/null 2>&1 || true
  ok "Desconectado"
  devices
}

cmd_ip(){
  local profile="$1"
  ensure_usb
  local ip
  ip="$(get_ip_usb || true)"
  [[ -n "${ip:-}" ]] || die "Não consegui detectar o IP via USB"
  ok "IP atual do celular (Wi-Fi): $ip"

  # se já existir perfil, mostra também
  if vals="$(profile_get "$profile" 2>/dev/null || true)"; then
    local pip pport
    pip="$(echo "$vals" | awk '{print $1}')"
    pport="$(echo "$vals" | awk '{print $2}')"
    info "Perfil '$profile' salvo: $pip:$pport"
  else
    info "Perfil '$profile' ainda não existe. Use: ./scripts/adb-wifi.sh usb $profile"
  fi
}

cmd_expo(){
  local profile="$1"
  need npx

  # tenta conectar usando o perfil; se falhar, manda rodar usb (sem tentar adivinhar)
  if vals="$(profile_get "$profile" 2>/dev/null || true)"; then
    local ip port
    ip="$(echo "$vals" | awk '{print $1}')"
    port="$(echo "$vals" | awk '{print $2}')"
    info "Conectando via perfil $profile ($ip:$port)..."
    if ! adb_connect_checked "$ip" "$port"; then
      info "Falhou via perfil. Se o IP mudou ou a porta fechou, rode: ./scripts/adb-wifi.sh usb $profile"
    else
      ok "ADB Wi-Fi OK."
    fi
  else
    info "Perfil '$profile' não encontrado. Rode primeiro: ./scripts/adb-wifi.sh usb $profile"
  fi

  info "Iniciando Expo dev-client..."
  # Executa no diretório atual do projeto
  npx expo start --dev-client
}

usage(){
  cat <<EOF
Uso:
  $0 list
  $0 usb <perfil> [porta]
  $0 connect <perfil>
  $0 disconnect <perfil>
  $0 ip <perfil>
  $0 expo <perfil>

Ex:
  $0 usb ragent2
  $0 connect ragent2
  $0 expo ragent2
EOF
}

# -------- main --------

need adb
need timeout
restart_adb

case "${1:-}" in
  list) profile_list ;;
  usb) [[ $# -ge 2 ]] || usage; cmd_usb "$2" "${3:-5555}" ;;
  connect) [[ $# -ge 2 ]] || usage; cmd_connect "$2" ;;
  disconnect) [[ $# -ge 2 ]] || usage; cmd_disconnect "$2" ;;
  ip) [[ $# -ge 2 ]] || usage; cmd_ip "$2" ;;
  expo) [[ $# -ge 2 ]] || usage; cmd_expo "$2" ;;
  *) usage ;;
esac