import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { SpotifyDevice, SpotifyPlaybackState } from "../api/types";
import {
  apiGetDevices,
  apiGetPlaybackState,
  apiNext,
  apiPause,
  apiPlayContext,
  apiPlayUris,
  apiPrevious,
  apiReloadSchedule,
  apiResume,
  apiSeek,
} from "../api/radioApi";

type NavState =
  | {
      playMode: "context";
      contextUri: string;
      selectedUri?: string;
      title?: string;
    }
  | {
      playMode: "uris";
      uris: string[];
      selectedUri?: string;
      title?: string;
    };

const POLL_MS = 60_000;

function fmtMs(ms?: number | null) {
  const v = Number(ms ?? 0);
  const total = Math.max(0, Math.floor(v / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Reproduction() {
  const location = useLocation();
  const navState = (location.state ?? {}) as Partial<NavState>;

  const playMode = (navState.playMode ?? "context") as "context" | "uris";
  const contextUri = "contextUri" in navState ? navState.contextUri : undefined;
  const uris = "uris" in navState ? navState.uris : undefined;
  const selectedUri = navState.selectedUri;
  const selectedTitle = navState.title;

  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem("spotify_device_id") ?? "");
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [seekValue, setSeekValue] = useState<number>(0);
  const [isSeeking, setIsSeeking] = useState(false);

  const autoPlayed = useRef(false);
  const mountedRef = useRef(false);
  const pollingBusyRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);

  const lastPlaybackRef = useRef<string>("");
  const lastDevicesRef = useRef<string>("");

  function clearPollTimer() {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function scheduleNextPoll(runPlaybackPoll: () => Promise<void>) {
    clearPollTimer();

    if (!mountedRef.current) return;
    if (document.visibilityState !== "visible") return;

    pollTimerRef.current = window.setTimeout(() => {
      void runPlaybackPoll();
    }, POLL_MS);
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearPollTimer();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const d = await apiGetDevices();
        if (!mounted || !mountedRef.current) return;

        const list = (d.devices ?? []).filter((x) => !!x?.id);
        const nextDevicesSnapshot = JSON.stringify(list);

        if (nextDevicesSnapshot !== lastDevicesRef.current) {
          lastDevicesRef.current = nextDevicesSnapshot;
          setDevices(list);
        }

        const saved = localStorage.getItem("spotify_device_id") ?? "";
        const savedExists = !!saved && list.some((x) => x.id === saved);

        if (savedExists) {
          setDeviceId((prev) => prev || saved);
          return;
        }

        const active = list.find((x) => x.is_active)?.id ?? "";
        const first = list[0]?.id ?? "";
        const chosen = active || first || "";

        if (chosen) {
          setDeviceId(chosen);
          localStorage.setItem("spotify_device_id", chosen);
        } else if (d.message) {
          setMsg(d.message);
        }
      } catch (e) {
        console.log(e);
        if (!mounted || !mountedRef.current) return;
        setMsg("Não consegui listar devices agora.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const runPlaybackPoll = async () => {
      if (!mountedRef.current) return;
      if (document.visibilityState !== "visible") return;
      if (pollingBusyRef.current) return;

      pollingBusyRef.current = true;

      try {
        const data = await apiGetPlaybackState();
        if (!mountedRef.current) return;

        const nextPlayback = data?.hasActivePlayback && data?.player ? data.player : null;
        const snapshot = JSON.stringify(nextPlayback ?? null);

        if (snapshot !== lastPlaybackRef.current) {
          lastPlaybackRef.current = snapshot;
          setPlayback(nextPlayback);
        }

        if (!isSeeking) {
          setSeekValue(nextPlayback?.progress_ms ?? 0);
        }

        if (data?.message && !data?.hasActivePlayback) {
          setMsg(data.message || "");
        } else {
          setMsg("");
        }
      } catch (err) {
        console.error("Erro ao buscar state:", err);
        if (mountedRef.current) {
          setPlayback(null);
          setMsg("Falha ao buscar estado do player.");
        }
      } finally {
        pollingBusyRef.current = false;
        scheduleNextPoll(runPlaybackPoll);
      }
    };

    const handleVisibilityChange = () => {
      if (!mountedRef.current) return;

      if (document.visibilityState === "visible") {
        clearPollTimer();
        void runPlaybackPoll();
      } else {
        clearPollTimer();
      }
    };

    void runPlaybackPoll();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearPollTimer();
    };
  }, [isSeeking]);

  const isPlayingNow = !!playback?.is_playing;

  const isSelectedPlaying = useMemo(() => {
    if (!selectedUri) return false;
    if (!playback?.is_playing) return false;

    if (playMode === "uris") {
      return playback?.item?.uri === selectedUri;
    }

    const ctx = playback?.context?.uri;
    return ctx === selectedUri || ctx === contextUri;
  }, [playback, playMode, selectedUri, contextUri]);

  async function refreshPlaybackOnce() {
    if (pollingBusyRef.current) return;

    clearPollTimer();
    pollingBusyRef.current = true;

    try {
      const latest = await apiGetPlaybackState();
      if (!mountedRef.current) return;

      const nextPlayback = latest?.hasActivePlayback && latest?.player ? latest.player : null;
      const snapshot = JSON.stringify(nextPlayback ?? null);

      if (snapshot !== lastPlaybackRef.current) {
        lastPlaybackRef.current = snapshot;
        setPlayback(nextPlayback);
      }

      setSeekValue(nextPlayback?.progress_ms ?? 0);

      if (latest?.message && !latest?.hasActivePlayback) {
        setMsg(latest.message || "");
      } else {
        setMsg("");
      }
    } catch (e) {
      console.log(e);
    } finally {
      pollingBusyRef.current = false;
    }
  }

  async function playSelected() {
    if (!deviceId) {
      setMsg("Selecione um device primeiro.");
      return;
    }

    try {
      if (playMode === "context") {
        if (!contextUri) {
          setMsg("Volte no Search e selecione um álbum/playlist.");
          return;
        }
        await apiPlayContext(deviceId, contextUri);
      } else {
        if (!uris?.length) {
          setMsg("Volte no Search e selecione uma música.");
          return;
        }
        await apiPlayUris(deviceId, uris);
      }

      setMsg(`Tocando: ${selectedTitle ?? "selecionado"}`);
      await refreshPlaybackOnce();
    } catch (e) {
      console.log(e);
      setMsg("Falha ao tocar. Confirme se o device está acessível no Spotify Connect.");
      autoPlayed.current = false;
    }
  }

  useEffect(() => {
    if (!deviceId) return;
    if (autoPlayed.current) return;

    const hasSelection =
      (playMode === "context" && !!contextUri) ||
      (playMode === "uris" && !!uris?.length);

    if (!hasSelection) return;

    autoPlayed.current = true;
    void playSelected();
  }, [deviceId, playMode, contextUri, uris]);

  const duration = playback?.item?.duration_ms ?? 0;
  const progress = playback?.progress_ms ?? 0;

  const trackName = playback?.item?.name ?? "";
  const artistName = playback?.item?.artists?.map((a) => a.name).join(", ") ?? "";
  const albumName = playback?.item?.album?.name ?? "";
  const cover =
    playback?.item?.album?.images?.[0]?.url ??
    playback?.item?.album?.images?.[1]?.url ??
    playback?.item?.album?.images?.[2]?.url ??
    "";

  const activeDeviceName =
    playback?.device?.name ??
    devices.find((d) => d.id === deviceId)?.name ??
    "";

  const activeDeviceType =
    playback?.device?.type ??
    devices.find((d) => d.id === deviceId)?.type ??
    "";

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
            <div>
              <h1 className="text-lg font-semibold text-zinc-900">Player</h1>
              <p className="text-sm text-zinc-600">
                {activeDeviceName
                  ? `Device: ${activeDeviceName} (${activeDeviceType})`
                  : "Selecione um device para tocar"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                onClick={async () => {
                  const r = await apiReloadSchedule().catch(() => null);
                  setMsg(r ? `Agendamento recarregado. Jobs: ${r.tasks}` : "Falha ao recarregar agendamento.");
                }}
              >
                Recarregar agenda
              </button>

              <select
                value={deviceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setDeviceId(id);
                  localStorage.setItem("spotify_device_id", id);
                  setMsg(`Device selecionado: ${devices.find((d) => d.id === id)?.name ?? id}`);
                  autoPlayed.current = false;
                }}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">Selecione um device...</option>
                {devices
                  .filter((d) => !!d.id)
                  .map((d) => (
                    <option key={String(d.id)} value={String(d.id)}>
                      {d.name} ({d.type}) {d.is_active ? "• ativo" : ""}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[320px_1fr]">
            <div className="flex flex-col items-center">
              <div className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-3xl bg-zinc-200 shadow-sm">
                {cover ? (
                  <img src={cover} alt="Capa" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
                    Sem capa (nada tocando)
                  </div>
                )}
              </div>

              <div className="mt-4 w-full max-w-[320px]">
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
                      isPlayingNow ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-700",
                    ].join(" ")}
                  >
                    {isPlayingNow ? "Tocando agora" : "Pausado"}
                  </span>

                  {selectedTitle ? (
                    <span className="max-w-[180px] truncate text-xs text-zinc-500">
                      Selecionado: {selectedTitle}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col">
              <div>
                <h2 className="text-2xl font-bold leading-tight text-zinc-900">
                  {trackName || "Nada tocando"}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">{artistName || "—"}</p>
                <p className="mt-1 text-sm text-zinc-500">{albumName || ""}</p>
              </div>

              <div className="mt-6">
                <input
                  type="range"
                  min={0}
                  max={duration}
                  value={Math.min(isSeeking ? seekValue : progress, duration || 0)}
                  onChange={(e) => {
                    setIsSeeking(true);
                    setSeekValue(Number(e.target.value));
                  }}
                  onMouseUp={async () => {
                    if (!deviceId || !duration) {
                      setIsSeeking(false);
                      return;
                    }

                    try {
                      await apiSeek(deviceId, seekValue);
                      await refreshPlaybackOnce();
                    } catch (e) {
                      console.log(e);
                    } finally {
                      setIsSeeking(false);
                    }
                  }}
                  onTouchEnd={async () => {
                    if (!deviceId || !duration) {
                      setIsSeeking(false);
                      return;
                    }

                    try {
                      await apiSeek(deviceId, seekValue);
                      await refreshPlaybackOnce();
                    } catch (e) {
                      console.log(e);
                    } finally {
                      setIsSeeking(false);
                    }
                  }}
                  className="w-full"
                  disabled={!deviceId || !duration}
                />
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-600">
                  <span>{fmtMs(isSeeking ? seekValue : progress)}</span>
                  <span>{fmtMs(duration)}</span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <button
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                  onClick={async () => {
                    if (!deviceId) return;
                    await apiPrevious(deviceId).catch(console.log);
                    await refreshPlaybackOnce();
                  }}
                  disabled={!deviceId}
                >
                  ⏮ Prev
                </button>

                <button
                  className={[
                    "rounded-2xl px-5 py-2 text-sm font-semibold transition disabled:opacity-60",
                    isPlayingNow
                      ? "bg-zinc-900 text-white hover:bg-zinc-800"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
                  ].join(" ")}
                  onClick={async () => {
                    if (!deviceId) return;

                    try {
                      if (isPlayingNow) {
                        await apiPause(deviceId);
                      } else {
                        await apiResume(deviceId);
                      }

                      await refreshPlaybackOnce();
                    } catch (e) {
                      console.log(e);
                    }
                  }}
                  disabled={!deviceId}
                >
                  {isPlayingNow ? "⏸ Pause (Agora)" : "▶ Play (Agora)"}
                </button>

                <button
                  className={[
                    "rounded-2xl px-5 py-2 text-sm font-semibold transition disabled:opacity-60",
                    isSelectedPlaying
                      ? "cursor-not-allowed bg-emerald-600 text-white"
                      : "bg-indigo-600 text-white hover:bg-indigo-700",
                  ].join(" ")}
                  onClick={() => void playSelected()}
                  disabled={!deviceId || isSelectedPlaying}
                >
                  {isSelectedPlaying ? "✅ Selecionado tocando" : "▶ Play selecionado"}
                </button>

                <button
                  className="rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                  onClick={async () => {
                    if (!deviceId) return;
                    await apiNext(deviceId).catch(console.log);
                    await refreshPlaybackOnce();
                  }}
                  disabled={!deviceId}
                >
                  Next ⏭
                </button>
              </div>

              {msg ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                  {msg}
                </div>
              ) : null}

              <div className="mt-6 text-xs text-zinc-500">
                Dica: se não aparecer device, deixe o Spotify realmente acessível no Spotify Connect.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}