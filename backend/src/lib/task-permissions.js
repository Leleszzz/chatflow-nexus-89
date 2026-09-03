// Quem vê e quem mexe numa tarefa da recepção. Saiu de routes/tasks.js quando o
// assistente do médico passou a listar tarefas: duas cópias da mesma regra é
// como uma delas fica para trás.
//
// As duas funções são PURAS — recebem o card já carregado em vez de irem ao
// banco. A rota carrega com getDeal(); o assistente já tem o card no contexto,
// filtrado por canUserSeeDeal. Isso também é o que as torna testáveis.

import { seesAllDeals } from "./roles.js";
import { canUserSeeDeal } from "./deal-permissions.js";

/**
 * Quem enxerga esta tarefa.
 *
 * Admin e secretária veem tudo (é a fila de trabalho delas, e `seesAllDeals` já
 * diz isso do cargo). O doutor vê a que ele criou, a que é dele, e a dos
 * pacientes que ele atende — assim ele acompanha se a cobrança que pediu saiu,
 * sem enxergar a agenda administrativa inteira.
 *
 * `deal` é o card de `task.dealId`, ou null quando a tarefa é solta / o card não
 * existe mais. Tarefa órfã de card só aparece para quem a criou ou executa.
 */
export function podeVerTarefa(user, task, deal = null) {
  if (seesAllDeals(user)) return true;
  if (task?.assigneeId && task.assigneeId === user?.id) return true;
  if (task?.criadoPor && task.criadoPor === user?.id) return true;
  if (!task?.dealId) return false;
  return Boolean(deal) && canUserSeeDeal(user, deal);
}

/**
 * Pode mexer nesta tarefa?
 *
 * A recepção trabalha em fila compartilhada — uma secretária cobre a outra na
 * folga e no almoço, e travar cada tarefa na dona faria a fila parar sozinha.
 * Admin e secretária mexem em tudo; o doutor, no que é dele ou no que ele mesmo
 * delegou. Repare que ver o card do paciente NÃO dá direito de escrita: o
 * doutor acompanha a cobrança que outro pediu, mas não a fecha por ele.
 */
export function podeEscreverTarefa(user, task) {
  if (seesAllDeals(user)) return true;
  if (task?.assigneeId && task.assigneeId === user?.id) return true;
  if (task?.criadoPor && task.criadoPor === user?.id) return true;
  return false;
}
