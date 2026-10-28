import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionView } from '@cka/schema';
import { terminalUrl } from '../api';

type Status = { kind: 'connecting' } | { kind: 'connected' } | { kind: 'closed'; reason: string };

const theme = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  selectionBackground: '#3f3f46',
  black: '#18181b',
  brightBlack: '#52525b',
};

function NodeTerminal({ node, visible, onConnected }: { node: string; visible: boolean; onConnected: (on: boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const [attempt, setAttempt] = useState(0);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const fit = () => {
    const host = hostRef.current;
    if (!host || host.offsetWidth === 0 || !fitRef.current || !termRef.current) return;
    fitRef.current.fit();
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: termRef.current.cols, rows: termRef.current.rows }));
    }
  };

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(hostRef.current!);
    termRef.current = term;
    fitRef.current = fitAddon;
    const encoder = new TextEncoder();
    const input = term.onData((d) => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(encoder.encode(d));
    });
    // Dragging the split resizes on every pointer move; refit at most once per frame.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(hostRef.current!);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current!;
    fit();
    setStatus({ kind: 'connecting' });
    const ws = new WebSocket(terminalUrl(node, term.cols, term.rows));
    ws.binaryType = 'arraybuffer';
    socketRef.current = ws;
    ws.onopen = () => {
      setStatus({ kind: 'connected' });
      onConnectedRef.current(true);
      fit();
      term.focus();
    };
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer));
    ws.onclose = (e) => {
      onConnectedRef.current(false);
      setStatus({ kind: 'closed', reason: e.reason || (e.code === 1006 ? 'connection lost' : `closed (${e.code})`) });
    };
    return () => {
      ws.onclose = null;
      ws.close();
      onConnectedRef.current(false);
    };
  }, [node, attempt]);

  useEffect(() => {
    if (visible) {
      fit();
      termRef.current?.focus();
    }
  }, [visible]);

  return (
    <div className={visible ? 'flex h-full flex-col' : 'hidden'}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1 text-xs">
        <span
          className={
            status.kind === 'connected' ? 'text-emerald-400' : status.kind === 'connecting' ? 'text-amber-300' : 'text-zinc-500'
          }
        >
          {status.kind === 'closed' ? `disconnected: ${status.reason}` : status.kind}
        </span>
        {status.kind === 'closed' && (
          <button className="text-sky-400 hover:text-sky-300" onClick={() => setAttempt((a) => a + 1)}>
            Reconnect
          </button>
        )}
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-zinc-950 p-1" />
    </div>
  );
}

/** Browser terminal with one SSH tab per lab node, filling its container. Tabs connect when first opened and stay alive while hidden. */
export function TerminalPanel({
  session,
  actions,
}: {
  session: SessionView;
  /** Session controls shown at the right of the tab bar. */
  actions?: ReactNode;
}) {
  const nodes = session.connection?.nodes.map((n) => n.name) ?? [];
  const [active, setActive] = useState(nodes.includes('controlplane') ? 'controlplane' : nodes[0]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(active ? [active] : []));
  const [connected, setConnected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (connected.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [connected.size]);

  if (!active) return null;

  const select = (n: string) => {
    setActive(n);
    setOpened((s) => new Set(s).add(n));
  };
  const markConnected = (n: string) => (on: boolean) =>
    setConnected((s) => {
      if (s.has(n) === on) return s;
      const next = new Set(s);
      if (on) next.add(n);
      else next.delete(n);
      return next;
    });

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <header className="flex items-center gap-1 overflow-x-auto border-b border-zinc-800 px-2 py-1.5">
        <h2 className="mr-2 shrink-0 px-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase">Terminal</h2>
        {nodes.map((n) => (
          <button
            key={n}
            onClick={() => select(n)}
            className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs whitespace-nowrap transition ${
              n === active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            }`}
          >
            {connected.has(n) && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />}
            {n}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {nodes
          .filter((n) => opened.has(n))
          .map((n) => (
            <NodeTerminal key={n} node={n} visible={n === active} onConnected={markConnected(n)} />
          ))}
      </div>
    </section>
  );
}
