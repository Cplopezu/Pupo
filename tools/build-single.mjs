// Genera una versión de un solo archivo HTML (CSS y JS en línea) para compartir o publicar como página.
// Uso: node tools/build-single.mjs [salida.html]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = f => readFileSync(join(raiz, f), 'utf8');
const salida = process.argv[2] || join(raiz, 'pupo-gastos.html');

// Orden de dependencias: cada módulo después de lo que importa.
const modulos = ['js/util.js', 'js/db.js', 'js/analisis.js', 'js/charts.js', 'js/ocr.js', 'js/app.js'];
const js = modulos.map(f => `// ---- ${f}\n` + leer(f)
  .replace(/^import[\s\S]*?from\s+'[^']+';[ \t]*\n/gm, '')
  .replace(/^export (?=(async )?(function|const|let|class))/gm, '')
).join('\n');

const html = leer('index.html');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fuentes = [...html.matchAll(/<link[^>]+fonts\.(googleapis|gstatic)[^>]*>/g)].map(m => m[0]).join('\n');
const cuerpo = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script type="module" src="js\/app.js"><\/script>/, '');

writeFileSync(salida, `${title}
${fuentes}
<style>
${leer('css/app.css')}
</style>
${cuerpo}
<script type="module">
${js}
</script>
`);
console.log('Generado:', salida);
