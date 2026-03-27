import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

type PlaybackState = {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: {
    name?: string;
    uri?: string;
    duration_ms?: number;
    artists?: { name: string }[];
    album?: { name?: string; images?: { url: string }[] };
  } | null;
  device?: { name?: string; type?: string } | null;
  context?: { uri?: string } | null;
};

type PlayerStateResponse = {
  ok: true;
  hasActivePlayback: boolean;
  player: PlaybackState | null;
  timedOut?: boolean;
  message?: string | null;
  error?: string | null;
};

type ScheduleItem = {
  id: string;
  cron: string;
  uri: string;
  title?: string;
  enabled?: boolean;
  shuffle?: boolean;
  startFromBeginning?: boolean;
  imageUrl?: string;
  subtitle?: string;
};

type AuthStatus = {
  hasRefreshToken: boolean;
  hasAccessTokenOnDisk?: boolean;
  expires_in_sec_left?: number | null;
  updated_at: string | null;
  scope: string | null;
};

const API_BASE = String((import.meta as any).env?.VITE_API_BASE ?? "").replace(/\/$/, "");
const ONE_MINUTE = 60000;

function buildUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(buildUrl(path));
  const text = await res.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  }

  return data as T;
}

function fmtMs(ms?: number | null) {
  const v = Number(ms ?? 0);
  const total = Math.max(0, Math.floor(v / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function cronToTime(cron: string) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  const min = Number(parts[0] ?? 0);
  const hour = Number(parts[1] ?? 0);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function nextRunFromCron(cron: string) {
  const parts = String(cron ?? "").trim().split(/\s+/);
  const mm = Number(parts[0] ?? 0);
  const hh = Number(parts[1] ?? 0);

  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setHours(hh, mm, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function asComparableUri(v: string) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.startsWith("spotify:")) return s;

  if (s.includes("open.spotify.com/")) {
    try {
      const url = new URL(s);
      const parts = url.pathname.split("/").filter(Boolean);
      const type = parts[0];
      const id = parts[1];
      if (!type || !id) return s;

      if (type === "track") return `spotify:track:${id}`;
      if (type === "album") return `spotify:album:${id}`;
      if (type === "playlist") return `spotify:playlist:${id}`;
      if (type === "artist") return `spotify:artist:${id}`;
    } catch {
      return s;
    }
  }

  return s;
}

export default function Dashboard() {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [hasActivePlayback, setHasActivePlayback] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [healthOk, setHealthOk] = useState<boolean>(false);
  const [msg, setMsg] = useState("");

  const playbackLoadingRef = useRef(false);
  const statusLoadingRef = useRef(false);

  useEffect(() => {
    let active = true;

    const tickPlayback = async () => {
      if (playbackLoadingRef.current) return;
      playbackLoadingRef.current = true;

      try {
        const data = await getJson<PlayerStateResponse>("/api/player/state");
        if (!active) return;

        setHasActivePlayback(!!data?.hasActivePlayback);
        setPlayback(data?.player ?? null);

        if (data?.timedOut) {
          setMsg(data?.message ?? "O player demorou para responder.");
        } else if (data?.message && !data?.hasActivePlayback) {
          setMsg(data.message);
        } else {
          setMsg("");
        }
      } catch (e: any) {
        if (!active) return;
        setHasActivePlayback(false);
        setPlayback(null);
        setMsg(e?.message ?? "Falha ao buscar estado do player.");
      } finally {
        playbackLoadingRef.current = false;
      }
    };

    void tickPlayback();
    const id = setInterval(tickPlayback, ONE_MINUTE);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const tickStatus = async () => {
      if (statusLoadingRef.current) return;
      statusLoadingRef.current = true;

      try {
        const [h, a, s] = await Promise.all([
          getJson<{ ok: true }>("/health"),
          getJson<AuthStatus>("/api/auth/status"),
          getJson<{ ok: true; items: ScheduleItem[] }>("/api/schedule"),
        ]);

        if (!active) return;

        setHealthOk(!!h?.ok);
        setAuth(a);
        setSchedule(s.items ?? []);
      } catch (e: any) {
        if (active) {
          setMsg((prev) => prev || e?.message || "Falha ao carregar status.");
        }
      } finally {
        statusLoadingRef.current = false;
      }
    };

    void tickStatus();
    const id = setInterval(tickStatus, ONE_MINUTE);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const nowPlaying = playback?.item ?? null;

  const cover =
    nowPlaying?.album?.images?.[0]?.url ??
    nowPlaying?.album?.images?.[1]?.url ??
    nowPlaying?.album?.images?.[2]?.url ??
    "";

  const artists = nowPlaying?.artists?.map((a) => a.name).join(", ") ?? "";
  const duration = nowPlaying?.duration_ms ?? 0;
  const progress = playback?.progress_ms ?? 0;
  const isPlaying = !!playback?.is_playing;

  const totalSchedule = schedule.length;
  const activeSchedule = schedule.filter((x) => (x.enabled ?? true) !== false).length;

  const nextItems = useMemo(() => {
    return schedule
      .filter((x) => (x.enabled ?? true) !== false)
      .map((x) => ({ item: x, next: nextRunFromCron(x.cron) }))
      .sort((a, b) => a.next.getTime() - b.next.getTime())
      .slice(0, 6);
  }, [schedule]);

  const playingContext = asComparableUri(playback?.context?.uri ?? "");
  const playingTrack = asComparableUri(nowPlaying?.uri ?? "");

  return (
    <section className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-6xl p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Spotify Scheduler</h1>
            <p className="text-sm text-zinc-600">
              Visão geral: tocando agora + agenda + status do sistema.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              to="/search"
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              Buscar
            </Link>

            <Link
              to="/reproduction"
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Abrir Player
            </Link>

            <Link
              to="/schadule"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Abrir Agenda
            </Link>
          </div>
        </div>

        {msg ? (
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
            {msg}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900">Status do sistema</h3>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-600">API</span>
                <span className={healthOk ? "text-emerald-700 font-semibold" : "text-rose-700 font-semibold"}>
                  {healthOk ? "OK" : "OFF"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Spotify</span>
                <span className={(auth?.hasRefreshToken ? "text-emerald-700" : "text-rose-700") + " font-semibold"}>
                  {auth?.hasRefreshToken ? "Conectado" : "Desconectado"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Player</span>
                <span className={(hasActivePlayback ? "text-emerald-700" : "text-zinc-600") + " font-semibold"}>
                  {hasActivePlayback ? "Ativo" : "Sem reprodução"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-600">Agenda</span>
                <span className="font-semibold text-zinc-900">
                  {activeSchedule}/{totalSchedule} ativos
                </span>
              </div>
            </div>

            {!auth?.hasRefreshToken ? (
              <a
                href={buildUrl("/auth/login")}
                className="mt-4 inline-block rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Conectar Spotify
              </a>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm md:col-span-2">
            <h3 className="text-sm font-semibold text-zinc-900">Tocando agora</h3>

            <div className="mt-3 flex gap-4">
              <div className="h-24 w-24 rounded-2xl bg-zinc-200 overflow-hidden shrink-0 flex items-center justify-center">
                {cover ? (
                  <img src={cover} alt="capa" className="h-24 w-24 object-cover" />
                ) : (
                  <span className="text-xs text-zinc-500">Sem capa</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                      isPlaying ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {isPlaying ? "Tocando" : "Pausado"}
                  </span>

                  <span className="text-xs text-zinc-500">
                    {playback?.device?.name ? `Device: ${playback.device.name}` : ""}
                  </span>
                </div>

                <h2 className="mt-2 text-lg font-bold text-zinc-900 truncate">
                  {nowPlaying?.name ?? "Nada tocando"}
                </h2>

                <p className="text-sm text-zinc-600 truncate">{artists || "—"}</p>
                <p className="text-xs text-zinc-500 truncate">{nowPlaying?.album?.name ?? ""}</p>

                <div className="mt-3">
                  <div className="h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
                    <div
                      className="h-2 bg-zinc-900"
                      style={{
                        width: duration ? `${Math.min(100, (progress / duration) * 100)}%` : "0%",
                      }}
                    />
                  </div>

                  <div className="mt-1 flex justify-between text-xs text-zinc-600">
                    <span>{fmtMs(progress)}</span>
                    <span>{fmtMs(duration)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">Próximos agendamentos</h3>
            <Link to="/schadule" className="text-sm font-semibold text-indigo-600 hover:underline">
              Ver agenda
            </Link>
          </div>

          {nextItems.length ? (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {nextItems.map(({ item, next }) => {
                const itemUri = asComparableUri(item.uri);
                const isThisPlaying = itemUri && (itemUri === playingContext || itemUri === playingTrack);

                return (
                  <div key={item.id} className="rounded-2xl border border-zinc-200 p-3 flex gap-3">
                    <div className="w-12 h-12 rounded-xl bg-zinc-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="capa" className="w-12 h-12 object-cover" />
                      ) : (
                        <span className="text-[10px] text-zinc-500">sem capa</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-zinc-900 truncate">
                          {item.title ?? "Sem título"}
                        </div>

                        {isThisPlaying ? (
                          <span className="text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 px-2 py-1">
                            Tocando
                          </span>
                        ) : null}
                      </div>

                      <div className="text-xs text-zinc-600 truncate">
                        {item.subtitle ?? item.uri}
                      </div>

                      <div className="mt-1 text-xs text-zinc-500 flex gap-3 flex-wrap">
                        <span>
                          Próximo: {next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span>cron: {cronToTime(item.cron)}</span>
                        <span>{item.shuffle ? "aleatório" : "ordem"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-600">Nenhum item ativo na agenda.</p>
          )}
        </div>
      </div>
    </section>
  );
}