import { describe, expect, it } from "vitest";
import { csvEscape, csvNumber } from "@/lib/csv";

// O formato existe para abrir direto no Excel em pt-BR: BOM UTF-8, separador
// `;` e vírgula decimal. Trocar qualquer um desses quebra os acentos ou
// embaralha as colunas quando o valor tem decimal.
describe("csvEscape", () => {
  it("envolve o valor em aspas", () => {
    expect(csvEscape("Ana")).toBe('"Ana"');
  });

  it("duplica aspas internas em vez de escapar com barra", () => {
    expect(csvEscape('Ana "A Fera"')).toBe('"Ana ""A Fera"""');
  });

  it("preserva separador e quebra de linha dentro do campo", () => {
    expect(csvEscape("Rua A; 123")).toBe('"Rua A; 123"');
    expect(csvEscape("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });

  it("aceita número", () => {
    expect(csvEscape(42)).toBe('"42"');
  });
});

describe("csvNumber", () => {
  it("usa vírgula decimal", () => {
    expect(csvNumber(1234.5)).toBe("1234,50");
  });

  it("respeita a quantidade de casas", () => {
    expect(csvNumber(66.666, 1)).toBe("66,7");
    expect(csvNumber(10, 0)).toBe("10");
  });

  it("devolve vazio para valor não finito", () => {
    expect(csvNumber(NaN)).toBe("");
    expect(csvNumber(Infinity)).toBe("");
  });
});
