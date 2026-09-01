import { describe, expect, it } from "vitest";
import { wouldRemoveLastSuperadmin } from "@/app/app/plataforma/usuarios/superadmin-guard";

describe("wouldRemoveLastSuperadmin", () => {
  it("bloquea cuando solo queda 1 superadmin", () => {
    expect(wouldRemoveLastSuperadmin(1)).toBe(true);
  });

  it("bloquea también en un conteo inconsistente (0 o negativo, nunca debería pasar)", () => {
    expect(wouldRemoveLastSuperadmin(0)).toBe(true);
  });

  it("permite degradar cuando quedan 2 o más", () => {
    expect(wouldRemoveLastSuperadmin(2)).toBe(false);
    expect(wouldRemoveLastSuperadmin(5)).toBe(false);
  });
});
