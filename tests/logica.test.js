import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretar } from '../js/ocr.js';
import { parseMonto } from '../js/util.js';
import { rango, descomponer, serieDiaria, total } from '../js/analisis.js';

test('parseMonto entiende formato chileno', () => {
  assert.equal(parseMonto('$ 12.990'), 12990);
  assert.equal(parseMonto('1.234.567'), 1234567);
  assert.equal(parseMonto('12990'), 12990);
  assert.equal(parseMonto('1.234,50'), 1234.5);
  assert.equal(parseMonto(''), NaN);
});

test('interpretar extrae campos de una boleta típica', () => {
  const txt = `SUPERMERCADO EL ALBA
R.U.T.: 76.543.210-K
BOLETA ELECTRONICA
N° 4587123
FECHA: 03/10/2026 13:45
LECHE ENTERA 1L        1.190
PAN HALLULLA           2.350
SUBTOTAL              3.540
TOTAL               $ 3.540
EFECTIVO              5.000
VUELTO                1.460`;
  const r = interpretar(txt, new Date(2026, 9, 6));
  assert.equal(r.monto, 3540);
  assert.equal(r.fecha, '2026-10-03');
  assert.equal(r.rut, '76.543.210-K');
  assert.equal(r.folio, '4587123');
  assert.equal(r.comercio, 'Supermercado El Alba');
});

test('interpretar sin línea TOTAL usa el mayor monto', () => {
  const r = interpretar('CAFE CENTRAL\nCAPUCCINO 3.200\nMEDIALUNA 1.800\n5.000');
  assert.equal(r.monto, 5000);
});

test('rango mes actual compara contra los mismos días del mes anterior', () => {
  const r = rango('mes', new Date(2026, 9, 6));
  assert.equal(r.desde, '2026-10-01');
  assert.equal(r.hasta, '2026-10-06');
  assert.equal(r.prevDesde, '2026-09-01');
  assert.equal(r.prevHasta, '2026-09-06');
  assert.equal(r.dias, 6);
  const m = rango('mes', new Date(2026, 2, 31));
  assert.equal(m.prevHasta, '2026-02-28');
});

test('descomponer explica la variación total', () => {
  const A = [{ categoria: 'X', monto: 300, fecha: '2026-10-01' }, { categoria: 'Y', monto: 100, fecha: '2026-10-02' }];
  const B = [{ categoria: 'X', monto: 100, fecha: '2026-09-01' }, { categoria: 'Y', monto: 100, fecha: '2026-09-02' }];
  const d = descomponer(A, B, g => g.categoria);
  assert.equal(d[0].clave, 'X');
  assert.equal(d[0].delta, 200);
  assert.equal(d[0].aporte, 100);
  assert.equal(d[0].peso, 100);
  assert.equal(total(A), 400);
  assert.deepEqual(serieDiaria(A, '2026-10-01', '2026-10-03'), [300, 100, 0]);
});

test('interpretar reconoce marcas y razón social junto al RUT', () => {
  assert.equal(interpretar('WALMART CHILE S.A.\nR.U.T. 76.042.014-K\nTOTAL 12.990').comercio, 'Líder');
  const r = interpretar('*** BIENVENIDO ***\n12/09/2026\nCOMERCIAL LA ESPIGA SPA\nRUT: 77.123.456-1\nTOTAL 4.500');
  assert.equal(r.comercio, 'Comercial La Espiga SPA');
});

import { interpretarCartola, limpiarComercio, interpretarMovimientosCsv } from '../js/cartola.js';

// Filas sintéticas con la misma estructura que entrega pdf.js para un estado de cuenta de tarjeta.
const it = (x, s) => ({ x, s });
const mov = (lugar, fecha, ref, desc, op, tot, n, de, cuota) => [it(47, lugar), it(190, fecha), it(239, ref), it(290, desc), it(404, op), it(450, tot), it(487, `${n} ${de}`), it(495, '/'), it(524, cuota)];
const filas = [
  [it(51, 'Estado de Cuenta Nacional al 17/09/2026')],
  [it(51, 'Nº tarjeta de crédito'), it(300, '**** **** **** 1234')],
  [it(266, 'Período facturado'), it(427, '20/08/2026'), it(491, '17/09/2026')],
  [it(47, '1.TOTAL OPERACIONES'), it(512, '$-80.000')],
  [it(190, '07/09/2026'), it(239, '0000000000'), it(290, 'MONTO CANCELADO'), it(392, '$-100.000'), it(438, '$-100.000'), it(487, '01 01'), it(495, '/'), it(512, '$-100.000')],
  mov('SANTIAGO', '21/08/2026', '0011111111', 'MERCADOPAGO', '$8.360', '$8.360', '01', '01', '$8.360'),
  [it(290, '*CAFETERIA Las Condes')],
  mov('SANTIAGO', '22/08/2026', '0022222222', 'PAYU *UBER TRIP', '$2.999', '$2.999', '01', '01', '$2.999'),
  mov('SANTIAGO', '08/04/2026', '0033333333', 'MP *MERCADO LIBRE TASA', '$21.660', '$21.660', '06', '06', '$3.610'),
  [it(290, 'INT. 0,00%')],
  mov('SANTIAGO', '10/09/2026', '0044444444', 'COPEC APP SANTIAGO', '$5.031', '$5.031', '01', '01', '$5.031'),
  [it(47, '3.CARGOS, COMISIONES, IMPUESTOS Y ABONOS'), it(524, '$2.330')],
  [it(190, '17/09/2026'), it(239, '0000000000'), it(290, 'COMISION'), it(408, '$2.330'), it(454, '$2.330'), it(487, '01 01'), it(495, '/'), it(528, '$2.330')],
  [it(47, '4.INFORMACION COMPRAS EN CUOTAS EN PERIO'), it(524, '$0')],
  mov('Las Condes', '22/08/2026', '0055555555', 'MERCADOPAGO', '$34.191', '$34.191', '00', '03', '$11.397'),
  [it(51, 'Información de pago')],
];

test('cartola: separa compras, cuotas y cargos, y omite pagos y cuotas futuras', () => {
  const r = interpretarCartola({ filas, titulo: 'Banco Security' });
  assert.equal(r.banco, 'Banco Security');
  assert.equal(r.tarjeta, '1234');
  assert.deepEqual(r.periodo, { desde: '2026-08-20', hasta: '2026-09-17' });
  assert.equal(r.gastos.length, 5);
  assert.equal(r.total, 8360 + 2999 + 3610 + 5031 + 2330);
  const cuota = r.gastos.find(g => g.tipo === 'cuota');
  assert.deepEqual(cuota.cuota, { n: 6, de: 6 });
  assert.equal(cuota.monto, 3610);
  assert.equal(cuota.fechaGasto, '2026-09-17'); // compra anterior al período: se registra al cierre
  assert.equal(r.gastos[0].comercio, 'Cafeteria');
  assert.equal(r.gastos.find(g => g.tipo === 'cargo').comercio, 'Banco · Comision');
  assert.deepEqual(r.omitidos.map(o => o.motivo), ['Pago o abono a la tarjeta', 'Cuota futura (aún no se cobra)']);
});

test('cartola: limpia nombres de comercio bancarios', () => {
  assert.equal(limpiarComercio('PAYU *UBER TRIP SANTIAGO'), 'Uber');
  assert.equal(limpiarComercio('COPEC APP SANTIAGO'), 'Copec');
  assert.equal(limpiarComercio('TUU*KADITEC NUNOA'), 'Kaditec');
  assert.equal(limpiarComercio('CAFE DEL PARQUE SPA SANTIAGO'), 'Cafe Del Parque SPA');
});

test('boleta Copec: fecha en formato año-mes-día y folio "Boleta Electronica:"', () => {
  const txt = `COPEC
RUT : 76346660-4
R.Social : COMERCIAL F Y H LIMITADA
Boleta Electronica: 3970382
Fecha Emision : 2026-10-09/09:12:09
Nro. transaccion: 604190000002827834
Gasolina 93 9.954 Lt 1507 $ 15.000
SUBTOTAL $ 15.000
TOTAL $ 15.000
TOTAL A PAGAR $ 15.000`;
  const r = interpretar(txt, new Date(2026, 9, 9));
  assert.equal(r.fecha, '2026-10-09');
  assert.equal(r.monto, 15000);
  assert.equal(r.folio, '3970382');
  assert.equal(r.comercio, 'Copec');
  assert.equal(r.rut, '76.346.660-4');
});

test('fechas imposibles o muy antiguas no se aceptan', () => {
  assert.equal(interpretar('TOTAL 1.000\nFECHA 31/02/2026', new Date(2026, 9, 9)).fecha, undefined);
  assert.equal(interpretar('TOTAL 1.000\nFECHA 10/09/2009', new Date(2026, 9, 9)).fecha, undefined);
});

test('movimientos por facturar (CSV): compras, cuotas, pagos y fechas en español', () => {
  const csv = '\uFEFFNombre;Glosa;Nº operación;Monto en pesos\r\n'
    + 'Tarjeta: XXXX XXXX XXXX 4321;;;\r\n'
    + '10-oct-26;MERPAGOBIPQR;634654003907;1.000\r\n'
    + '08-oct-26;PAGO COTIZACIONES NUE;85436556281100600000000;145.425\r\n'
    + '08-oct-26;MANANTIAL WEBPAY;85436556282100600000000;12.990\r\n'
    + '05-oct-26;Monto Cancelado;0;-3.654.765\r\n'
    + '05-oct-26;TRADOLARPESO;0;152.340\r\n'
    + '30-sept-26;PAYCWPSSAN IGNACIO E;85436556273100400000000;611.676\r\n'
    + '26-sept-26;MERPAGOMERCADOLIBRE 00-06;29974946269806600000000;22.160\r\n'
    + '05-sept-26;MP MERCADOLIBRE CUOTA02-06 Ct;0;1.984\r\n;;;\r\n';
  const r = interpretarMovimientosCsv(csv);
  assert.equal(r.tarjeta, '4321');
  assert.deepEqual(r.periodo, { desde: '2026-09-26', hasta: '2026-10-10' });
  assert.equal(r.gastos.length, 7);
  assert.equal(r.omitidos.length, 1);                    // solo el pago a la tarjeta
  assert.ok(r.gastos.some(g => g.comercio === 'Cotizaciones previsionales'));
  const cuota = r.gastos.find(g => g.tipo === 'cuota');
  assert.deepEqual(cuota.cuota, { n: 2, de: 6 });
  assert.equal(cuota.fechaGasto, '2026-10-10');          // se cobrará en la próxima cartola
  const nueva = r.gastos.find(g => g.monto === 22160);
  assert.equal(nueva.tipo, 'compra');                    // "00-06": compra en cuotas aún no cobrada
  assert.equal(r.gastos.find(g => g.monto === 1000).comercio, 'Bipqr');
  assert.equal(r.gastos.find(g => g.monto === 611676).comercio, 'San Ignacio E');
  assert.equal(r.gastos.find(g => g.monto === 152340).tipo, 'cargo');
});
