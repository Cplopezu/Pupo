# Pupo · Terminal de Gastos

Registro de gastos con **foto de la boleta**, trazabilidad completa y un **dashboard estilo terminal financiero** (tema oscuro gris-azul, cifras en tipografía monoespaciada de alto contraste). Cada número clave se puede **pinchar para abrir su análisis** (bajada).

Es una aplicación web instalable (PWA): funciona en el celular con la cámara, no requiere servidor ni cuentas, y los datos quedan guardados en el dispositivo.

## Qué hace

**Registro**
- Foto de la boleta con la cámara (o arrastrando una imagen). Se comprime automáticamente.
- **Lectura automática (OCR)** en español: propone monto total, fecha, RUT emisor, N° de folio y comercio. Los campos detectados se destacan para revisarlos.
- Sugiere la categoría y el medio de pago según el último gasto en ese comercio.
- **Control de duplicados**: avisa si la misma foto o el mismo monto/fecha/comercio ya fue registrado.

**Trazabilidad**
- Folio interno correlativo (`G-00001`…).
- Huella **SHA-256** de cada foto, con botón para *verificar integridad* (detecta si la imagen fue alterada).
- **Bitácora de cambios** por registro: quién/cuándo/qué campo cambió (antes → después).
- Los gastos no se borran: se **anulan con motivo** y quedan visibles para auditoría. Si se reemplaza una foto, la anterior se conserva.

**Dashboard**
- Ticker superior con la variación del mes por categoría.
- Períodos: mes actual (vs mismos días del mes anterior), mes anterior, 90 días, año a la fecha, 12 meses.
- KPI: gasto del período, promedio diario, ticket promedio, transacciones, proyección de cierre, presupuesto consumido, % de respaldo con foto y categoría principal.
- Gráficos: gasto acumulado actual vs anterior, flujo diario/semanal/mensual, ranking por categoría y por comercio, últimos movimientos.

**Análisis al pinchar (bajada del número)**

| Pinche en… | Se abre |
|---|---|
| Gasto del período | Explicación automática de la variación, **puente de variación por categoría y por comercio** (Δ$, Δ%, aporte en pp), mayores gastos |
| Promedio diario | Gasto día a día con línea de promedio, día peak, días sin gasto, patrón por día de la semana |
| Ticket promedio | Promedio vs mediana, distribución por tramos, concentración de los 5 mayores gastos |
| Transacciones | Frecuencia por día de la semana, medios de pago, comercios más visitados |
| Proyección de cierre | Trayectoria real + proyección + presupuesto; **gasto diario máximo** para cerrar dentro del presupuesto |
| Presupuesto | Semáforo por categoría (en rango / alerta / excedido) contra el consumo esperado a la fecha |
| Respaldo con foto | Cobertura por categoría y lista de gastos sin boleta |
| Una categoría o comercio | Participación, variación, tendencia de 6 meses, detalle de movimientos |
| Una barra del gráfico | Movimientos de ese día/semana/mes |
| Un movimiento | Ficha con la foto (zoom), datos, huella, bitácora y acciones (editar / anular) |

Los análisis se encadenan (de una categoría a un comercio, a una boleta) y el botón **‹** vuelve atrás.

**Libro y Ajustes**
- Libro completo con búsqueda (comercio, folio, RUT, notas), filtros por categoría/mes y vista de anulados.
- Presupuesto mensual por categoría.
- **Respaldo completo** en `.json` (incluye fotos) y restauración; exportación del libro a **Excel (.csv)**.
- Datos demo (6 meses) para explorar, que se eliminan sin tocar los registros reales.

## Cómo usarla

### En el computador
```bash
npm start            # o: python3 -m http.server 8080
```
Abrir <http://localhost:8080>. Para probar rápido: **Ajustes → Cargar datos demo**.

### En el celular (recomendado)
Publicar la carpeta en cualquier hosting estático con HTTPS, por ejemplo **GitHub Pages**:
1. En GitHub: *Settings → Pages → Deploy from a branch* y elegir la rama y la carpeta `/ (root)`.
2. Abrir la URL en el celular y usar *Agregar a pantalla de inicio*. Queda como app, con acceso directo a la cámara mediante el botón **＋ Boleta**.

> HTTPS es necesario para la cámara, la huella SHA-256 y el modo sin conexión.

## Dónde quedan los datos

Todo se guarda en el **propio dispositivo** (IndexedDB del navegador); nada se envía a terceros. La única conexión externa es la descarga del motor OCR (Tesseract.js) y las fuentes, la primera vez.
Por eso conviene **descargar el respaldo `.json` periódicamente** (Ajustes) y, si usa la app en más de un dispositivo, restaurar ese respaldo en el otro. Una sincronización en la nube (p. ej. Supabase o Firebase) sería la siguiente etapa natural.

## Estructura

```
index.html            Interfaz (Dashboard, Registrar, Libro, Ajustes, panel de análisis)
css/app.css           Tema oscuro tipo terminal financiero
js/app.js             Lógica de pantallas, análisis drill-down, registro, libro, respaldos
js/analisis.js        Períodos, agregaciones y descomposición de variaciones
js/charts.js          Gráficos SVG (líneas con crosshair, barras, sparklines)
js/ocr.js             OCR de boletas e interpretación de montos/fecha/RUT/folio chilenos
js/db.js              Persistencia en IndexedDB
js/util.js            Formato CLP, fechas, compresión de imágenes, SHA-256
sw.js                 Service worker (funciona sin conexión)
tests/                Pruebas de la lógica (npm test)
```
