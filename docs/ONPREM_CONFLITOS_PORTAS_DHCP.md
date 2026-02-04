# On‑prem: como evitar conflitos (portas e DHCP)

Este guia é para instalação on‑prem do stack, em ambientes onde o cliente já tem serviços rodando (PBX, DHCP, HTTP, VPN etc.).

## Conflitos de portas (host)

### Sintomas comuns
- `bind: address already in use`
- API/UI sobe, mas SIP/RTP não registra
- outro serviço do cliente “cai” após instalar o stack

### Boas práticas
- **Expor o mínimo possível no host**: preferir que quase tudo fique apenas na rede Docker.
- **Reverse proxy único** (Nginx/Traefik) no host para UI/API/Provisioning, evitando múltiplas portas públicas.
- **Parametrizar portas por `.env`** (principalmente: HTTP/HTTPS, SIP e AMI).

Checklist rápido:
- HTTP: 80/443 (ou portas alternativas se já ocupadas)
- SIP: 5060/udp (ou alternativa via `SIP_UDP_PORT`)
- RTP: range UDP dedicado (evitar overlap com outro PBX)
- AMI: 5038/tcp (se for expor, prefira rede interna/VPN)

## Conflitos de DHCP (option 66/160/242)

### Problema
Se o cliente já usa DHCP options para outro provisioner, aplicar uma opção “global” pode quebrar telefones existentes.

### Estratégia recomendada
- **Escopo/VLAN dedicado para telefones** (ideal).
- Se não for possível:
  - Regras DHCP condicionais por **Vendor Class Identifier** (cada fabricante recebe seu provisioning).
  - Não sobrescrever opções para classes que não são do seu parque.

### Como coexistir com 2 provisioners
- Manter o provisioner legado atendendo os telefones existentes.
- Configurar o DHCP para enviar o provisioner novo **apenas** para:
  - Grandstream (classe/vendor específica)
  - Avaya (classe/vendor específica)

## Provisioning e segurança

Mesmo on‑prem, evite endpoint público sem controle:
- Defina `PROVISIONING_PUBLIC_TOKEN` e use URLs com token.
- Restrinja acesso por rede (VLAN de telefones) e/ou reverse proxy com ACL.

