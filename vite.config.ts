import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_FILE = resolve(__dirname, 'src/data/jawa.json');

// Dev-only endpoint so the in-app editor can write straight back to the JSON file.
// POST /api/save with the full data document as the body.
function saveDataPlugin(): Plugin {
  return {
    name: 'sendit-save-data',
    configureServer(server) {
      server.middlewares.use('/api/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (!json || !Array.isArray(json.sets)) throw new Error('not a data document');
            writeFileSync(DATA_FILE, JSON.stringify(json, null, 2) + '\n');
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, holds: json.sets[0]?.holds?.length ?? 0 }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveDataPlugin()],
});
