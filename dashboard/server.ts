/**
 * Local web dashboard for Sukuna AI persona configuration.
 *
 * The dashboard runs inside the bot process on http://127.0.0.1:3001
 * and allows administrators to configure the AI persona settings.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const DASHBOARD_PORT = 3001;
const DASHBOARD_HOST = '127.0.0.1';

let sukunaActive = false;

export function startDashboard(): void {
  const server = http.createServer(handleRequest);

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log('[Sukuna Dashboard] Listening on http://' + DASHBOARD_HOST + ':' + DASHBOARD_PORT);
  });

  // Handle graceful shutdown
  process.once('SIGTERM', () => server.close(() => {}));
  process.once('SIGINT', () => server.close(() => {}));
}

export function setSukunaActive(active: boolean): void {
  sukunaActive = active;
}

export function isSukunaActive(): boolean {
  return sukunaActive;
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const pathname = req.url?.split('?')[0] || '/';

  try {
    if (pathname === '/' || pathname === '/index.html') {
      const html = await readDashboardHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (pathname === '/styles.css') {
      const css = await readDashboardCss();
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(css);
      return;
    }

    if (pathname === '/app.js') {
      const js = await readDashboardJs();
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(js);
      return;
    }

    if (pathname === '/api/status') {
      const status = {
        sukuna: sukunaActive,
        uptime: process.uptime(),
        totalReplies: 0,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch (error) {
    console.error('[Dashboard] Error handling request:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

async function readDashboardHtml(): Promise<string> {
  const filePath = path.join(process.cwd(), 'dashboard', 'index.html');
  return fs.promises.readFile(filePath, 'utf-8');
}

async function readDashboardCss(): Promise<string> {
  const filePath = path.join(process.cwd(), 'dashboard', 'styles.css');
  return fs.promises.readFile(filePath, 'utf-8');
}

async function readDashboardJs(): Promise<string> {
  const filePath = path.join(process.cwd(), 'dashboard', 'app.js');
  return fs.promises.readFile(filePath, 'utf-8');
}