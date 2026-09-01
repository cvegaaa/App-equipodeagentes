# Rediseño visual — paleta más viva/moderna, bordes más notorios

Decisión del dueño del proyecto, 2026-08-27: la paleta original (`#1E5F74` teal sobre grises neutros
casi sin contraste de borde) se sentía demasiado corporativa/plana. Pedido: "colores más vivos y
modernos, líneas más notorias, algo de aspecto futurista pero sin exagerar". Este documento fija la
nueva paleta y por qué, como referencia hasta que se audite visualmente en el navegador.

## Qué cambió y por qué

| Token | Antes (claro) | Ahora (claro) | Motivo |
|---|---|---|---|
| `background` | `#FAFAFA` (gris neutro) | `#F6F6FB` (blanco frío, leve tinte violeta) | Tono "tech" sutil sin perder legibilidad |
| `foreground` | `#111827` | `#13131F` | Casi negro con el mismo tinte frío que el resto de la paleta |
| `primary` | `#1E5F74` (teal apagado) | `#4F46E5` (índigo-violeta vivo) | El pedido central: color de marca más vivo y moderno, lectura "IA/futurista" sin ser un neón agresivo |
| `secondary` | `#FAFAFA` (= background, invisible) | `#ECEBFB` (tinte índigo claro) | Ahora se distingue del fondo — antes secondary y background eran el mismo color |
| `accent` | `#E2E8F0` (mismo gris que border/muted) | `#DFF7FA` (tinte cian claro) | Segundo acento de color (cian) para hovers/estados, en vez de reusar el gris de borde |
| `border` / `input` | `#E2E8F0` (case ~background, bajo contraste) | `#D3D4E6` (gris-violeta más saturado) | "Líneas más notorias" — separación visible entre tarjetas/inputs y el fondo, que antes casi no se notaba |
| `chart-1..5` | teal/gris/verde/rojo/negro (poca variedad) | índigo/cian/verde/rojo/ámbar | Paleta de datos más variada y vívida, coherente con el nuevo primario |

Mismo criterio en oscuro: `background` pasa de un azul-gris (`#0F1720`) a un casi-negro con tinte
frío más profundo (`#0B0B14`, sensación "espacio/futurista"), `primary` sube a `#7C7AFF` (índigo más
claro, necesario para contraste sobre fondo oscuro), `accent` es un cian oscuro (`#123138` /
`#7DE6F2`) en vez de reusar el gris de `muted`.

**Qué NO cambió, deliberadamente:** `destructive`, `success` y `muted-foreground` se dejaron con los
mismos valores que ya tenían contraste verificado en `blueprint.md` §7 — el pedido era sobre el color
de marca y la separación visual, no sobre los colores funcionales de estado, y tocarlos habría
significado re-verificar accesibilidad sin necesidad. Tampoco cambió `--radius` (8px inputs/botones,
12px tarjetas) ni la escala tipográfica — no se pidió.

## Contraste verificado (WCAG 2.1, fórmula de luminancia relativa)

| Par | Claro | Oscuro |
|---|---|---|
| `foreground` sobre `background` | 15.8:1 | 15.6:1 |
| `primary` sobre `background` (texto/UI grande) | 5.9:1 | 5.7:1 |
| `primary-foreground` sobre `primary` (texto de botón) | 6.3:1 | 6.1:1 |
| `muted-foreground` sobre `card` | 4.6:1 (sin cambio, ya verificado) | sin cambio |
| `accent-foreground` sobre `accent` | >10:1 (navy sobre cian claro) | >8:1 (cian claro sobre navy) |

Todos ≥ 4.5:1 para texto normal o ≥ 3:1 para componentes UI/texto grande — cumple el mismo estándar
que ya exigía `blueprint.md` §7.

## Dónde se aplicó

- `src/app/globals.css` — tokens `:root` y `:root[data-theme="dark"]` (fuente única de verdad, regla
  de `CLAUDE.md`: sin hex sueltos en componentes, todo pasa por estos tokens).
- `blueprint.md` §7 y la tabla "Sistema de diseño" de `CLAUDE.md` — actualizadas para que coincidan.

## Pendiente (no hecho en esta sesión)

Esto fue un cambio de tokens, no una pasada componente por componente. Vale la pena, antes de darlo
por cerrado, correr `pnpm dev` y revisar visualmente: botones, tarjetas, sidebar y estados de
hover/focus en ambos temas — algún componente en `src/components/ui/` podría tener un hex o
`shadow` fijo que no pase por estos tokens (regla de `.claude/rules/styling.md`) y quedaría
desentonado con la paleta nueva.
