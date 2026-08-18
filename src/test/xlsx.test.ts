import { describe, expect, it } from "vitest";
import { toCell } from "@/lib/xlsx";

describe("toCell", () => {
  it("mantém número como número, para o Excel somar", () => {
    expect(toCell(1234.5)).toEqual({ value: 1234.5, type: Number, format: "#,##0.00" });
    expect(toCell(0)).toEqual({ value: 0, type: Number, format: "#,##0.00" });
    expect(toCell(-10)).toEqual({ value: -10, type: Number, format: "#,##0.00" });
  });

  it("esvazia número não-finito em vez de quebrar o arquivo", () => {
    expect(toCell(NaN)).toBeNull();
    expect(toCell(Infinity)).toBeNull();
  });

  it("mantém data como data", () => {
    const date = new Date("2026-03-14T15:09:00.000Z");
    expect(toCell(date)).toEqual({ value: date, type: Date, format: "dd/mm/yyyy hh:mm" });
  });

  it("esvazia data inválida", () => {
    expect(toCell(new Date("nao-e-data"))).toBeNull();
  });

  it("preserva texto com acento e pontuação", () => {
    expect(toCell("Ana — proposta enviada; R$ 1,50")).toEqual({
      value: "Ana — proposta enviada; R$ 1,50",
      type: String,
    });
  });

  it("trata booleano e vazios", () => {
    expect(toCell(true)).toEqual({ value: true, type: Boolean });
    expect(toCell(null)).toBeNull();
    expect(toCell(undefined)).toBeNull();
    expect(toCell("")).toEqual({ value: "", type: String });
  });
});
