import { Router as ExpressRouter } from "express";

/**
 * Router do Express com captura automática de erro assíncrono.
 *
 * O Express 4 NÃO encaminha a rejeição de um handler `async` para o middleware
 * de erro: a promise fica sem tratamento e, do Node 15 em diante, isso derruba
 * o PROCESSO INTEIRO — junto com todas as conexões de WhatsApp abertas.
 *
 * Confirmado em teste: `app.get("/x", async () => { throw ... })` termina o
 * processo com exit code 1. Bastava uma requisição malformada
 * (`?limit=abc` chegava no Mongo como NaN) para tirar o CRM do ar.
 *
 * Em vez de lembrar de escrever try/catch em cada uma das ~120 rotas — e de
 * lembrar para sempre, em toda rota nova — o wrapper vive aqui, no construtor
 * do router. Trocar `from "express"` por este módulo protege o arquivo todo.
 *
 * Arity é preservada porque o Express distingue middleware de erro por
 * `fn.length === 4`; envolver sem cuidado transformaria um handler de erro em
 * handler comum e o erro passaria batido.
 */
function proteger(fn) {
  if (typeof fn !== "function") return fn;
  if (fn.__safeWrapped) return fn;

  let wrapped;
  if (fn.length === 4) {
    wrapped = function (err, req, res, next) {
      try {
        return Promise.resolve(fn.call(this, err, req, res, next)).catch(next);
      } catch (sincrono) {
        return next(sincrono);
      }
    };
  } else {
    wrapped = function (req, res, next) {
      try {
        return Promise.resolve(fn.call(this, req, res, next)).catch(next);
      } catch (sincrono) {
        return next(sincrono);
      }
    };
  }
  wrapped.__safeWrapped = true;
  // Preserva metadados que outras partes do sistema leem no middleware
  // (ex.: requireAuth().exigeCargos, usado pelos testes de permissão).
  if (fn.exigeCargos !== undefined) wrapped.exigeCargos = fn.exigeCargos;
  // Sub-routers e middlewares de biblioteca (multer, cors) carregam propriedades
  // próprias; copiá-las evita quebrar quem depende delas.
  Object.setPrototypeOf(wrapped, fn);
  return wrapped;
}

const METODOS = ["get", "post", "put", "patch", "delete", "options", "head", "all", "use"];

export function Router(options) {
  const router = ExpressRouter(options);
  for (const metodo of METODOS) {
    const original = router[metodo].bind(router);
    router[metodo] = (...args) => original(...args.map(proteger));
  }
  return router;
}

export { proteger as asyncHandler };
