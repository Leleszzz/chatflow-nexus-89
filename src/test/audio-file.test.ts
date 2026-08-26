import { describe, expect, it } from "vitest";
import {
  ehMidiaAceita, extensaoDe, MAX_IMPORT_BYTES, mimeDoArquivo, recusaImportacao,
} from "@/lib/audio-file";

/** File falso: o jsdom não precisa do conteúdo, só do nome, tipo e tamanho. */
const arquivo = (name: string, type = "", size = 1024) =>
  ({ name, type, size, lastModified: Date.now() }) as File;

describe("reconhecimento do arquivo importado", () => {
  it("usa o mimetype quando o navegador informa", () => {
    expect(mimeDoArquivo(arquivo("consulta.m4a", "audio/mp4"))).toBe("audio/mp4");
    expect(mimeDoArquivo(arquivo("consulta.mp3", "audio/mpeg; codecs=mp3"))).toBe("audio/mpeg");
  });

  it("cai para a extensão quando o Windows não manda mimetype", () => {
    expect(mimeDoArquivo(arquivo("consulta.opus", ""))).toBe("audio/ogg");
    expect(mimeDoArquivo(arquivo("consulta.amr", ""))).toBe("audio/amr");
  });

  it("trata octet-stream como ausência de informação", () => {
    expect(mimeDoArquivo(arquivo("consulta.m4a", "application/octet-stream"))).toBe("audio/mp4");
  });

  it("não inventa mimetype para extensão desconhecida", () => {
    expect(mimeDoArquivo(arquivo("consulta.xyz", ""))).toBe("");
    expect(extensaoDe("semextensao")).toBe("");
  });

  it("aceita áudio e vídeo, inclusive os sem mimetype", () => {
    expect(ehMidiaAceita(arquivo("a.mp3", "audio/mpeg"))).toBe(true);
    expect(ehMidiaAceita(arquivo("a.mp4", "video/mp4"))).toBe(true);
    expect(ehMidiaAceita(arquivo("a.opus", ""))).toBe(true);
    expect(ehMidiaAceita(arquivo("a.amr", ""))).toBe(true);
  });

  it("recusa o que não é mídia", () => {
    expect(ehMidiaAceita(arquivo("relatorio.pdf", "application/pdf"))).toBe(false);
    expect(ehMidiaAceita(arquivo("planilha.xlsx", ""))).toBe(false);
  });
});

describe("recusa antes de subir", () => {
  it("libera um arquivo comum", () => {
    expect(recusaImportacao(arquivo("consulta.m4a", "audio/mp4", 5_000_000))).toBeNull();
  });

  it("explica o motivo em vez de deixar o servidor falhar depois do upload", () => {
    expect(recusaImportacao(arquivo("nota.pdf", "application/pdf"))).toMatch(/áudio ou vídeo/);
    expect(recusaImportacao(arquivo("vazio.mp3", "audio/mpeg", 0))).toMatch(/vazio/);
    expect(recusaImportacao(arquivo("gigante.mp3", "audio/mpeg", MAX_IMPORT_BYTES + 1))).toMatch(/limite/);
  });
});
