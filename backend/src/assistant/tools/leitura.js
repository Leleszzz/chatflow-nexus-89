// Ferramentas de LEITURA do assistente: executam na hora e devolvem dado.
//
// Regra de arquitetura, imposta por backend/tests/assistant-escopo.test.js:
// NADA aqui importa de ../../storage/. Todo acesso a dado de paciente passa pelo
// `ctx`, que já filtrou por canUserSeeDeal. É o que impede uma ferramenta nova
// de virar um vazamento silencioso.
//
// Segunda regra, do mesmo teste: toda contagem devolvida é DEPOIS do filtro. Um
// `total` maior que a lista denunciaria a existência de pacientes de outro
// médico sem mostrar nenhum deles.

import { AssistantToolError } from "../erros.js";
import { buscarPacientes } from "../desambiguacao.js";
import { envelopar, limparTexto } from "../sanitize.js";
import { exigirData, exigirId, inteiro, intervaloDeDatas } from "../validacao.js";
import { horariosLivresNoDia, HOUR_SLOTS } from "../../lib/agenda-slots.js";
import { ACOES } from "../../lib/auditoria.js";
import { roleLabel } from "../../lib/roles.js";

// Transcrição crua é cara: uma consulta de uma hora tem ~13k tokens. Entra
// truncada pelo FIM, que é onde ficam conduta e orientações — a mesma escolha
// (e o mesmo motivo) de TRANSCRICAO_MAX_CHARS em whatsapp/agent-service.js.
const TRANSCRICAO_MAX_CHARS = 6000;

const soData = valor => String(valor ?? "").slice(0, 10);
const naoCancelado = a => a.status !== "cancelado";

/** O compromisso como o médico o lê, sem os campos que só servem ao banco. */
function formatarCompromisso(a, mapaDeals) {
  const deal = a.dealId ? mapaDeals.get(a.dealId) : null;
  return {
    agendamento_id: a.id,
    data: a.date,
    inicio: a.startTime,
    fim: a.endTime,
    titulo: limparTexto(a.title, 200),
    paciente: deal ? limparTexto(deal.customer, 120) : "",
    paciente_id: deal ? deal.id : "",
    tipo: a.type,
    status: a.status,
    observacao: limparTexto(a.description, 300),
  };
}

/** Metadados de uma consulta gravada, sem o conteúdo clínico. */
function formatarConsultaResumida(c, mapaDeals) {
  const deal = mapaDeals.get(c.dealId);
  return {
    consulta_id: c.id,
    paciente: deal ? limparTexto(deal.customer, 120) : "",
    paciente_id: c.dealId,
    data: soData(c.recordedAt),
    titulo: limparTexto(c.title, 200),
    duracao_min: Math.round((Number(c.durationSec) || 0) / 60),
    status: c.status,
    tem_resumo: Boolean(c.summary),
    // Pendências que a IA da consulta já tinha levantado e ninguém resolveu.
    pendencias: (c.suggestions || [])
      .filter(s => s.status === "pendente")
      .map(s => ({ tipo: s.tipo, titulo: limparTexto(s.titulo, 200) })),
  };
}

/**
 * O conteúdo clínico de uma consulta, pronto para o prompt.
 *
 * Prefere o resumo estruturado: são quatro campos contra treze mil tokens de
 * transcrição, e é o que o médico quer ouvir de volta. A transcrição crua só
 * entra quando não há resumo.
 */
function formatarConsultaCompleta(c, mapaDeals) {
  const base = formatarConsultaResumida(c, mapaDeals);
  if (c.summary) {
    return {
      ...base,
      resumo: {
        queixa: limparTexto(c.summary.queixa, 2000),
        historico: limparTexto(c.summary.historico, 2000),
        avaliacao: limparTexto(c.summary.avaliacao, 2000),
        conduta: limparTexto(c.summary.conduta, 2000),
      },
      transcricao: "",
    };
  }
  if (!c.transcriptText) return { ...base, resumo: null, transcricao: "" };
  const texto = c.transcriptText.length > TRANSCRICAO_MAX_CHARS
    ? `[trecho inicial omitido]\n${c.transcriptText.slice(-TRANSCRICAO_MAX_CHARS)}`
    : c.transcriptText;
  return {
    ...base,
    resumo: null,
    // Envelopado: é fala de paciente, e fala de paciente é conteúdo, nunca
    // instrução. Ver assistant/sanitize.js.
    transcricao: envelopar("transcricao_consulta", texto, TRANSCRICAO_MAX_CHARS + 200),
  };
}

/** Mapas de data usados pelas pistas de desambiguação. */
async function mapasDePista(ctx) {
  const [consultas, compromissos] = await Promise.all([ctx.consultasVisiveis(), ctx.appointments()]);
  const ultima = new Map();
  for (const c of consultas) {
    const data = soData(c.recordedAt);
    if (!data) continue;
    if (!ultima.has(c.dealId) || data > ultima.get(c.dealId)) ultima.set(c.dealId, data);
  }
  const proxima = new Map();
  for (const a of compromissos) {
    if (!a.dealId || !naoCancelado(a) || a.date < ctx.hojeKey) continue;
    if (!proxima.has(a.dealId) || a.date < proxima.get(a.dealId)) proxima.set(a.dealId, a.date);
  }
  return { ultima, proxima };
}

export const LEITURA = {
  buscar_paciente: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Encontra o paciente pelo nome (ou por parte do telefone) e devolve o paciente_id. "
      + "CHAME SEMPRE esta ferramenta antes de qualquer outra que peça paciente_id — nunca invente um id. "
      + "Se voltar mais de um candidato, PARE, não escolha nenhum, e pergunte ao médico qual é, citando a pista de cada um.",
    parameters: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome ou parte do nome, como o médico falou" },
        telefone: { type: "string", description: "Parte do telefone, quando o médico disser o número" },
      },
      required: ["nome"],
    },
    normalize(args) {
      const nome = String(args?.nome ?? "").trim() || String(args?.telefone ?? "").trim();
      if (!nome) throw new AssistantToolError("informe o nome do paciente", "PARAMETRO_FALTANDO");
      return { nome };
    },
    async run({ nome }, ctx) {
      const [deals, { ultima, proxima }] = await Promise.all([ctx.deals(), mapasDePista(ctx)]);
      return buscarPacientes(nome, {
        deals,
        ultimaConsultaPorDeal: ultima,
        proximaConsultaPorDeal: proxima,
        hojeKey: ctx.hojeKey,
        fuso: ctx.fuso,
      });
    },
    resumo: ({ nome }, r) => `buscou "${nome}" — ${r?.total || 0} paciente(s)`,
  },

  agenda_do_dia: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Compromissos de um dia. Use para 'quais consultas tenho hoje'. "
      + "Resolva 'hoje', 'amanhã' ou o dia da semana para AAAA-MM-DD antes de chamar.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "string", description: "AAAA-MM-DD" },
        apenas_meus: {
          type: "boolean",
          description: "true (padrão) traz só os compromissos do próprio médico logado",
        },
      },
      required: ["data"],
    },
    normalize(args) {
      return { data: exigirData(args?.data, "data"), apenasMeus: args?.apenas_meus !== false };
    },
    async run({ data, apenasMeus }, ctx) {
      const [compromissos, mapa] = await Promise.all([ctx.appointments(), ctx.dealsById()]);
      const doDia = compromissos
        .filter(a => a.date === data)
        .filter(a => !apenasMeus || !a.sellerId || a.sellerId === ctx.user.id)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return {
        data,
        total: doDia.length,
        compromissos: doDia.map(a => formatarCompromisso(a, mapa)),
      };
    },
    resumo: ({ data }, r) => `agenda de ${data}: ${r?.total || 0} compromisso(s)`,
  },

  agenda_do_periodo: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Compromissos entre duas datas, para 'minha semana' ou 'semana que vem'. Máximo de 31 dias.",
    parameters: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "AAAA-MM-DD" },
        fim: { type: "string", description: "AAAA-MM-DD" },
        apenas_meus: { type: "boolean" },
      },
      required: ["inicio", "fim"],
    },
    normalize(args) {
      const { inicio, fim } = intervaloDeDatas(args?.inicio, args?.fim);
      return { inicio, fim, apenasMeus: args?.apenas_meus !== false };
    },
    async run({ inicio, fim, apenasMeus }, ctx) {
      const [compromissos, mapa] = await Promise.all([ctx.appointments(), ctx.dealsById()]);
      const noPeriodo = compromissos
        .filter(a => a.date >= inicio && a.date <= fim)
        .filter(a => !apenasMeus || !a.sellerId || a.sellerId === ctx.user.id)
        .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
      return {
        inicio,
        fim,
        total: noPeriodo.length,
        compromissos: noPeriodo.map(a => formatarCompromisso(a, mapa)),
      };
    },
    resumo: ({ inicio, fim }, r) => `agenda de ${inicio} a ${fim}: ${r?.total || 0}`,
  },

  horarios_livres: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Horários livres do médico num intervalo de datas, dia a dia. "
      + `A faixa de atendimento é das ${HOUR_SLOTS[0]}h às ${HOUR_SLOTS[HOUR_SLOTS.length - 1]}h.`,
    parameters: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "AAAA-MM-DD" },
        fim: { type: "string", description: "AAAA-MM-DD" },
        duracao_min: { type: "integer", description: "Duração desejada em minutos (padrão 60)" },
      },
      required: ["inicio", "fim"],
    },
    normalize(args) {
      const { inicio, fim } = intervaloDeDatas(args?.inicio, args?.fim, { maxDias: 31 });
      return { inicio, fim, duracao: inteiro(args?.duracao_min, { padrao: 60, min: 15, max: 480 }) };
    },
    async run({ inicio, fim, duracao }, ctx) {
      const compromissos = await ctx.appointments();
      const dias = [];
      for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
        const livres = horariosLivresNoDia(d, compromissos, ctx.user.id, duracao);
        // Dia sem nada livre entra na lista assim mesmo: "quarta está cheia" é
        // resposta útil, e omitir o dia faria o médico achar que não perguntou.
        dias.push({ data: d, livres: livres.map(h => `${String(h).padStart(2, "0")}:00`) });
      }
      return { inicio, fim, duracao_min: duracao, dias };
    },
    resumo: ({ inicio, fim }, r) =>
      `horários livres de ${inicio} a ${fim}: ${(r?.dias || []).reduce((n, d) => n + d.livres.length, 0)} vaga(s)`,
  },

  consultas_do_paciente: {
    tipo: "leitura",
    exigeAcessoClinico: true,
    descricao:
      "Lista as consultas GRAVADAS de um paciente (data, duração, se tem resumo). "
      + "Não traz o conteúdo — para isso use ler_consulta com o consulta_id.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        limite: { type: "integer", description: "Quantas consultas, da mais recente para trás (padrão 5)" },
      },
      required: ["paciente_id"],
    },
    normalize(args) {
      return {
        pacienteId: exigirId(args?.paciente_id, "paciente_id"),
        limite: inteiro(args?.limite, { padrao: 5, min: 1, max: 20 }),
      };
    },
    async run({ pacienteId, limite }, ctx) {
      const [consultas, mapa] = await Promise.all([
        ctx.consultasDoPaciente(pacienteId), ctx.dealsById(),
      ]);
      const recortadas = consultas.slice(0, limite);
      return {
        paciente_id: pacienteId,
        total: consultas.length,
        consultas: recortadas.map(c => formatarConsultaResumida(c, mapa)),
      };
    },
    resumo: (a, r) => `${r?.total || 0} consulta(s) do paciente`,
  },

  ler_consulta: {
    tipo: "leitura",
    exigeAcessoClinico: true,
    descricao:
      "Lê o conteúdo clínico de uma consulta gravada: o resumo (queixa, histórico, avaliação, conduta) "
      + "ou, quando não há resumo, o trecho final da transcrição. "
      + "É a ferramenta para 'o que o paciente disse que sentia'.",
    parameters: {
      type: "object",
      properties: { consulta_id: { type: "string" } },
      required: ["consulta_id"],
    },
    normalize(args) {
      return { consultaId: exigirId(args?.consulta_id, "consulta_id") };
    },
    async run({ consultaId }, ctx) {
      const consulta = await ctx.consulta(consultaId);
      if (consulta.status !== "pronto") {
        throw new AssistantToolError(
          `esta consulta ainda está em "${consulta.status}" — não há transcrição para ler`,
          "CONSULTA_NAO_PRONTA",
        );
      }
      const mapa = await ctx.dealsById();
      // Leitura de dado clínico é evento de auditoria, venha de onde vier.
      ctx.auditar(ACOES.LER_CONSULTA, { consultaId: consulta.id, dealId: consulta.dealId });
      return formatarConsultaCompleta(consulta, mapa);
    },
    resumo: (a, r) => `leu a consulta de ${r?.data || "?"}${r?.resumo ? " (resumo)" : " (transcrição)"}`,
  },

  consultas_gravadas_no_dia: {
    tipo: "leitura",
    exigeAcessoClinico: true,
    descricao:
      "Todas as consultas gravadas num dia, já com o resumo clínico e as pendências de cada uma. "
      + "Use para 'analise minhas consultas de hoje e me diga o que ficou para eu fazer'.",
    parameters: {
      type: "object",
      properties: { data: { type: "string", description: "AAAA-MM-DD" } },
      required: ["data"],
    },
    normalize(args) {
      return { data: exigirData(args?.data, "data") };
    },
    async run({ data }, ctx) {
      const [consultas, mapa] = await Promise.all([ctx.consultasVisiveis(), ctx.dealsById()]);
      const doDia = consultas
        .filter(c => soData(c.recordedAt) === data && c.status === "pronto")
        .sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)));
      if (doDia.length) {
        ctx.auditar(ACOES.LER_CONSULTA, { data, quantidade: doDia.length });
      }
      return {
        data,
        total: doDia.length,
        consultas: doDia.map(c => formatarConsultaCompleta(c, mapa)),
      };
    },
    resumo: ({ data }, r) => `${r?.total || 0} consulta(s) gravada(s) em ${data}`,
  },

  mensagens_do_paciente: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Últimas mensagens trocadas com o paciente no WhatsApp, em ordem cronológica. "
      + "Serve para saber o que já foi combinado por mensagem.",
    parameters: {
      type: "object",
      properties: {
        paciente_id: { type: "string" },
        limite: { type: "integer", description: "Quantas mensagens (padrão 20, máximo 50)" },
      },
      required: ["paciente_id"],
    },
    normalize(args) {
      return {
        pacienteId: exigirId(args?.paciente_id, "paciente_id"),
        limite: inteiro(args?.limite, { padrao: 20, min: 1, max: 50 }),
      };
    },
    async run({ pacienteId, limite }, ctx) {
      const { conversa, mensagens } = await ctx.mensagensDoPaciente(pacienteId, { limit: limite });
      if (!conversa) {
        return { paciente_id: pacienteId, tem_conversa: false, total: 0, mensagens: [] };
      }
      ctx.auditar(ACOES.CONSULTAR_LEAD, { dealId: pacienteId, conversationId: conversa.id });
      return {
        paciente_id: pacienteId,
        tem_conversa: true,
        total: mensagens.length,
        mensagens: mensagens.map(m => ({
          de: m.fromMe ? "clinica" : "paciente",
          // timestamp de messages é epoch em SEGUNDOS — o resto do sistema usa
          // ISO, e passar o número cru para o modelo produziria data de 1970.
          quando: new Date((Number(m.timestamp) || 0) * 1000).toISOString(),
          // Texto escrito pelo paciente: envelopado, é conteúdo e não instrução.
          texto: m.body ? envelopar("mensagem_paciente", m.body, 1200) : `[${m.type}]`,
        })),
      };
    },
    resumo: (a, r) => (r?.tem_conversa ? `leu ${r.total} mensagem(ns)` : "paciente sem conversa no WhatsApp"),
  },

  anexos_do_paciente: {
    tipo: "leitura",
    exigeAcessoClinico: true,
    descricao:
      "Lista os anexos do prontuário do paciente (nome, categoria, data). "
      + "Não lê o conteúdo dos arquivos — só diz o que existe.",
    parameters: {
      type: "object",
      properties: { paciente_id: { type: "string" } },
      required: ["paciente_id"],
    },
    normalize(args) {
      return { pacienteId: exigirId(args?.paciente_id, "paciente_id") };
    },
    async run({ pacienteId }, ctx) {
      const anexos = await ctx.anexosDoPaciente(pacienteId);
      ctx.auditar(ACOES.LER_PRONTUARIO, { dealId: pacienteId, quantidade: anexos.length });
      return {
        paciente_id: pacienteId,
        total: anexos.length,
        anexos: anexos.map(p => ({
          nome: limparTexto(p.name, 200),
          categoria: p.category,
          data: soData(p.uploadedAt),
          origem: p.source,
        })),
      };
    },
    resumo: (a, r) => `${r?.total || 0} anexo(s) no prontuário`,
  },

  tarefas: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Tarefas da secretaria, filtradas por situação, responsável ou paciente. "
      + "Use para saber o que já foi delegado antes de propor uma tarefa nova.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["aberta", "concluida", "cancelada"] },
        paciente_id: { type: "string" },
        responsavel_id: { type: "string" },
      },
    },
    normalize(args) {
      return {
        status: ["aberta", "concluida", "cancelada"].includes(args?.status) ? args.status : undefined,
        pacienteId: String(args?.paciente_id ?? "").trim() || undefined,
        responsavelId: String(args?.responsavel_id ?? "").trim() || undefined,
      };
    },
    async run({ status, pacienteId, responsavelId }, ctx) {
      const [lista, mapa, equipe] = await Promise.all([
        ctx.tarefas({ status, dealId: pacienteId, assigneeId: responsavelId }),
        ctx.dealsById(),
        ctx.usuarios(),
      ]);
      const nomePorId = new Map(equipe.map(u => [u.id, u.name]));
      return {
        total: lista.length,
        tarefas: lista.slice(0, 40).map(t => ({
          tarefa_id: t.id,
          titulo: limparTexto(t.titulo, 200),
          status: t.status,
          prazo: t.prazo,
          responsavel: nomePorId.get(t.assigneeId) || (t.assigneeId ? "" : "fila geral"),
          paciente: t.dealId ? limparTexto(mapa.get(t.dealId)?.customer || "", 120) : "",
          paciente_id: t.dealId,
          itens: t.itens.map(i => ({ texto: limparTexto(i.texto, 200), feito: i.feito })),
        })),
      };
    },
    resumo: (a, r) => `${r?.total || 0} tarefa(s)`,
  },

  listar_equipe: {
    tipo: "leitura",
    exigeAcessoClinico: false,
    descricao:
      "Funcionários ativos da clínica, com id, nome e cargo. "
      + "Chame antes de propor uma tarefa para alguém específico ou uma mensagem no chat interno.",
    parameters: { type: "object", properties: {} },
    normalize() {
      return {};
    },
    async run(_args, ctx) {
      const equipe = await ctx.usuarios();
      // Projeção mínima de propósito: listUsers() devolve email, telefone e as
      // listas de permissão, e nada disso tem por que entrar num prompt.
      return {
        total: equipe.length,
        pessoas: equipe.map(u => ({
          usuario_id: u.id,
          nome: limparTexto(u.name, 120),
          cargo: roleLabel(u.role),
        })),
      };
    },
    resumo: (a, r) => `${r?.total || 0} pessoa(s) na equipe`,
  },

  dossie_do_paciente: {
    tipo: "leitura",
    exigeAcessoClinico: true,
    descricao:
      "Resumo consolidado de um paciente: cadastro, consultas gravadas com resumo, anexos do prontuário, "
      + "agendamentos futuros, tarefas abertas e as últimas mensagens. "
      + "Use para 'me monta um resumo do caso do fulano' — evita chamar cinco ferramentas separadas.",
    parameters: {
      type: "object",
      properties: { paciente_id: { type: "string" } },
      required: ["paciente_id"],
    },
    normalize(args) {
      return { pacienteId: exigirId(args?.paciente_id, "paciente_id") };
    },
    async run({ pacienteId }, ctx) {
      const deal = await ctx.assertDeal(pacienteId);
      const [consultas, anexos, compromissos, tarefas, conversa, mapa] = await Promise.all([
        ctx.consultasDoPaciente(pacienteId),
        ctx.anexosDoPaciente(pacienteId),
        ctx.appointments(),
        ctx.tarefas({ dealId: pacienteId, status: "aberta" }),
        ctx.mensagensDoPaciente(pacienteId, { limit: 10 }),
        ctx.dealsById(),
      ]);
      ctx.auditar(ACOES.LER_PRONTUARIO, { dealId: pacienteId, origem: "dossie" });

      const prontas = consultas.filter(c => c.status === "pronto").slice(0, 3);
      const futuros = compromissos
        .filter(a => a.dealId === pacienteId && a.date >= ctx.hojeKey && naoCancelado(a))
        .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

      return {
        paciente: {
          paciente_id: deal.id,
          nome: limparTexto(deal.customer, 120),
          telefone_final: String(deal.phone || "").replace(/\D/g, "").slice(-4),
          etapa: deal.stage,
          tags: deal.tags || [],
          observacoes: deal.notes ? envelopar("observacoes_cadastro", deal.notes, 1000) : "",
        },
        // As três últimas com resumo: mais que isso vira transcrição demais no
        // prompt para uma pergunta que pede visão geral.
        consultas: prontas.map(c => formatarConsultaCompleta(c, mapa)),
        total_consultas: consultas.length,
        anexos: anexos.slice(0, 20).map(p => ({
          nome: limparTexto(p.name, 200), categoria: p.category, data: soData(p.uploadedAt),
        })),
        agendamentos_futuros: futuros.map(a => formatarCompromisso(a, mapa)),
        tarefas_abertas: tarefas.map(t => ({ tarefa_id: t.id, titulo: limparTexto(t.titulo, 200), prazo: t.prazo })),
        ultimas_mensagens: conversa.conversa
          ? conversa.mensagens.map(m => ({
            de: m.fromMe ? "clinica" : "paciente",
            quando: new Date((Number(m.timestamp) || 0) * 1000).toISOString(),
            texto: m.body ? envelopar("mensagem_paciente", m.body, 600) : `[${m.type}]`,
          }))
          : [],
      };
    },
    resumo: (a, r) => `montou o dossiê de ${r?.paciente?.nome || "paciente"}`,
  },
};
