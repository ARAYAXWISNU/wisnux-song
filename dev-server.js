import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Emulate Vercel response helper methods
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  res.send = (body) => {
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    } else {
      res.end(body);
    }
  };

  // Populate req.query
  req.query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    req.query[key] = value;
  }

  // Handle API route - import as ESM with cache-busting
  if (pathname === '/api/tiktok') {
    try {
      const tiktokFilePath = path.join(__dirname, 'api', 'tiktok.js');
      const tiktokPath = pathToFileURL(tiktokFilePath).href + `?t=${Date.now()}`;
      const { default: handler } = await import(tiktokPath);
      await handler(req, res);
    } catch (err) {
      console.error('API Error:', err);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  // Handle static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html', '.js': 'application/javascript',
      '.json': 'application/json', '.css': 'text/css',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });
}).listen(PORT, () => {
  console.log(`Development server running at http://localhost:${PORT}`);
});
