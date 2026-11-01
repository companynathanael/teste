#!/usr/bin/env node
/* =========================================================
   Asafe · Servidor de linhas (opcional)
   Node 18+, sem dependências.   node server/asafe-server.js
   Usa o mesmo roteador da página do Asafe (sdk/asafe-router.js).

   GET  /status            estado do servidor + agentes
   GET  /stream?agent=id   SSE: envelopes destinados ao agente
   POST /send              envia um envelope (roteado pelas linhas)
   GET  /observe           SSE: tráfego para a interface do Asafe
   POST /topology          a interface do Asafe publica IAs e linhas
   ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRouter, VERSION, CORE } = require('../sdk/asafe-router.js');

const PORT = Number(process.env.ASAFE_PORT || 7300);
const HOST = process.env.ASAFE_HOST || '127.0.0.1';
const DATA = process.env.ASAFE_DATA || path.join(__dirname, 'data');
const TOPO_FILE = path.join(DATA, 'topology.json');
fs.mkdirSync(path.join(DATA, 'logs'), { recursive: true });

let topology = { agents: [], links: [] };
try { topology = JSON.parse(fs.readFileSync(TOPO_FILE, 'utf8')); } catch (e) { /* ainda não publicada */ }

const streams = new Map(); // agentId -> Set<res>
const observers = new Set();

function sse(res, data) { res.write(`data: ${JSON.stringify(data)}\n\n`); }

function log(agentId, env) {
  if (!agentId || agentId === CORE || env.type === 'progress') return;
  const line = JSON.stringify({ ts: env.ts, type: env.type, from: env.from, to: env.to, action: env.action, ok: env.ok, payload: env.payload, error: env.error }) + '\n';
  fs.appendFile(path.join(DATA, 'logs', agentId.replace(/[^a-z0-9-]/g, '') + '.jsonl'), line, () => {});
}

const router = createRouter({
  topology: () => topology,
  deliver(env) {
    for (const res of streams.get(env.to) || []) sse(res, env);
  },
  onTraffic(env, info) {
    if (info.status === 'ok' || info.status === 'error') { log(env.from, env); log(env.to, env); }
    for (const res of observers) sse(res, { kind: 'traffic', env, info, roster: router.roster() });
  }
});

function presence() {
  for (const res of observers) sse(res, { kind: 'presence', roster: router.roster() });
}

setInterval(() => {
  if (router.sweep(16000)) presence();
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
  for (const res of observers) res.write(': ping\n\n');
}, 5000);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 4 * 1024 * 1024) { reject(new Error('corpo grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  });
}

function openStream(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      return json(res, 200, { asafe: VERSION, name: 'asafe', topology: { agents: topology.agents.length, links: topology.links.length }, agents: router.roster() });
    }

    if (req.method === 'GET' && url.pathname === '/stream') {
      const id = url.searchParams.get('agent');
      if (!id) return json(res, 400, { ok: false, message: 'informe ?agent=' });
      openStream(req, res);
      if (!streams.has(id)) streams.set(id, new Set());
      streams.get(id).add(res);
      req.on('close', () => {
        const set = streams.get(id);
        set.delete(res);
        if (!set.size) { streams.delete(id); router.online.delete(id); presence(); }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/send') {
      const env = await readBody(req);
      const result = router.route(env);
      if (env.type === 'hello') presence();
      return json(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/observe') {
      openStream(req, res);
      observers.add(res);
      sse(res, { kind: 'presence', roster: router.roster() });
      req.on('close', () => observers.delete(res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/topology') {
      const t = await readBody(req);
      if (!Array.isArray(t.agents) || !Array.isArray(t.links)) return json(res, 400, { ok: false, message: 'topologia inválida' });
      topology = { agents: t.agents, links: t.links };
      fs.writeFile(TOPO_FILE, JSON.stringify(topology, null, 2), () => {});
      presence();
      return json(res, 200, { ok: true });
    }

    json(res, 404, { ok: false, message: 'rota inexistente' });
  } catch (e) {
    json(res, 400, { ok: false, message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ▲ Asafe online em http://${HOST}:${PORT}`);
  console.log(`  ${topology.agents.length} IAs · ${topology.links.length} linhas (abra a interface do Asafe para publicar a topologia)\n`);
});
