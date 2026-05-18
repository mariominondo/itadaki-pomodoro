# assets/vendor

Librerías de terceros bajadas localmente para evitar exposición a la cadena de suministro vía CDN (caso Polyfill.io 2024 + paquetes npm comprometidos).

## chart.umd.js — Chart.js v4.4.7

- **Upstream**: https://www.npmjs.com/package/chart.js/v/4.4.7
- **SHA256**: `2812cb8825fdc57469eb2f7bb055e9429244e599920511ee477e828499b632cb`
- **Tamaño**: 205,615 bytes
- **Verificación cruzada (2026-05-18)**: idéntico bit a bit entre jsdelivr, unpkg y el tarball oficial de la npm registry.

### Cómo actualizar

```bash
CHART_VER=X.Y.Z
curl -fsSL -o /tmp/chart-jsdelivr.js "https://cdn.jsdelivr.net/npm/chart.js@${CHART_VER}/dist/chart.umd.js"
curl -fsSL -o /tmp/chart-unpkg.js    "https://unpkg.com/chart.js@${CHART_VER}/dist/chart.umd.js"
curl -fsSL -o /tmp/chart-npm.tgz     "https://registry.npmjs.org/chart.js/-/chart.js-${CHART_VER}.tgz"
tar -xzOf /tmp/chart-npm.tgz package/dist/chart.umd.js > /tmp/chart-npm.js

# Las 3 fuentes deben dar el mismo SHA256:
sha256sum /tmp/chart-jsdelivr.js /tmp/chart-unpkg.js /tmp/chart-npm.js

# Si coinciden, instalar:
cp /tmp/chart-npm.js assets/vendor/chart.umd.js
# Actualizar el SHA256 y el bloque ## de este README.
```
