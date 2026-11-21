"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Square, Trash2 } from "lucide-react";
import { AGENT_MODELS, askAgent, loadKey, loadModel, saveKey, saveModel, type AgentModel, type ChatTurn } from "@/lib/agent";

/**
 * Meja AI Analyst satu halaman penuh: baris key + model di atas, percakapan di tengah, contoh
 * pertanyaan dan kolom kirim di bawah. Key Claude milik pengguna disimpan hanya di browser dan
 * permintaan langsung ke Anthropic. Jawaban dirender sebagai teks biasa (tanpa HTML).
 */
export function AnalystDesk({ context, suggestions }: { context: unknown; suggestions: string[] }) {
  const [key, setKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [model, setModel] = useState<AgentModel>("claude-opus-5-5");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setKey(loadKey());
    setModel(loadModel());
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    if (!key) return setError("Simpan API key Claude dulu di baris atas.");
    setError(null);
    setInput("");
    const history: ChatTurn[] = [...turns, { role: "user", text: q }];
    setTurns([...history, { role: "assistant", text: "" }]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      await askAgent({
        apiKey: key,
        model,
        context,
        history,
        signal: abort.current.signal,
        onText: (d) =>
          setTurns((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + d };
            return next;
          }),
      });
    } catch (e) {
      setError((e as Error).message);
      setTurns((prev) => (prev[prev.length - 1]?.text ? prev : prev.slice(0, -1)));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  return (
    <div className="flex h-[640px] flex-col border border-line bg-panel/70 md:h-[680px]">
      {/* baris key + model */}
      <form
        className="flex flex-wrap items-center gap-2 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (key) {
            saveKey("");
            setKey("");
            setTurns([]);
            return;
          }
          const k = draftKey.trim();
          if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return setError("Format API key tidak dikenali (biasanya diawali sk-ant-).");
          saveKey(k);
          setKey(k);
          setDraftKey("");
          setError(null);
        }}
      >
        <span className="rounded-md border border-line-2 bg-bg px-3 py-2 text-xs text-soft">Claude</span>
        <input
          type="password"
          autoComplete="off"
          value={key ? "••••••••••••••••••••" : draftKey}
          readOnly={!!key}
          onChange={(e) => setDraftKey(e.target.value)}
          placeholder="Your Claude API key (sk-ant-…)"
          className="min-w-0 flex-1 rounded-md border border-line-2 bg-bg px-3 py-2 text-xs text-fg outline-none focus:border-primary"
        />
        <select
          value={model}
          onChange={(e) => {
            const m = e.target.value as AgentModel;
            setModel(m);
            saveModel(m);
          }}
          className="rounded-md border border-line-2 bg-bg px-2 py-2 text-xs text-soft"
          aria-label="Model"
        >
          {AGENT_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.note}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-line-2 bg-panel-2 px-4 py-2 text-xs font-medium text-fg hover:border-primary">{key ? "Remove key" : "Save key"}</button>
      </form>
      <div className="border-b border-line px-3 py-2 text-[11px] text-muted">Key disimpan hanya di browser ini; permintaan dikirim langsung ke Anthropic. Pemakaian ditagih ke akun Anthropic kamu.</div>

      {/* percakapan */}
      <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {!turns.length && <p className="text-center text-xs text-muted">Agent hanya menjelaskan data; ia tidak membeli, menjual, atau memberi saran investasi.</p>}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-auto max-w-[80%] rounded-lg bg-primary/15 px-3 py-2 text-fg" : "max-w-[92%] whitespace-pre-wrap leading-relaxed text-soft"}>
            {t.text || (busy && i === turns.length - 1 ? <span className="animate-pulse text-muted">Menganalisis…</span> : null)}
          </div>
        ))}
        {error && <div className="text-xs text-down">{error}</div>}
        <div ref={bottom} />
      </div>

      {/* contoh pertanyaan + kirim */}
      {!turns.length && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="border border-line-2 bg-bg px-3 py-1.5 text-left text-xs text-soft hover:border-primary hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Ask about any token, wallet or the market…"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-line-2 bg-bg px-3 py-2.5 text-sm text-fg outline-none focus:border-primary"
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} className="flex h-10 items-center gap-1.5 rounded-md border border-line-2 px-4 text-sm text-muted hover:text-fg">
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-ink disabled:opacity-40" disabled={!input.trim()}>
            <Send size={13} /> Send
          </button>
        )}
        {!!turns.length && !busy && (
          <button type="button" onClick={() => setTurns([])} className="grid h-10 w-10 place-items-center rounded-md border border-line-2 text-muted hover:text-fg" aria-label="Percakapan baru">
            <Trash2 size={14} />
          </button>
        )}
      </form>
    </div>
  );
}
