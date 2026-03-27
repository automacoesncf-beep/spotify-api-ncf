// src/features/schadule/pages/Schadule.tsx
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  apiGetSchedule,
  apiReloadSchedule,
  apiSaveSchedule,
  apiSearchPlaylist,
  apiSearchTrack,
  apiSearchArtist,
  apiGetArtistAlbums,
  apiGetRadioState,
  type ScheduleItem,
  type SpotifyPlaylistLite,
  type SpotifyTrackLite,
  type SpotifyAlbumLite,
  type RepeatMode,
  type ScheduleMode,
} from "../api/scheduleApi";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function makeId() {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cronToTime(cron: string) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  const min = parts[0] ?? "0";
  const hour = parts[1] ?? "0";
  const hh = String(hour).padStart(2, "0");
  const mm = String(min).padStart(2, "0");
  return `${hh}:${mm}`;
}

function timeToCron(time: string, oldCron: string) {
  const [hh = "00", mm = "00"] = String(time ?? "00:00").split(":");
  const parts = String(oldCron ?? "0 0 * * *").trim().split(/\s+/);
  while (parts.length < 5) parts.push("*");
  parts[0] = String(Number(mm));
  parts[1] = String(Number(hh));
  return parts.join(" ");
}

function nowPlusMinutes(mins: number) {
  const d = new Date(Date.now() + mins * 60_000);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

type Mode = "playlist" | "track" | "album";
type Row = ScheduleItem & { time: string };

function defaultModeForKind(kind?: string): ScheduleMode {
  return kind === "track" ? "break" : "switch";
}
function defaultRepeatForMode(mode?: ScheduleMode): RepeatMode {
  return mode === "break" ? "off" : "context";
}
function isBreak(mode?: ScheduleMode) {
  return (mode ?? "switch") === "break";
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "indigo" | "emerald" | "amber" | "rose";
}) {
  const cls =
    tone === "indigo"
      ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
      : tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : tone === "amber"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : tone === "rose"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : "bg-zinc-50 text-zinc-700 ring-zinc-200";

  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1", cls)}>
      {children}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx("inline-flex items-center", disabled && "opacity-60 cursor-not-allowed")}>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={cx(
          "relative h-6 w-11 rounded-full ring-1 ring-zinc-200 bg-zinc-200 transition",
          "peer-checked:bg-indigo-600",
          "peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300"
        )}
      >
        <div
          className={cx(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
            "peer-checked:translate-x-5"
          )}
        />
      </div>
    </label>
  );
}

function Button({
  children,
  variant = "secondary",
  disabled,
  onClick,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed";
  const cls =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-700"
      : variant === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : variant === "ghost"
      ? "bg-transparent text-zinc-700 hover:bg-zinc-100"
      : "bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50";

  return (
    <button className={cx(base, cls)} disabled={disabled} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-zinc-200 p-3">
      <div className="text-[11px] font-semibold text-zinc-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default function Schadule() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Quick add
  const [mode, setMode] = useState<Mode>("playlist");
  const [q, setQ] = useState("");
  const [quickTime, setQuickTime] = useState(() => nowPlusMinutes(2));
  const [breakMs, setBreakMs] = useState<number>(90000);

  const [playlistResults, setPlaylistResults] = useState<SpotifyPlaylistLite[]>([]);
  const [trackResults, setTrackResults] = useState<SpotifyTrackLite[]>([]);
  const [albumResults, setAlbumResults] = useState<SpotifyAlbumLite[]>([]);

  // debug rádio
  const [radioOpen, setRadioOpen] = useState(false);
  const [radioStateText, setRadioStateText] = useState<string>("");

  // ✅ novo: expandir detalhes por linha (resolve “não cabe tudo”)
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});

  function toggleDetails(id: string) {
    setOpenDetails((p) => ({ ...p, [id]: !p[id] }));
  }

  function updateItem(id: string, patch: Partial<ScheduleItem> | ((prev: ScheduleItem) => ScheduleItem)) {
    setItems((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x;
        if (typeof patch === "function") return patch(x);
        return { ...x, ...patch };
      })
    );
  }

  async function load() {
    setLoading(true);
    setMsg("");
    try {
      const r = await apiGetSchedule();
      setItems(r.items ?? []);
    } catch (e) {
      console.log(e);
      setMsg("Falha ao carregar schedule.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows: Row[] = useMemo(() => {
    return (items ?? []).map((it) => {
      const inferredMode: ScheduleMode = (it.mode as any) ?? defaultModeForKind(it.kind);
      const inferredRepeat: RepeatMode = (it.repeat as any) ?? defaultRepeatForMode(inferredMode);

      return {
        ...it,
        time: cronToTime(it.cron),

        enabled: it.enabled ?? true,
        mode: inferredMode,
        remember: it.remember ?? true,
        resume: it.resume ?? (inferredMode === "break"),
        repeat: inferredRepeat,

        shuffle:
          typeof it.shuffle === "boolean"
            ? it.shuffle
            : inferredMode === "switch" && (it.kind === "playlist" || it.kind === "album")
            ? true
            : false,

        startFromBeginning:
          typeof it.startFromBeginning === "boolean"
            ? it.startFromBeginning
            : inferredMode === "break"
            ? true
            : false,
      };
    });
  }, [items]);

  function addRowManual() {
    setItems((prev) => [
      ...prev,
      {
        id: makeId(),
        cron: "0 8 * * *",
        uri: "",
        title: "Novo item",
        enabled: true,

        kind: "playlist",
        mode: "switch",
        remember: true,
        resume: false,
        repeat: "context",

        shuffle: true,
        startFromBeginning: false,
      },
    ]);
  }

  function addFromSearch(payload: {
    kind: Mode;
    title: string;
    uri: string;
    imageUrl?: string;
    subtitle?: string;
  }) {
    const cron = timeToCron(quickTime, "0 0 * * *");

    const inferredMode: ScheduleMode = payload.kind === "track" ? "break" : "switch";
    const inferredRepeat: RepeatMode = inferredMode === "break" ? "off" : "context";

    const id = makeId();

    setItems((prev) => [
      ...prev,
      {
        id,
        cron,
        uri: payload.uri,
        title: payload.title,
        enabled: true,
        kind: payload.kind,
        imageUrl: payload.imageUrl,
        subtitle: payload.subtitle,

        mode: inferredMode,
        remember: true,
        resume: inferredMode === "break",
        resumeAfterMs: inferredMode === "break" ? Number(breakMs || 0) : undefined,
        repeat: inferredRepeat,

        shuffle: inferredMode === "switch" && payload.kind === "playlist",
        startFromBeginning: inferredMode === "break" ? true : false,
      },
    ]);

    // abre detalhes automaticamente quando for break (fica mais prático ajustar resumeAfterMs)
    if (inferredMode === "break") setOpenDetails((p) => ({ ...p, [id]: true }));

    const [hh, mm] = quickTime.split(":").map(Number);
    const d = new Date();
    d.setHours(hh);
    d.setMinutes(mm + 1);
    setQuickTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
  }

  async function runSearch() {
    const term = q.trim();
    if (!term) return;

    setLoading(true);
    setMsg("");
    setPlaylistResults([]);
    setTrackResults([]);
    setAlbumResults([]);

    try {
      if (mode === "playlist") {
        const r = await apiSearchPlaylist(term);
        setPlaylistResults(r.items ?? []);
      }
      if (mode === "track") {
        const r = await apiSearchTrack(term);
        setTrackResults(r.items ?? []);
      }
      if (mode === "album") {
        const r1 = await apiSearchArtist(term);
        const artistId = r1.artist?.id;
        if (!artistId) setMsg("Nenhum artista encontrado.");
        else {
          const r2 = await apiGetArtistAlbums(artistId);
          setAlbumResults(r2.items ?? []);
        }
      }
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao buscar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setLoading(true);
    setMsg("");
    try {
      const r = await apiSaveSchedule(items);
      setMsg(`Salvo! Itens: ${r.count}`);
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao salvar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  async function saveAndReload() {
    setLoading(true);
    setMsg("");
    try {
      await apiSaveSchedule(items);
      const r = await apiReloadSchedule();
      setMsg(`Salvo e recarregado. Jobs: ${r.tasks}`);
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao salvar/recarregar: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadRadioState() {
    setLoading(true);
    setMsg("");
    try {
      const r = await apiGetRadioState();
      setRadioStateText(JSON.stringify(r.state, null, 2));
      setRadioOpen(true);
    } catch (e: any) {
      console.log(e);
      setMsg(`Falha ao buscar rádio state: ${e?.message ?? "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  const headerPill = loading ? (
    <Badge tone="amber">Carregando…</Badge>
  ) : msg ? (
    <Badge tone={msg.toLowerCase().includes("falha") ? "rose" : "emerald"}>{msg}</Badge>
  ) : (
    <Badge>Pronto</Badge>
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 px-4 md:px-6 py-6">
      <div className="mx-auto w-full max-w-screen-2xl space-y-5">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Schadule</h1>
              {headerPill}
            </div>
            <p className="text-sm text-zinc-600">
              Programação estilo rádio: <b>switch</b> (programa) + <b>break</b> (vinheta com retorno).
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={load} disabled={loading}>
              Atualizar
            </Button>
            <Button variant="secondary" onClick={loadRadioState} disabled={loading}>
              Rádio state
            </Button>
            <Button variant="secondary" onClick={addRowManual}>
              + Manual
            </Button>
            <Button variant="secondary" onClick={save} disabled={loading}>
              Salvar
            </Button>
            <Button variant="primary" onClick={saveAndReload} disabled={loading}>
              Salvar e Recarregar
            </Button>
          </div>
        </div>

        {/* Debug drawer */}
        {radioOpen ? (
          <div className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-50">
              <div className="text-sm font-semibold text-zinc-800">Rádio State (debug)</div>
              <Button variant="ghost" onClick={() => setRadioOpen(false)}>
                Fechar
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto p-4 text-xs bg-white">{radioStateText || "(vazio)"}</pre>
          </div>
        ) : null}

        {/* Quick add */}
        <div className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
          <div className="p-4 md:p-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-zinc-900">Adicionar rápido</div>
                <div className="text-xs text-zinc-600">
                  Pesquise e adicione direto no agendador (com defaults inteligentes).
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 rounded-xl bg-zinc-50 ring-1 ring-zinc-200 px-3 py-2">
                  <span className="text-xs font-semibold text-zinc-700">Vinheta</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={breakMs}
                    onChange={(e) => setBreakMs(Number(e.target.value))}
                    className="w-28 bg-transparent outline-none text-sm font-semibold text-zinc-900"
                  />
                  <span className="text-xs text-zinc-500">ms</span>
                </div>

                <div className="flex items-center gap-2 rounded-xl bg-zinc-50 ring-1 ring-zinc-200 px-3 py-2">
                  <span className="text-xs font-semibold text-zinc-700">Horário</span>
                  <input
                    type="time"
                    value={quickTime}
                    onChange={(e) => setQuickTime(e.target.value)}
                    className="bg-transparent outline-none text-sm font-semibold text-zinc-900"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {(["playlist", "track", "album"] as Mode[]).map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    className={cx(
                      "px-3 py-2 rounded-xl text-sm font-semibold ring-1 transition",
                      active
                        ? "bg-zinc-900 text-white ring-zinc-900"
                        : "bg-white text-zinc-800 ring-zinc-200 hover:bg-zinc-50"
                    )}
                    onClick={() => setMode(m)}
                  >
                    {m === "playlist" ? "Playlists" : m === "track" ? "Músicas" : "Álbuns (por artista)"}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2 rounded-2xl ring-1 ring-zinc-200 bg-white px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-300">
                  <span className="text-xs font-semibold text-zinc-500">Buscar</span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder={mode === "album" ? "Digite o nome do artista..." : "Digite para buscar..."}
                    className="w-full outline-none text-sm text-zinc-900 placeholder:text-zinc-400"
                  />
                </div>
              </div>

              <Button variant="primary" onClick={runSearch} disabled={loading}>
                Buscar
              </Button>
            </div>
          </div>

          {/* Results */}
          <div className="border-t border-zinc-200 bg-zinc-50 p-4 md:p-5">
            {mode === "playlist" && playlistResults.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {playlistResults.map((p) => {
                  const img = p.images?.[0]?.url;
                  return (
                    <div key={p.id} className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
                      <div className="p-3 flex gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-200 overflow-hidden shrink-0 ring-1 ring-zinc-200">
                          {img ? <img src={img} alt={p.name} className="w-16 h-16 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-zinc-900 truncate">{p.name}</div>
                            <Badge tone="indigo">switch</Badge>
                          </div>
                          <div className="text-xs text-zinc-600 truncate">
                            {p.owner?.display_name ? `por ${p.owner.display_name}` : ""}
                          </div>
                          <div className="mt-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                addFromSearch({
                                  kind: "playlist",
                                  title: p.name,
                                  uri: p.uri,
                                  imageUrl: img,
                                  subtitle: p.owner?.display_name ? `por ${p.owner.display_name}` : "",
                                })
                              }
                            >
                              Adicionar
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mode === "track" && trackResults.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {trackResults.map((t) => {
                  const img = t.album?.images?.[0]?.url;
                  const subtitle = `${t.artists?.map((a) => a.name).join(", ") ?? ""} • ${t.album?.name ?? ""}`;
                  return (
                    <div key={t.id} className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
                      <div className="p-3 flex gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-200 overflow-hidden shrink-0 ring-1 ring-zinc-200">
                          {img ? <img src={img} alt={t.name} className="w-16 h-16 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-zinc-900 truncate">{t.name}</div>
                            <Badge tone="amber">break</Badge>
                          </div>
                          <div className="text-xs text-zinc-600 truncate">{subtitle}</div>
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                addFromSearch({
                                  kind: "track",
                                  title: t.name,
                                  uri: t.uri,
                                  imageUrl: img,
                                  subtitle,
                                })
                              }
                            >
                              Adicionar (vinheta)
                            </Button>
                            <span className="text-xs text-zinc-500">{breakMs}ms</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mode === "album" && albumResults.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {albumResults.map((a) => {
                  const img = a.images?.[0]?.url;
                  return (
                    <div key={a.id} className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
                      <div className="p-3 flex gap-3">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-200 overflow-hidden shrink-0 ring-1 ring-zinc-200">
                          {img ? <img src={img} alt={a.name} className="w-16 h-16 object-cover" /> : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-zinc-900 truncate">{a.name}</div>
                            <Badge tone="indigo">switch</Badge>
                          </div>
                          <div className="text-xs text-zinc-600 truncate">{a.release_date ?? ""}</div>
                          <div className="mt-2">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                addFromSearch({
                                  kind: "album",
                                  title: a.name,
                                  uri: a.uri,
                                  imageUrl: img,
                                  subtitle: a.release_date ?? "",
                                })
                              }
                            >
                              Adicionar
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {mode !== "album" && !playlistResults.length && !trackResults.length ? (
              <div className="text-sm text-zinc-600">Nenhum resultado ainda. Faça uma busca acima.</div>
            ) : null}

            {mode === "album" && !albumResults.length ? (
              <div className="text-sm text-zinc-600">Nenhum álbum ainda. Busque um artista acima.</div>
            ) : null}
          </div>
        </div>

        {/* Agenda (compacta + detalhes) */}
        <div className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm overflow-hidden">
          <div className="px-4 md:px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-zinc-900">Agenda</div>
              <div className="text-xs text-zinc-600">
                Não cabe tudo em uma linha? Use <b>Detalhes</b> para abrir as opções avançadas.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge tone="indigo">{rows.filter((r) => (r.mode ?? "switch") === "switch").length} switch</Badge>
              <Badge tone="amber">{rows.filter((r) => (r.mode ?? "switch") === "break").length} break</Badge>
              <Badge>{rows.length} itens</Badge>
            </div>
          </div>

          <div className="border-t border-zinc-200 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white border-b">
                <tr className="text-left text-zinc-600">
                  <th className="py-3 px-3 w-[90px]">Ativo</th>
                  <th className="py-3 px-3 w-[120px]">Hora</th>
                  <th className="py-3 px-3">Item</th>
                  <th className="py-3 px-3 w-[140px]">Modo</th>
                  <th className="py-3 px-3 w-[120px] text-right">Ações</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, idx) => {
                  const rowIsBreak = isBreak(row.mode);
                  const tone = rowIsBreak ? "amber" : "indigo";
                  const open = !!openDetails[row.id];

                  return (
                    <>
                      <tr key={row.id} className={cx("border-b align-top", idx % 2 ? "bg-zinc-50/60" : "bg-white")}>
                        <td className="py-3 px-3">
                          <Toggle checked={row.enabled ?? true} onChange={(v) => updateItem(row.id, { enabled: v })} />
                        </td>

                        <td className="py-3 px-3">
                          <input
                            type="time"
                            value={row.time}
                            className="rounded-xl ring-1 ring-zinc-200 px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-300"
                            onChange={(e) => updateItem(row.id, { cron: timeToCron(e.target.value, row.cron) })}
                          />
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-zinc-200 overflow-hidden ring-1 ring-zinc-200 shrink-0">
                              {row.imageUrl ? (
                                <img src={row.imageUrl} alt="capa" className="w-10 h-10 object-cover" />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <input
                                  value={row.title ?? ""}
                                  className="w-full max-w-[520px] rounded-xl ring-1 ring-zinc-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                                  placeholder="Título"
                                  onChange={(e) => updateItem(row.id, { title: e.target.value })}
                                />
                                <Badge tone={tone as any}>{rowIsBreak ? "break" : "switch"}</Badge>
                              </div>

                              {row.subtitle ? (
                                <div className="mt-1 text-xs text-zinc-500 truncate">{row.subtitle}</div>
                              ) : null}

                              <div className="mt-2">
                                <input
                                  value={row.uri ?? ""}
                                  placeholder="spotify:... OU https://open.spotify.com/..."
                                  className="w-full max-w-[720px] rounded-xl ring-1 ring-zinc-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-300"
                                  onChange={(e) => updateItem(row.id, { uri: e.target.value })}
                                />
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <select
                            className="w-full rounded-xl ring-1 ring-zinc-200 px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-300"
                            value={(row.mode ?? "switch") as any}
                            onChange={(e) => {
                              const m = e.target.value as ScheduleMode;
                              updateItem(row.id, (prev) => ({
                                ...prev,
                                mode: m,
                                repeat: (prev.repeat ?? defaultRepeatForMode(m)) as any,
                                resume: m === "break" ? (prev.resume ?? true) : false,
                                resumeAfterMs: m === "break" ? prev.resumeAfterMs : undefined,
                                startFromBeginning: m === "break" ? true : (prev.startFromBeginning ?? false),
                              }));
                            }}
                          >
                            <option value="switch">switch (rádio)</option>
                            <option value="break">break (vinheta)</option>
                          </select>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => toggleDetails(row.id)}
                              title="Mostrar/ocultar opções avançadas"
                            >
                              {open ? "Fechar" : "Detalhes"}
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => setItems((prev) => prev.filter((x) => x.id !== row.id))}
                            >
                              Remover
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Detalhes (expande sem estourar largura) */}
                      {open ? (
                        <tr key={`${row.id}-details`} className="border-b bg-white">
                          <td colSpan={5} className="px-3 py-4">
                            <div className="rounded-2xl bg-zinc-50 ring-1 ring-zinc-200 p-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <Field label="Remember (salvar cursor)">
                                  <div className="flex items-center gap-2">
                                    <Toggle
                                      checked={row.remember ?? true}
                                      onChange={(v) => updateItem(row.id, { remember: v })}
                                    />
                                    <span className="text-sm text-zinc-700">Salvar antes de trocar</span>
                                  </div>
                                </Field>

                                <Field label="Repeat">
                                  <select
                                    className="w-full rounded-xl ring-1 ring-zinc-200 px-2 py-2 outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                                    value={(row.repeat ?? defaultRepeatForMode(row.mode)) as any}
                                    onChange={(e) => updateItem(row.id, { repeat: e.target.value as RepeatMode })}
                                  >
                                    <option value="context">context</option>
                                    <option value="off">off</option>
                                    <option value="track">track</option>
                                  </select>
                                </Field>

                                <Field label="Shuffle / Início">
                                  <div className="flex items-center gap-4 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <Toggle checked={row.shuffle ?? false} onChange={(v) => updateItem(row.id, { shuffle: v })} />
                                      <span className="text-sm text-zinc-700">Shuffle</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Toggle
                                        checked={row.startFromBeginning ?? false}
                                        onChange={(v) => updateItem(row.id, { startFromBeginning: v })}
                                      />
                                      <span className="text-sm text-zinc-700">Início</span>
                                    </div>
                                  </div>
                                </Field>

                                <Field label="Resume (só break)">
                                  <div className="flex items-center gap-2">
                                    <Toggle
                                      checked={rowIsBreak ? (row.resume ?? true) : false}
                                      disabled={!rowIsBreak}
                                      onChange={(v) =>
                                        updateItem(row.id, { resume: v, resumeAfterMs: v ? row.resumeAfterMs : undefined })
                                      }
                                    />
                                    <span className={cx("text-sm", rowIsBreak ? "text-zinc-700" : "text-zinc-400")}>
                                      Voltar para o ponto exato
                                    </span>
                                  </div>
                                </Field>

                                <Field label="After (ms) (só break + resume)">
                                  <input
                                    type="number"
                                    min={0}
                                    step={1000}
                                    className="w-full rounded-xl ring-1 ring-zinc-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-300 bg-white disabled:bg-zinc-100 disabled:text-zinc-400"
                                    value={rowIsBreak && row.resume ? Number(row.resumeAfterMs ?? 0) : 0}
                                    disabled={!rowIsBreak || !(row.resume ?? true)}
                                    onChange={(e) =>
                                      updateItem(row.id, { resumeAfterMs: Math.max(0, Number(e.target.value || 0)) })
                                    }
                                  />
                                  <div className="mt-1 text-[11px] text-zinc-500">
                                    Dica: 0 = backend tenta calcular a duração automaticamente.
                                  </div>
                                </Field>

                                <Field label="Info">
                                  <div className="text-xs text-zinc-600 space-y-1">
                                    <div>
                                      <b>switch</b>: continua do cursor salvo.
                                    </div>
                                    <div>
                                      <b>break</b>: toca vinheta e volta se <b>Resume</b> estiver ligado.
                                    </div>
                                  </div>
                                </Field>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}

                {!rows.length ? (
                  <tr>
                    <td colSpan={5} className="p-5 text-sm text-zinc-600">
                      Sem itens no schedule.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 bg-zinc-50 border-t text-xs text-zinc-600">
            Dica: use <b>Detalhes</b> para editar as opções avançadas sem estourar a largura da tela.
          </div>
        </div>
      </div>
    </div>
  );
}