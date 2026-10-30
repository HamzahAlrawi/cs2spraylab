import {build} from 'vite';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative, extname} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'node_modules/.cache/prefire-map-switch-browser');
await build({configFile: resolve(root, 'tests/prefire-map-switch.vite.config.ts'), logLevel: 'warn',
  build: {outDir: output, minify: false, rollupOptions: {input: resolve(root, 'tests/prefire-map-switch-host.html')}}});
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
createServer(async (request, response) => {
  try {
    const path = resolve(output, `.${decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)}`);
    if (relative(output, path).startsWith('..')) {response.writeHead(403).end(); return;}
    const bytes = await readFile(path);
    response.writeHead(200, {'Content-Type': mime[extname(path)] ?? 'application/octet-stream'}).end(bytes);
  } catch {response.writeHead(404).end();}
}).listen(5198, '127.0.0.1');
