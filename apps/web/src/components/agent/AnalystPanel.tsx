"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, KeyRound, Send, Square, Trash2 } from "lucide-react";
import { AGENT_MODELS, askAgent, loadKey, loadModel, saveKey, saveModel, type AgentModel, type ChatTurn } from "@/lib/agent";

/**
 * Panel chat AI Analyst. `context` = data pasar yang dibaca agent (dikirim ke Anthropic bersama
 * pertanyaan). Teks jawaban ditampilkan sebagai teks biasa (tanpa HTML), jadi aman dari injeksi markup.
 */
export function AnalystPanel({ context, suggestions, title = "AI Analyst", compact = false }: { context: unknown; suggestions: string[]; title?: string; compact?: boolean }) {
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
    if (!q || busy || !key) return;
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

  const modelPicker = (
    <select
      value={model}
      onChange={(e) => {
        const m = e.target.value as AgentModel;
        setModel(m);
        saveModel(m);
      }}
      className="rounded-md border border-line-2 bg-panel px-2 py-1 text-xs text-soft"
      aria-label="Model"
    >
      {AGENT_MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label} · {m.note}
        </option>
      ))}
    </select>
  );

  return (
    <div className={`flex h-full min-h-[420px] flex-col ${compact ? "" : "rounded-xl border border-line bg-panel/60"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/20 text-primary">
          <Bot size={15} />
        </span>
        <span className="font-medium text-fg">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          {modelPicker}
          {key && (
            <button
              onClick={() => {
                saveKey("");
                setKey("");
                setTurns([]);
              }}
              className="flex items-center gap-1 rounded-md border border-line-2 px-2 py-1 text-xs text-muted hover:text-fg"
              title="Hapus API key dari browser ini"
            >
              <KeyRound size={12} /> Hapus key
            </button>
          )}
        </div>
      </div>

      {!key ? (
        <form
          className="m-auto w-full max-w-md space-y-3 p-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const k = draftKey.trim();
            if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) return setError("Format API key tidak dikenali (biasanya diawali sk-ant-).");
            saveKey(k);
            setKey(k);
            setDraftKey("");
            setError(null);
          }}
        >
          <div className="text-fg">Pakai API key Claude milikmu</div>
          <p className="text-xs text-muted">
            Key disimpan hanya di browser ini dan permintaan dikirim langsung ke Anthropic, tidak lewat server kami. Pemakaian ditagih ke akun Anthropic kamu. Buat key di console.anthropic.com.
          </p>
          <input
            type="password"
            autoComplete="off"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full rounded-md border border-line-2 bg-bg px-3 py-2 text-fg outline-none focus:border-primary"
          />
          <button className="w-full rounded-md bg-primary py-2 font-medium text-ink">Simpan key</button>
          {error && <div className="text-xs text-down">{error}</div>}
        </form>
      ) : (
        <>
          <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {!turns.length && (
              <div className="space-y-2">
                <p className="text-xs text-muted">Tanyakan apa saja tentang data di halaman ini. Agent hanya menjelaskan; ia tidak bisa membeli atau menjual.</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-line-2 px-3 py-1.5 text-left text-xs text-soft hover:border-primary hover:text-fg">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-primary/20 px-3 py-2 text-fg" : "max-w-[95%] whitespace-pre-wrap text-soft"}>
                {t.text || (busy && i === turns.length - 1 ? <span className="animate-pulse text-muted">Menganalisis…</span> : null)}
              </div>
            ))}
            {error && <div className="text-xs text-down">{error}</div>}
            <div ref={bottom} />
          </div>
          <form
            className="flex items-end gap-2 border-t border-line p-2"
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
              placeholder="Tanya agent…"
              className="max-h-32 min-h-[38px] flex-1 resize-none rounded-md border border-line-2 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} className="grid h-[38px] w-[38px] place-items-center rounded-md border border-line-2 text-muted hover:text-fg" aria-label="Stop">
                <Square size={14} />
              </button>
            ) : (
              <button className="grid h-[38px] w-[38px] place-items-center rounded-md bg-primary text-ink disabled:opacity-40" disabled={!input.trim()} aria-label="Kirim">
                <Send size={14} />
              </button>
            )}
            {!!turns.length && !busy && (
              <button type="button" onClick={() => setTurns([])} className="grid h-[38px] w-[38px] place-items-center rounded-md border border-line-2 text-muted hover:text-fg" aria-label="Percakapan baru">
                <Trash2 size={14} />
              </button>
            )}
          </form>
          <div className="px-3 pb-2 text-[10px] text-muted">Bukan saran investasi. Data pasar dari pihak ketiga dan bisa terlambat.</div>
        </>
      )}
    </div>
  );
}
