import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { Client, type ClientChannel } from 'ssh2';
import type { Logger, SessionManager } from '@cka/core';

export interface TerminalOptions {
  sessions: SessionManager;
  log: Logger;
  driverName: string;
  /** Browsers do not apply CORS to WebSockets, so any page could otherwise open a shell via localhost. */
  allowedOrigins: string[];
}

const CLOSE_UNAVAILABLE = 4004;
const CLOSE_LAB_CHANGED = 4001;
const CLOSE_SSH_ERROR = 4002;
const LIVE_STATES = new Set(['running', 'grading']);

const clampSize = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : fallback;
};

/** WebSocket at /api/terminal/:node that bridges an xterm.js client to an SSH shell on a lab node. */
export function registerTerminal(app: FastifyInstance, opts: TerminalOptions): void {
  const { sessions, log } = opts;

  app.get<{ Params: { node: string }; Querystring: { cols?: string; rows?: string } }>(
    '/api/terminal/:node',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const origin = req.headers.origin;
        if (!origin || !opts.allowedOrigins.includes(origin)) {
          log.warn({ origin, url: req.url }, 'terminal rejected: origin not allowed');
          return reply.status(403).send({ error: 'Origin not allowed.' });
        }
      },
    },
    (socket, req) => {
      const { node } = req.params;
      const say = (text: string) => socket.readyState === socket.OPEN && socket.send(`\r\n\x1b[33m${text}\x1b[0m\r\n`);
      const fail = (code: number, text: string) => {
        say(text);
        socket.close(code, text.slice(0, 120));
      };

      if (opts.driverName !== 'multipass') {
        return fail(CLOSE_UNAVAILABLE, 'The browser terminal needs the Multipass driver.');
      }
      const session = sessions.current();
      if (!session || !LIVE_STATES.has(session.state) || !session.connection) {
        return fail(CLOSE_UNAVAILABLE, 'No running lab to connect to.');
      }
      const target = session.connection.nodes.find((n) => n.name === node);
      if (!target?.ip) return fail(CLOSE_UNAVAILABLE, `Unknown node "${node}".`);

      let privateKey: Buffer;
      try {
        privateKey = readFileSync(session.connection.sshKeyPath);
      } catch {
        return fail(CLOSE_UNAVAILABLE, 'The session SSH key is missing; reset the lab.');
      }

      const opened = Date.now();
      const sessionId = session.id;
      const conn = new Client();
      let size = { cols: clampSize(req.query.cols, 120), rows: clampSize(req.query.rows, 32) };
      let shell: ClientChannel | undefined;
      const pending: Buffer[] = [];

      // Clients send a resize and may type before the shell is open; keep both until then.
      socket.on('message', (msg: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (shell) shell.write(msg);
          else pending.push(msg);
          return;
        }
        try {
          const m = JSON.parse(msg.toString()) as { type?: string; cols?: number; rows?: number };
          if (m.type !== 'resize') return;
          size = { cols: clampSize(m.cols, size.cols), rows: clampSize(m.rows, size.rows) };
          shell?.setWindow(size.rows, size.cols, 0, 0);
        } catch {
          // ignore malformed control messages
        }
      });

      const onChange = () => {
        const s = sessions.current();
        if (!s || s.id !== sessionId || !LIVE_STATES.has(s.state)) {
          fail(CLOSE_LAB_CHANGED, s && s.id === sessionId && s.state === 'provisioning' ? 'Lab is being reset.' : 'Lab session ended.');
        }
      };
      sessions.on('change', onChange);

      socket.on('close', () => {
        sessions.off('change', onChange);
        conn.end();
        log.info({ node, seconds: Math.round((Date.now() - opened) / 1000) }, 'terminal closed');
      });

      conn.on('ready', () => {
        conn.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, stream) => {
          if (err) return fail(CLOSE_SSH_ERROR, `Could not open a shell: ${err.message}`);
          log.info({ node }, 'terminal opened');
          stream.on('data', (d: Buffer) => socket.readyState === socket.OPEN && socket.send(d));
          stream.stderr.on('data', (d: Buffer) => socket.readyState === socket.OPEN && socket.send(d));
          stream.on('close', () => socket.close(1000, 'shell exited'));
          shell = stream;
          for (const chunk of pending.splice(0)) stream.write(chunk);
        });
      });
      conn.on('error', (err) => fail(CLOSE_SSH_ERROR, `SSH to ${node} failed: ${err.message}`));

      conn.connect({
        host: target.ip,
        username: 'ubuntu',
        privateKey,
        // Host keys change with every snapshot restore; the SSH commands shown in the UI skip checking too.
        hostVerifier: () => true,
        keepaliveInterval: 15_000,
        readyTimeout: 15_000,
      });
    },
  );
}
