/**
 * Rótulo curto, estável e legível para exibir no UI sem truncar prefixo do id.
 * Evita colisões como "default-1771" para tickets diferentes.
 *
 * Exemplos:
 *  - "default-1771468179769-ew8fa94" -> "default-ew8fa94"
 *  - "default-1771387832474-pyq7qtz" -> "default-pyq7qtz"
 */
export function getTicketShortLabel(ticket) {
  const id = ticket?.id || "";
  if (!id) return "";
  const parts = id.split("-");
  const queue = parts[0] || "";
  const suffix = parts[2] || parts[parts.length - 1] || "";
  if (queue && suffix) return `${queue}-${suffix}`;
  return id.length > 8 ? id.slice(-8) : id;
}
