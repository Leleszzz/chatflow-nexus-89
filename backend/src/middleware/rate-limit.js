import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Limites de taxa.
 *
 * O login é o caso mais urgente: além de força bruta, `verifyPassword` roda
 * PBKDF2 com 100 mil iterações, então cada tentativa custa CPU de verdade —
 * um laço de requisições derrubava o servidor sem nem tentar adivinhar senha.
 *
 * A chave do login é IP + identificador: só por IP, um NAT de clínica inteira
 * compartilharia o mesmo balde; só por identificador, trocar de usuário a cada
 * tentativa contornaria o limite.
 */

const respostaExcedida = (req, res) => {
  res.status(429).json({
    error: "Tentativas demais. Aguarde alguns minutos e tente de novo.",
    code: "LIMITE_EXCEDIDO",
  });
};

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Não conta o login que deu certo: quem sabe a senha não deve ser punido por
  // um colega que errou a dele no mesmo IP.
  skipSuccessfulRequests: true,
  keyGenerator: req => {
    const ip = ipKeyGenerator(req.ip);
    const quem = String(req.body?.identifier || "").trim().toLowerCase().slice(0, 64);
    return `${ip}|${quem}`;
  },
  handler: respostaExcedida,
});

/** Troca de senha: mais frouxo que o login, mas ainda contido. */
export const senhaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respostaExcedida,
});

/**
 * Consulta de lead por telefone devolve nome + CPF. Sem limite, dá para varrer
 * a lista importada inteira testando faixas de número.
 */
export const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({
      error: "Muitas consultas seguidas. Aguarde um instante.",
      code: "LIMITE_CONSULTA",
    });
  },
});

/**
 * Chamadas que gastam dinheiro (OpenAI/Groq). Por usuário, porque o custo é da
 * empresa e o limite por IP não impediria a mesma pessoa em outra rede.
 */
export const iaLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({
      error: "Limite de chamadas de IA por minuto atingido.",
      code: "LIMITE_IA",
    });
  },
});

/** Rede de segurança geral. Folgado o bastante para o uso normal do CRM. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: req => req.user?.id || ipKeyGenerator(req.ip),
  handler: respostaExcedida,
});
