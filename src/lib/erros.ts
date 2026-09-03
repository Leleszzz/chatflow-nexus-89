/**
 * Tradução dos códigos de erro do backend para texto acionável.
 *
 * O backend passou a esconder o detalhe interno das falhas inesperadas — antes
 * `err.message` cru chegava à tela, entregando URI do banco e caminho de
 * arquivo. O preço disso seria o usuário ver só "erro interno" e não saber o
 * que fazer, então cada código ganha uma frase que diz o PRÓXIMO PASSO.
 */

const MENSAGENS: Record<string, string> = {
  // Sessão e permissão
  CSRF_INVALIDO: "Sua sessão expirou. Recarregue a página (F5) e tente de novo.",
  LIMITE_EXCEDIDO: "Tentativas demais em pouco tempo. Aguarde alguns minutos.",
  LIMITE_CONSULTA: "Muitas consultas seguidas. Aguarde um instante e tente de novo.",
  LIMITE_IA: "Limite de chamadas de IA por minuto atingido. Aguarde um pouco.",
  SENHA_FRACA: "Escolha uma senha mais forte: 10+ caracteres, com letras e números.",
  SENHA_REPETIDA: "A nova senha precisa ser diferente da atual.",

  // WhatsApp
  INSTANCIA_OFFLINE: "A instância de WhatsApp está desconectada. Reconecte em Instâncias.",

  // IA
  SEM_CHAVE_OPENAI: "A chave da OpenAI não está configurada. Peça a um administrador em Configurações.",
  RESPOSTA_VAZIA: "A IA não conseguiu gerar uma resposta. Tente novamente.",
  SEM_CONTEXTO: "Não há mensagens suficientes nesta conversa para a IA responder.",
  SEM_CHAVE_TRANSCRICAO: "A chave de transcrição não está configurada. Peça a um administrador em Configurações.",
  AUDIO_VAZIO: "Não consegui entender o áudio. Fale de novo, mais perto do microfone.",
  PROPOSTA_JA_DECIDIDA: "Esta ação já foi confirmada ou recusada.",
  THREAD_NAO_ENCONTRADA: "Esta conversa não existe mais.",

  // Envio e arquivos
  ARQUIVO_GRANDE: "O arquivo é maior que o limite permitido.",
  UPLOAD_INVALIDO: "Esse tipo de envio não é aceito.",
  UPLOAD_FALHOU: "Falha ao enviar o arquivo. Tente novamente.",
  CORPO_GRANDE: "O conteúdo enviado é grande demais.",
  JSON_INVALIDO: "Os dados enviados estão em formato inválido.",

  // Genéricos
  ROTA_INEXISTENTE: "Recurso não encontrado.",
  ERRO_INTERNO: "Algo deu errado no servidor. Se continuar, informe o código ao suporte.",
};

type ErroApi = { code?: string; error?: string; ref?: string };

/** Extrai `{ code, error, ref }` de um Error cujo `message` pode ser JSON. */
function interpretar(err: unknown): ErroApi {
  if (!err) return {};
  const bruto = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(bruto);
    if (parsed && typeof parsed === "object") return parsed as ErroApi;
  } catch {
    /* não era JSON: é a própria mensagem */
  }
  return { error: bruto };
}

/**
 * Texto para mostrar ao usuário. Prefere a tradução do código; cai na mensagem
 * do servidor (que, para erros de domínio, já é escrita para ser lida); e por
 * último num texto genérico.
 */
export function mensagemDeErro(err: unknown, padrao = "Não foi possível concluir a ação."): string {
  const { code, error, ref } = interpretar(err);
  const traduzida = code ? MENSAGENS[code] : undefined;
  const base = traduzida || error || padrao;
  // A referência correlaciona a tela com a linha do log do servidor.
  return ref ? `${base} (ref: ${ref})` : base;
}

/** `true` quando o erro pede que o usuário recarregue a página. */
export function pedeRecarregar(err: unknown): boolean {
  return interpretar(err).code === "CSRF_INVALIDO";
}
