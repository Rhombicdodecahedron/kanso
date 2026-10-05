// Dev server for a translated repo: static files + POST /log (lines appended to repo/device.log).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '../../repo');
const port = Number(process.argv[3] ?? 8787);
http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/log') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        fs.appendFileSync(path.join(root, 'device.log'), body.trimEnd() + '\n');
        res.end('ok');
      });
      return;
    }
    const file = path.join(root, decodeURIComponent((req.url ?? '/').split('?')[0]));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/javascript');
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
