// Achar o paciente pelo nome que o médico falou — e, principalmente, saber
// quando NÃO dá para escolher sozinho.
//
// O pedido foi explícito: dois Matheus na base, o assistente pergunta qual, com
// uma pista de cada ("veio na quarta" / "veio mês passado"). Chutar o mais
// recente é o comportamento que parece esperto e erra calado — e aqui um erro
// desses manda mensagem para o paciente errado.
//
// Pura: recebe as listas já filtradas por permissão (quem filtra é
// assistant/contexto.js) e não toca em banco nem relógio, salvo o `agora` que
// vem por parâmetro.

/** Tira acento e caixa: "Júlio" e "julio" têm de casar. */
export function normalizarNome(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const digitos = valor => String(valor ?? "").replace(/\D/g, "");

/**
 * O quanto um nome casa com o termo buscado. Zero é "não casa".
 *
 * A escala existe para ordenar candidatos, não para escolher: dois nomes com a
 * mesma pontuação continuam sendo dois candidatos. É de propósito que "Matheus"
 * pontue igual em "Matheus Soares" e "Matheus Leles".
 */
export function pontuacaoDoNome(nome, termo) {
  const alvo = normalizarNome(nome);
  const busca = normalizarNome(termo);
  if (!alvo || !busca) return 0;
  if (alvo === busca) return 100;

  const tokensAlvo = alvo.split(" ");
  const tokensBusca = busca.split(" ");

  // Todo token buscado precisa aparecer como início de alguma palavra do nome.
  // "leles matheus" acha "Matheus Leles"; "mat" acha "Matheus"; "teus" não —
  // casar no meio da palavra produziria candidato que o médico não reconhece.
  const todosBatem = tokensBusca.every(tb => tokensAlvo.some(ta => ta.startsWith(tb)));
  if (!todosBatem) return 0;

  if (alvo.startsWith(busca)) return 80;
  if (tokensBusca.length > 1) return 70;
  // Casou só o primeiro nome: é justamente o caso que costuma dar empate.
  return 60;
}

const soData = valor => String(valor ?? "").slice(0, 10);

function diffEmDias(dataKey, hojeKey) {
  const a = Date.parse(`${dataKey}T12:00:00Z`);
  const b = Date.parse(`${hojeKey}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

const formatarBR = dataKey => {
  const [ano, mes, dia] = String(dataKey).split("-");
  return dia && mes ? `${dia}/${mes}` : String(dataKey);
};

/**
 * Como o médico se refere a uma data quando fala.
 *
 * "veio na quarta" só vale dentro da semana; passou disso, o dia da semana não
 * ajuda ninguém a lembrar. O número entre parênteses fica sempre, porque é o que
 * desempata de verdade.
 */
export function descreverQuando(dataKey, hojeKey, fuso = "America/Sao_Paulo") {
  const dias = diffEmDias(dataKey, hojeKey);
  if (dias === null) return "";
  if (dias === 0) return "veio hoje";
  if (dias === 1) return "veio ontem";
  if (dias < 0) return `agendado para ${formatarBR(dataKey)}`;
  if (dias <= 6) {
    // "quarta-feira" é como se escreve; "quarta" é como o médico fala, e a
    // pista existe para ele reconhecer o paciente de ouvido.
    const diaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "long" })
      .format(new Date(`${dataKey}T12:00:00Z`))
      .replace(/-feira$/, "");
    return `veio na ${diaSemana} (${formatarBR(dataKey)})`;
  }
  if (dias <= 13) return `veio semana passada (${formatarBR(dataKey)})`;
  if (dias <= 45) return `veio mês passado (${formatarBR(dataKey)})`;
  return `veio em ${formatarBR(dataKey)}`;
}

/**
 * Candidatos para um nome falado.
 *
 * `ultimaConsultaPorDeal` e `proximaConsultaPorDeal` são mapas dealId -> data
 * (AAAA-MM-DD). Quem os monta é a ferramenta, a partir do que o contexto já
 * carregou — aqui não há acesso a banco.
 *
 * Devolve SEMPRE a lista, mesmo com um único candidato: quem decide se pergunta
 * ou segue é o modelo, orientado pelo prompt. Uma função que resolvesse o empate
 * sozinha tiraria a decisão de quem tem o contexto da conversa.
 */
export function buscarPacientes(termo, {
  deals = [],
  ultimaConsultaPorDeal = new Map(),
  proximaConsultaPorDeal = new Map(),
  ultimaInteracaoPorDeal = new Map(),
  hojeKey = "",
  fuso = "America/Sao_Paulo",
  limite = 8,
} = {}) {
  const busca = String(termo ?? "").trim();
  const buscaDigitos = digitos(busca);

  const pontuados = [];
  for (const deal of deals) {
    let pontos = pontuacaoDoNome(deal.customer, busca);
    // Telefone: o médico às vezes dita o número em vez do nome, e quase sempre
    // só o final dele. Compara contra os últimos 8 dígitos do cadastro — a mesma
    // chave que o resto do sistema usa para casar contato, e que já ignora DDI e
    // nono dígito. Trecho parcial ("98811") casa por conter; número completo
    // casa por sufixo.
    if (!pontos && buscaDigitos.length >= 4) {
      // Contido, e não sufixo: o celular tem nove dígitos, então "98811" não é
      // o final de "98811-2233" depois de cortar em oito. Conter cobre o trecho
      // ditado, o número sem DDI e o número inteiro, de uma vez.
      const cadastro = digitos(deal.phone);
      if (cadastro && cadastro.includes(buscaDigitos)) pontos = 90;
    }
    if (pontos > 0) pontuados.push({ deal, pontos });
  }

  pontuados.sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    // Empate de nome: o mais recente primeiro só para a lista ficar previsível.
    // Não é desempate de verdade — os dois vão para a pergunta.
    const ia = String(ultimaInteracaoPorDeal.get(a.deal.id) || a.deal.lastInteraction || "");
    const ib = String(ultimaInteracaoPorDeal.get(b.deal.id) || b.deal.lastInteraction || "");
    return ib.localeCompare(ia);
  });

  const candidatos = pontuados.slice(0, limite).map(({ deal }) => {
    const ultima = soData(ultimaConsultaPorDeal.get(deal.id) || "");
    const proxima = soData(proximaConsultaPorDeal.get(deal.id) || "");
    const pistas = [];
    if (ultima && hojeKey) pistas.push(descreverQuando(ultima, hojeKey, fuso));
    if (proxima) pistas.push(`próxima consulta ${formatarBR(proxima)}`);
    if (!pistas.length) {
      const interacao = soData(ultimaInteracaoPorDeal.get(deal.id) || deal.lastInteraction || "");
      if (interacao && hojeKey) pistas.push(`última conversa ${formatarBR(interacao)}`);
      else pistas.push("sem consulta registrada");
    }
    return {
      paciente_id: deal.id,
      nome: deal.customer,
      // Só o final do telefone: o suficiente para o médico reconhecer, sem
      // despejar o número inteiro de cada homônimo no contexto do modelo.
      telefone_final: digitos(deal.phone).slice(-4),
      ultima_consulta: ultima || "",
      proxima_consulta: proxima || "",
      pista: pistas.join("; "),
    };
  });

  return {
    candidatos,
    // Contagem DEPOIS do filtro de permissão — a lista que chega já vem
    // recortada, e um total maior denunciaria a existência de pacientes de
    // outro médico.
    total: pontuados.length,
    truncado: pontuados.length > candidatos.length,
  };
}
