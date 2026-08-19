/**
 * Chave de comparação entre telefones. Os últimos 8 dígitos ignoram DDI, DDD e
 * o nono dígito — que aparecem de jeitos diferentes no número que o WhatsApp
 * devolve e no que foi digitado no cadastro do lead. Menos de 8 dígitos não é
 * telefone o bastante para casar nada, e devolve chave vazia.
 */
export const phoneKey = (value: string) => {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
};
