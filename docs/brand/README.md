# Marca Resolve — originales

Archivos originales del logotipo, **sin convertir, renombrar ni recomprimir**.
Se conservan tal como salieron del generador: los PNG son los mismos bytes que
los entregables.

## Estructura

```
docs/brand/
├─ svg/
│  ├─ resolve-logo.svg                ← versión oficial (vectorial)
│  └─ resolve-logo-alternativa.svg    ← variante con el hombro de la R continuo
└─ png/
   ├─ resolve-logo.png                ← 1080 × 1706 (1:1 del arte)
   ├─ resolve-logo@3x.png             ← 1620 × 2559 (@3x)
   └─ resolve-logo-alternativa.png    ← 1080 × 1706 (variante alternativa)
```

Todos los PNG se exportaron a partir de su SVG con `sharp` (density 288 +
Lanczos3), sin pérdida adicional. Los `.png` están en **Git LFS** según
`.gitattributes`; los `.svg` son texto normal.

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `svg/resolve-logo.svg` | 10 176 | `BCFCDE6F93DAC00C49300A51800870B6D7BEC2EB576622A33E50571DCF7E77A0` |
| `svg/resolve-logo-alternativa.svg` | 9 871 | `71161B862282E726A8C8FFC452596168465A2B1545BC048E4A90A1ED6B74E101` |
| `png/resolve-logo.png` | 1 763 955 | `2803DC7BD8461A8CEAC0EEF1B8F3A56C10786813F704D12157018308561A8BEA` |
| `png/resolve-logo@3x.png` | 2 819 733 | `E4A074B98A584CA3A064CBA813B019A3BF5DED0A4F4DF81206BDAEA9BB8C9465` |
| `png/resolve-logo-alternativa.png` | 1 836 409 | `5453B35B40EEB8E751327B83D1AA230E543FD6AF1D046882B6B8E4112E89F774` |

## Qué contiene la marca

- Tarjeta vertical redondeada con degradado diagonal verde → azul y retícula de
  líneas blancas al 9 %.
- «R» en degradado verde, con una **faceta recta de 45,01° y 28 px** en el
  hombro, alineada con las diagonales del fondo. Es un solo trazo: la faceta se
  empalmó con de Casteljau dentro del glifo real (Outfit ExtraBold, `wght 800`),
  sin máscaras ni costuras.
- Wordmark «Resolve» en Outfit ExtraBold con tracking uniforme.

La variante `-alternativa` es la misma marca **sin** la faceta (hombro original
del glifo). El resto es idéntico.

## Paleta

| Uso | Color | RGB |
|---|---|---|
| R (inicio del degradado) | `#37DD68` | 55, 221, 104 |
| R (medio) | `#34CE6B` | 52, 206, 107 |
| R (fin) | `#32B677` | 50, 182, 119 |
| Wordmark | `#F2F8E6` | 242, 248, 230 |
| Fondo — paradas | `#15EB69` `#11C68E` `#0A5BD8` `#0425C5` `#02147F` `#041A6C` | ver SVG |
| Veladuras radiales | `#1BE57C` `#11ECD3` `#030032` `#031352` `#020B1A` | ver SVG |
| Líneas diagonales | `#FFFFFF` al 9 % | 255, 255, 255 |
| Borde de tarjeta | `#00002A` al 40 % | 0, 0, 42 |

Colores planos de marca para otras piezas: **verde `#37DD68`**, **azul
`#0A5BD8`** y **navy `#000032`** (el mismo azul de la app).

## Regenerar

El generador vive fuera del repositorio
(`%TEMP%\brand-work\gen\build.js` + `final.js`). Parámetros principales:
`DESDE`/`HASTA` (28,77° / 62,77° = corte de 45°), `WORD_W`, `TRACK` y `FONDO`.
`node build.js` produce los SVG y `node final.js` los PNG.

> No recomprimir ni reconvertir los archivos de esta carpeta: son la referencia
> para comparar cualquier export futuro.

## Uso en la app

La app **no** usa estos archivos: usa `src/imports/logo-limpio.png` (R verde +
«Resolve Pasto» en blanco, fondo transparente). Esta carpeta es el archivo de
marca, no un recurso de runtime. Ver también
[`docs/LOGOTIPOS_OFICIALES.md`](../LOGOTIPOS_OFICIALES.md).
