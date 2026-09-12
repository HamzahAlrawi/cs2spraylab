import net from 'node:net';
import fs from 'node:fs';
const file = process.argv[2];
const command = file ? { type: 'execute_code', params: { code: `SPRAYLAB_ROOT = ${JSON.stringify(process.cwd().replaceAll('\\', '/'))}\n` + fs.readFileSync(file, 'utf8') } } : { type: 'get_scene_info', params: {} };
const socket = net.connect(9876, '127.0.0.1', () => socket.write(JSON.stringify(command)));
let buffer = '';
socket.setTimeout(180000, () => { console.error('Blender command timed out'); socket.destroy(); process.exitCode = 1; });
socket.on('error', error => { console.error(error); process.exitCode = 1; });
socket.on('data', data => {
  buffer += data;
  let response;
  try { response = JSON.parse(buffer); } catch { return; }
  fs.mkdirSync('research', { recursive: true });
  fs.writeFileSync('research/blender-last-result.json', JSON.stringify(response));
  const output = response.result?.result;
  console.log(typeof output === 'string' ? output.split('\n').filter(line => /EXPORTED|Error|Traceback|Saved as|components|BOUNDS/.test(line)).join('\n') || output.slice(-6000) : JSON.stringify(response));
  socket.end();
  if (response.status === 'error') process.exitCode = 1;
});
