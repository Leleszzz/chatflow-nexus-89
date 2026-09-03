import { getCol, collections } from "../storage/mongo.js";

/**
 * Trilha de auditoria.
 *
 * Não havia registro nenhum de quem leu prontuário, quem exportou base de
 * contatos ou quem disparou campanha. Para dado de saúde isso não é um extra:
 * sem trilha, um vazamento é indetectável e não há como responder "quem viu o
 * quê" depois do incidente.
 *
 * Grava sempre em melhor esforço: auditoria que derruba a requisição principal
 * seria pior que a ausência dela.
 */
export const ACOES = {
  LER_PRONTUARIO: "ler_prontuario",
  LER_CONSULTA: "ler_consulta",
  EXPORTAR_PUBLICO: "exportar_publico",
  DISPARAR_CAMPANHA: "disparar_campanha",
  CONSULTAR_LEAD: "consultar_lead",
  ALTERAR_USUARIO: "alterar_usuario",
  ALTERAR_CHAVE_API: "alterar_chave_api",
  PAREAR_INSTANCIA: "parear_instancia",
  // O assistente do medico executa acao em nome dele. Sem esta linha, a
  // mensagem que ele confirmou sai indistinguivel de uma que ele digitou, e
  // "quem mandou isso para o paciente?" fica sem resposta.
  EXECUTAR_ACAO_IA: "executar_acao_ia",
};

export async function registrar(req, acao, detalhe = {}) {
  try {
    await getCol(collections.auditoria).insertOne({
      acao,
      usuarioId: req?.user?.id || null,
      usuarioCargo: req?.user?.role || null,
      ip: req?.ip || null,
      rota: req?.originalUrl || null,
      metodo: req?.method || null,
      detalhe,
      em: new Date(),
    });
  } catch (err) {
    console.warn(`[auditoria] falha ao registrar ${acao}: ${err.message}`);
  }
}

/** Versão que não espera — para não somar latência à requisição do usuário. */
export function registrarAsync(req, acao, detalhe = {}) {
  registrar(req, acao, detalhe).catch(() => {});
}
