// Arranca el build `output: "standalone"` para Playwright — `next start` no funciona con
// standalone (Next lo advierte explícitamente); hay que copiar static/public al lado de
// server.js y correr ese archivo directo. Mismo patrón que usa el Dockerfile en producción.
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

if (!existsSync(".next/standalone/.next/static")) {
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
}
if (!existsSync(".next/standalone/public")) {
  cpSync("public", ".next/standalone/public", { recursive: true });
}

const child = spawn(process.execPath, [".next/standalone/server.js"], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
