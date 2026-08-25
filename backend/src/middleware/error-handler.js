import { MulterError } from "multer";

/**
 * Tratamento centralizado de erro. Precisa ser registrado DEPOIS de todas as
 * rotas, e é o par obrigatório do lib/safe-router.js: um encaminha a rejeição
 * para cá, o outro transforma em resposta.
 *
 * Regra do que sai na resposta: o cliente recebe uma mensagem estável e um
 * `code` que o front sabe traduzir. `err.message` cru NUNCA vai para o cliente
 * quando o erro é inesperado — mensagem de driver de banco entrega nome de
 * coleção, caminho de arquivo e às vezes trecho da query.
 */

/** Erro que o próprio código levanta de propósito, com status e mensagem exibíveis. */
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.exibivel = true;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: "Rota não encontrada", code: "ROTA_INEXISTENTE" });
}

function traduzirMulter(err) {
  if (err.code === "LIMIT_FILE_SIZE") {
    return { status: 413, error: "Arquivo maior que o limite permitido", code: "ARQUIVO_GRANDE" };
  }
  if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
    return { status: 400, error: "Envio de arquivo inválido", code: "UPLOAD_INVALIDO" };
  }
  return { status: 400, error: "Falha no upload do arquivo", code: "UPLOAD_FALHOU" };
}

export function errorHandler(err, req, res, _next) {
  // Resposta já começou a ser enviada (stream de mídia, por exemplo): não dá
  // para trocar o status, só encerrar.
  if (res.headersSent) return res.destroy();

  if (err instanceof MulterError) {
    const { status, error, code } = traduzirMulter(err);
    return res.status(status).json({ error, code });
  }

  // Erro intencional do domínio: a mensagem foi escrita para ser lida.
  if (err?.exibivel || (err?.status >= 400 && err?.status < 500)) {
    return res.status(err.status || 400).json({
      error: err.message || "Requisição inválida",
      ...(err.code ? { code: err.code } : {}),
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Corpo da requisição grande demais", code: "CORPO_GRANDE" });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido", code: "JSON_INVALIDO" });
  }

  // Inesperado: log completo no servidor, mensagem genérica para o cliente.
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[erro ${ref}] ${req.method} ${req.originalUrl} (usuário: ${req.user?.id || "anônimo"})`);
  console.error(err);
  res.status(500).json({
    error: "Erro interno. Se persistir, informe a referência ao suporte.",
    code: "ERRO_INTERNO",
    ref,
  });
}
