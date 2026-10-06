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
  const r = interpretar(txt);
  assert.equal(r.monto, 3540);
  assert.equal(r.fecha, '2026-10-03');
  assert.equal(r.rut, '76.543.210-K');
  assert.equal(r.folio, '4587123');
  assert.equal(r.comercio, 'SUPERMERCADO EL ALBA');
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
