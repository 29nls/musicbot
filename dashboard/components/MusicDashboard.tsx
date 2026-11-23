'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { formatDuration, interpolatePosition, type MusicStateResponse } from '@/lib/musicState.js';

interface DashboardTrack {
  title: string;
  author: string;
  durationMs: number;
  uri: string | null;
  artworkUrl: string | null;
  isStream: boolean;
  metadataSource: 'spotify' | 'lavalink';
  audioSource: string | null;
}

interface PlaylistTrack {
  position: number;
  title: string;
  author: string;
  durationMs: number;
  uri: string;
}

interface Playlist {
  id: number;
  name: string;
  scope: 'personal';
  trackCount: number;
  totalDurationMs: number;
  tracks: PlaylistTrack[];
  updatedAt: string;
}

interface CommandResult {
  action: string;
  ok: boolean;
  reason?: string;
  message?: string;
  started?: boolean;
  track?: DashboardTrack;
  tracks?: DashboardTrack[];
  added?: number;
  failed?: number;
  total?: number;
}

type Source = 'youtube' | 'spotify' | 'soundcloud';
type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };

const POLL_MS = 2500;
const CARD: CSSProperties = {
  background: '#232428',
  border: '1px solid #2f3136',
  borderRadius: 12,
  padding: '14px 16px',
};
const BUTTON: CSSProperties = {
  background: '#4e5058',
  color: '#f2f3f5',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  font: 'inherit',
  cursor: 'pointer',
};
const MOVE_BUTTON: CSSProperties = {
  ...BUTTON,
  background: '#2f3136',
  border: '1px solid #3a3d44',
  padding: '8px 10px',
};
const PRIMARY: CSSProperties = { ...BUTTON, background: '#5865f2', color: '#fff', fontWeight: 600 };
const INPUT: CSSProperties = {
  background: '#1e1f22',
  color: '#dbdee1',
  border: '1px solid #3a3d44',
  borderRadius: 8,
  padding: '8px 10px',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const LABEL: CSSProperties = { display: 'block', fontSize: 13, color: '#b5bac1', marginBottom: 4 };

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function describeFailure(reason: string | undefined, message?: string): string {
  switch (reason) {
    case 'no-session':
      return 'Sesi berakhir. Muat ulang halaman lalu masuk lagi.';
    case 'forbidden':
      return 'Anda tidak punya akses ke server ini.';
    case 'permission-unknown':
      return 'Keanggotaan server tidak bisa diverifikasi sekarang.';
    case 'need-dj-role':
      return 'Perintah ini membutuhkan role DJ atau izin Manage Server.';
    case 'not-same-voice-channel':
      return 'Masuk ke voice channel yang sama dengan bot untuk mengontrol musik.';
    case 'no-voice':
      return 'Masuk ke voice channel dulu sebelum memutar lagu.';
    case 'player-unavailable':
      return 'Tidak ada pemutar aktif atau Lavalink sedang tidak terhubung.';
    case 'music-disabled':
      return 'Modul musik dimatikan di server ini.';
    case 'not-configured':
      return 'Kredensial Spotify belum diisi di server.';
    case 'playlist-not-found':
      return 'Playlist tidak ditemukan atau bukan milik Anda.';
    case 'empty':
      return 'Tidak ada lagu yang bisa dipakai.';
    case 'rate-limited':
      return 'Terlalu banyak permintaan. Tunggu sebentar.';
    case 'shared-store-down':
      return 'Penyimpanan bersama tidak aktif. Coba lagi setelah Redis hidup.';
    case 'timeout':
      return 'Bot tidak menjawab dalam 8 detik. Periksa apakah bot berjalan.';
    case 'not-sent':
      return 'Perintah tidak bisa dikirim ke bot.';
    case 'bad-origin':
      return 'Permintaan ditolak karena asal halaman tidak sah.';
    default:
      return message ?? 'Perintah gagal dijalankan.';
  }
}

function describeSuccess(result: CommandResult): { tone: Notice['tone']; text: string } {
  if (result.action === 'playlist') {
    const failed = result.failed ?? 0;
    return failed > 0
      ? {
          tone: 'warn',
          text: `${result.added ?? 0} lagu masuk antrean, ${failed} gagal di-resolve ulang.`,
        }
      : { tone: 'ok', text: `${result.added ?? 0} lagu masuk antrean.` };
  }

  if (result.action === 'play' || result.action === 'enqueue') {
    return {
      tone: 'ok',
      text: result.started ? 'Lagu mulai diputar.' : 'Lagu ditambahkan ke antrean.',
    };
  }

  if (result.action === 'pause') return { tone: 'ok', text: 'Pemutaran dijeda.' };
  if (result.action === 'resume') return { tone: 'ok', text: 'Pemutaran dilanjutkan.' };
  if (result.action === 'skip') return { tone: 'ok', text: 'Lagu dilewati.' };
  if (result.action === 'stop') return { tone: 'ok', text: 'Pemutaran dihentikan dan antrean dikosongkan.' };
  if (result.action === 'loop') return { tone: 'ok', text: 'Mode loop diubah.' };
  if (result.action === 'volume') return { tone: 'ok', text: 'Volume diubah.' };

  return { tone: 'ok', text: 'Perintah dijalankan.' };
}

function mergePlaylist(list: Playlist[], playlist: Playlist): Playlist[] {
  const exists = list.some((item) => item.id === playlist.id);
  const next = exists
    ? list.map((item) => (item.id === playlist.id ? playlist : item))
    : [playlist, ...list];

  return next.sort((left, right) => left.name.localeCompare(right.name));
}

export function MusicDashboard({ guildId }: { guildId: string }) {
  const [state, setState] = useState<MusicStateResponse | null>(null);
  const [stateLoading, setStateLoading] = useState(true);
  const [stateError, setStateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('youtube');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DashboardTrack[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [renameValue, setRenameValue] = useState('');

  const selected = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedId) ?? null,
    [playlists, selectedId],
  );

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/music?guildId=${guildId}`, { cache: 'no-store' });
      const data = await readJson<MusicStateResponse & { error?: string }>(response);

      if (response.status === 401) {
        setStateError('Sesi berakhir. Muat ulang halaman lalu masuk lagi.');
        return;
      }
      if (!response.ok || !data || data.error) {
        setStateError(describeFailure(data?.error, `HTTP ${response.status}`));
        return;
      }

      setState(data);
      setStateError(null);
    } catch {
      setStateError('Status pemutar tidak bisa dimuat. Periksa koneksi lalu coba lagi.');
    } finally {
      setStateLoading(false);
    }
  }, [guildId]);

  const fetchPlaylists = useCallback(async () => {
    try {
      const response = await fetch('/api/playlists', { cache: 'no-store' });
      const data = await readJson<{ playlists?: Playlist[]; error?: string }>(response);
      if (!response.ok || !data?.playlists) {
        setPlaylistsError(
          response.status === 401
            ? describeFailure('no-session')
            : 'Playlist personal tidak bisa dimuat sekarang.',
        );
        return;
      }

      setPlaylists(data.playlists);
      setPlaylistsError(null);
      setSelectedId((current) =>
        current && data.playlists?.some((playlist) => playlist.id === current) ? current : null,
      );
    } catch {
      setPlaylistsError('Playlist personal tidak bisa dimuat. Periksa koneksi lalu coba lagi.');
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
    void fetchPlaylists();

    const poll = setInterval(() => void fetchState(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [fetchState, fetchPlaylists]);

  useEffect(() => {
    setRenameValue(selected?.name ?? '');
  }, [selected]);

  async function sendCommand(command: Record<string, unknown>): Promise<void> {
    setBusy(String(command.kind));
    setNotice(null);

    try {
      const response = await fetch(`/api/music/command?guildId=${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await readJson<{ ok?: boolean; result?: CommandResult; error?: string }>(response);

      if (response.status === 401) {
        setNotice({ tone: 'error', text: describeFailure('no-session') });
        return;
      }
      if (response.status === 504) {
        setNotice({ tone: 'error', text: describeFailure('timeout') });
        return;
      }
      if (!data?.result) {
        setNotice({ tone: 'error', text: describeFailure(data?.error, `HTTP ${response.status}`) });
        return;
      }

      if (!data.result.ok) {
        setNotice({
          tone: 'error',
          text: describeFailure(data.result.reason, data.result.message),
        });
        return;
      }

      const success = describeSuccess(data.result);
      setNotice(success);
      void fetchState();
    } catch {
      setNotice({ tone: 'error', text: 'Perintah tidak terkirim. Periksa koneksi lalu coba lagi.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleSearch(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setSearchError(null);
    setResults(null);

    try {
      const response = await fetch(`/api/music/search?guildId=${guildId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, source }),
      });
      const data = await readJson<{ result?: CommandResult; error?: string }>(response);

      if (data?.result) {
        if (!data.result.ok) {
          if (data.result.reason === 'empty') {
            setResults([]);
            return;
          }

          setSearchError(describeFailure(data.result.reason, data.result.message));
          return;
        }

        setResults(data.result.tracks ?? []);
        return;
      }

      if (!response.ok) {
        setSearchError(describeFailure(data?.error, `HTTP ${response.status}`));
        return;
      }
    } catch {
      setSearchError('Pencarian gagal. Periksa koneksi lalu coba lagi.');
    } finally {
      setSearching(false);
    }
  }

  function playTrack(track: DashboardTrack, mode: 'play' | 'enqueue'): void {
    const target = track.uri ?? `${track.title} ${track.author}`.trim();
    void sendCommand({ kind: mode, query: target, source: 'youtube' });
  }

  async function createPlaylist(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) return;

    setBusy('playlist-create');
    setNotice(null);
    try {
      const response = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await readJson<{ playlist?: Playlist; message?: string; error?: string }>(response);

      if (!response.ok || !data?.playlist) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => mergePlaylist(current, data.playlist as Playlist));
      setSelectedId(data.playlist.id);
      setNewPlaylistName('');
      setNotice({ tone: 'ok', text: `Playlist "${data.playlist.name}" dibuat.` });
    } catch {
      setNotice({ tone: 'error', text: 'Playlist tidak bisa dibuat. Periksa koneksi lalu coba lagi.' });
    } finally {
      setBusy(null);
    }
  }

  async function renamePlaylist(): Promise<void> {
    if (!selected) return;
    const name = renameValue.trim();
    if (!name || name === selected.name) return;

    setBusy('playlist-rename');
    setNotice(null);
    try {
      const response = await fetch(`/api/playlists/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await readJson<{ playlist?: Playlist; message?: string; error?: string }>(response);

      if (!response.ok || !data?.playlist) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => mergePlaylist(current, data.playlist as Playlist));
      setNotice({ tone: 'ok', text: 'Nama playlist disimpan.' });
    } catch {
      setNotice({ tone: 'error', text: 'Nama playlist tidak bisa disimpan.' });
    } finally {
      setBusy(null);
    }
  }

  async function deletePlaylist(): Promise<void> {
    if (!selected) return;
    if (!window.confirm(`Hapus playlist "${selected.name}"? Tindakan ini tidak bisa dibatalkan.`)) {
      return;
    }

    setBusy('playlist-delete');
    setNotice(null);
    try {
      const response = await fetch(`/api/playlists/${selected.id}`, { method: 'DELETE' });
      const data = await readJson<{ ok?: boolean; message?: string; error?: string }>(response);

      if (!response.ok || !data?.ok) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => current.filter((playlist) => playlist.id !== selected.id));
      setSelectedId(null);
      setNotice({ tone: 'ok', text: 'Playlist dihapus.' });
    } catch {
      setNotice({ tone: 'error', text: 'Playlist tidak bisa dihapus.' });
    } finally {
      setBusy(null);
    }
  }

  async function removeTrack(track: PlaylistTrack): Promise<void> {
    if (!selected) return;

    setBusy(`track-remove-${track.position}`);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/playlists/${selected.id}/tracks/${track.position}`,
        { method: 'DELETE' },
      );
      const data = await readJson<{ playlist?: Playlist; message?: string; error?: string }>(response);

      if (!response.ok || !data?.playlist) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => mergePlaylist(current, data.playlist as Playlist));
      setNotice({ tone: 'ok', text: 'Lagu dihapus dari playlist.' });
    } catch {
      setNotice({ tone: 'error', text: 'Lagu tidak bisa dihapus.' });
    } finally {
      setBusy(null);
    }
  }

  async function moveTrack(track: PlaylistTrack, direction: -1 | 1): Promise<void> {
    if (!selected) return;
    const toPosition = track.position + direction;
    if (toPosition < 1 || toPosition > selected.tracks.length) return;

    setBusy(`track-move-${track.position}`);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/playlists/${selected.id}/tracks/${track.position}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toPosition }),
        },
      );
      const data = await readJson<{ playlist?: Playlist; message?: string; error?: string }>(response);

      if (!response.ok || !data?.playlist) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => mergePlaylist(current, data.playlist as Playlist));
      setNotice({ tone: 'ok', text: 'Urutan playlist disimpan.' });
    } catch {
      setNotice({ tone: 'error', text: 'Urutan playlist tidak bisa disimpan.' });
    } finally {
      setBusy(null);
    }
  }

  async function saveTrack(track: DashboardTrack): Promise<void> {
    if (!selected) {
      setNotice({ tone: 'warn', text: 'Pilih playlist personal dulu di panel kanan.' });
      return;
    }
    if (!track.uri) {
      setNotice({ tone: 'error', text: 'Lagu ini tidak punya sumber audio yang bisa disimpan.' });
      return;
    }

    setBusy('track-add');
    setNotice(null);
    try {
      const response = await fetch(`/api/playlists/${selected.id}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [track] }),
      });
      const data = await readJson<{
        playlist?: Playlist;
        added?: number;
        skippedDuplicates?: number;
        message?: string;
        error?: string;
      }>(response);

      if (!response.ok || !data?.playlist) {
        setNotice({ tone: 'error', text: data?.message ?? respondWith(data?.error) });
        return;
      }

      setPlaylists((current) => mergePlaylist(current, data.playlist as Playlist));
      setNotice({
        tone: 'ok',
        text:
          (data.added ?? 0) > 0
            ? `Lagu disimpan ke "${data.playlist.name}".`
            : 'Lagu itu sudah ada di playlist.',
      });
    } catch {
      setNotice({ tone: 'error', text: 'Lagu tidak bisa disimpan ke playlist.' });
    } finally {
      setBusy(null);
    }
  }

  async function loadPlaylist(): Promise<void> {
    if (!selected) return;

    setBusy('playlist-play');
    setNotice(null);
    try {
      const response = await fetch(`/api/playlists/${selected.id}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId }),
      });
      const data = await readJson<{ result?: CommandResult; error?: string }>(response);

      if (response.status === 504) {
        setNotice({ tone: 'error', text: describeFailure('timeout') });
        return;
      }
      if (!data?.result) {
        setNotice({ tone: 'error', text: describeFailure(data?.error, `HTTP ${response.status}`) });
        return;
      }
      if (!data.result.ok) {
        setNotice({
          tone: 'error',
          text: describeFailure(data.result.reason, data.result.message),
        });
        return;
      }

      setNotice(describeSuccess(data.result));
      void fetchState();
    } catch {
      setNotice({ tone: 'error', text: 'Playlist tidak bisa dimuat ke antrean.' });
    } finally {
      setBusy(null);
    }
  }

  const player = state?.player ?? null;
  const current = player?.current ?? null;
  const queueTracks = state?.queue.tracks ?? [];
  const position = player ? interpolatePosition(player, now) : 0;
  const progress =
    current && current.durationMs > 0 && !current.isStream
      ? Math.min(100, Math.max(0, (position / current.durationMs) * 100))
      : 0;
  const isBusy = busy !== null;
  const degradedReason = state?.degraded ? describeDegraded(state.reason) : null;

  return (
    <div style={{ display: 'grid', gap: 18, marginTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={player?.lavalinkConnected ? 'ok' : 'warn'}>
          {player?.lavalinkConnected ? 'Lavalink terhubung' : 'Lavalink tidak terhubung'}
        </Badge>
        <Badge tone={player ? 'ok' : 'muted'}>{player ? player.state : 'tanpa pemutar'}</Badge>
        {player?.voiceChannelId ? (
          <span style={{ color: '#949ba4', fontSize: 13 }}>Voice {player.voiceChannelId}</span>
        ) : null}
      </div>

      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          style={{
            background: notice.tone === 'ok' ? '#1f3a2a' : notice.tone === 'warn' ? '#4a3a12' : '#3d1d1f',
            border: `1px solid ${notice.tone === 'ok' ? '#2f6b46' : notice.tone === 'warn' ? '#d9a441' : '#7a2f34'}`,
            color: notice.tone === 'ok' ? '#8fe0b0' : notice.tone === 'warn' ? '#f2d59b' : '#f5c2c7',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
          }}
        >
          {notice.text}
        </div>
      ) : null}

      {stateError ? (
        <div role="alert" style={{ ...noticeStyle('error'), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{stateError}</span>
          <button type="button" style={{ ...BUTTON, padding: '6px 10px' }} onClick={() => void fetchState()}>
            Coba lagi
          </button>
        </div>
      ) : null}

      {degradedReason ? (
        <div role="status" style={noticeStyle('warn')}>
          Status pemutar tidak bisa dipercaya: {degradedReason}
        </div>
      ) : null}

      <div className="music-grid">
        <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
          <section aria-labelledby="music-now-title">
            <h2 id="music-now-title" style={headingStyle}>
              Sedang diputar
            </h2>
            <div style={CARD}>
              {stateLoading && !state ? (
                <div style={{ display: 'grid', gap: 10 }} aria-busy="true" aria-live="polite">
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div className="music-skeleton" style={{ width: 128, height: 128, borderRadius: 12 }} />
                    <div style={{ flex: 1, minWidth: 200, display: 'grid', gap: 8 }}>
                      <div className="music-skeleton" style={{ height: 22, width: '70%' }} />
                      <div className="music-skeleton" style={{ height: 14, width: '40%' }} />
                      <div className="music-skeleton" style={{ height: 10, width: '100%' }} />
                    </div>
                  </div>
                </div>
              ) : current ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {current.artworkUrl ? (
                    <img
                      src={current.artworkUrl}
                      alt=""
                      width={128}
                      height={128}
                      style={{ borderRadius: 12, objectFit: 'cover', background: '#1e1f22', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
                    />
                  ) : (
                    <div aria-hidden style={{ ...artworkPlaceholder, width: 128, height: 128, borderRadius: 12 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                      {current.title}
                    </div>
                    <div style={{ color: '#b5bac1', fontSize: 14, marginTop: 2 }}>
                      {current.author || 'Artis tidak diketahui'}
                    </div>
                    <div style={{ color: '#949ba4', fontSize: 13, marginTop: 6 }}>
                      {player?.state === 'paused' ? 'Dijeda' : 'Diputar'} · Volume {player?.volume ?? 100}% ·
                      Loop {player?.loopMode ?? 'off'}
                    </div>
                    <div
                      style={{ marginTop: 12, height: 10, background: '#1e1f22', borderRadius: 5, overflow: 'hidden' }}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={current.isStream ? undefined : current.durationMs}
                      aria-valuenow={current.isStream ? undefined : Math.min(position, current.durationMs)}
                      aria-label="Progres pemutaran"
                    >
                      <div style={{ width: `${progress}%`, height: '100%', background: '#5865f2' }} />
                    </div>
                    <div style={{ color: '#949ba4', fontSize: 13, marginTop: 6 }}>
                      {formatDuration(position)} / {current.isStream ? 'live' : formatDuration(current.durationMs)}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ margin: 0, color: '#b5bac1' }}>
                    Belum ada pemutar aktif di server ini.
                  </p>
                  <p style={{ ...mutedText, marginBottom: 0 }}>
                    Cari lagu di bawah lalu tekan Putar. Bot akan bergabung ke voice channel Anda.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="music-controls-title">
            <h2 id="music-controls-title" style={headingStyle}>
              Kontrol
            </h2>
            <div style={{ ...CARD, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={PRIMARY}
                onClick={() => void sendCommand({ kind: player?.state === 'paused' ? 'resume' : 'pause' })}
                disabled={!current || isBusy}
              >
                {busy === 'pause' || busy === 'resume'
                  ? 'Memproses...'
                  : player?.state === 'paused'
                    ? 'Resume'
                    : 'Pause'}
              </button>
              <button
                type="button"
                style={BUTTON}
                onClick={() => void sendCommand({ kind: 'skip' })}
                disabled={!current || isBusy}
              >
                {busy === 'skip' ? 'Melewati...' : 'Skip'}
              </button>
              <button
                type="button"
                style={BUTTON}
                onClick={() => void sendCommand({ kind: 'stop' })}
                disabled={!player || isBusy}
              >
                {busy === 'stop' ? 'Menghentikan...' : 'Stop'}
              </button>
              <button
                type="button"
                style={BUTTON}
                onClick={() =>
                  void sendCommand({
                    kind: 'loop',
                    mode:
                      (player?.loopMode ?? state?.queue.loopMode ?? 'off') === 'off'
                        ? 'track'
                        : (player?.loopMode ?? state?.queue.loopMode ?? 'off') === 'track'
                          ? 'queue'
                          : 'off',
                  })
                }
                disabled={!player || isBusy}
                aria-label="Ubah mode loop"
              >
                {busy === 'loop' ? 'Memproses...' : `Loop: ${player?.loopMode ?? state?.queue.loopMode ?? 'off'}`}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#b5bac1', fontSize: 13 }}>
                Vol
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={player?.volume ?? 100}
                  disabled={!player || isBusy}
                  onChange={(event) => {
                    const level = Number(event.target.value);
                    if (Number.isInteger(level) && level >= 0 && level <= 200) {
                      void sendCommand({ kind: 'volume', level });
                    }
                  }}
                  style={{ ...INPUT, width: 72, padding: '6px 8px' }}
                  aria-label="Volume pemutar"
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="music-search-title">
            <h2 id="music-search-title" style={headingStyle}>
              Cari dan putar
            </h2>
            <div style={CARD}>
              <form onSubmit={(event) => void handleSearch(event)} style={{ display: 'grid', gap: 10 }}>
                <div>
                  <label htmlFor="music-search" style={LABEL}>
                    Judul lagu atau URL
                  </label>
                  <input
                    id="music-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Contoh: lofi beats atau tautan YouTube"
                    style={INPUT}
                    maxLength={200}
                  />
                </div>
                <div className="music-search-row" role="group" aria-label="Sumber pencarian">
                  {(['youtube', 'soundcloud', 'spotify'] as Source[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setSource(item)}
                      aria-pressed={source === item}
                      style={{
                        ...BUTTON,
                        background: source === item ? '#5865f2' : '#2f3136',
                        color: source === item ? '#fff' : '#dbdee1',
                        fontWeight: source === item ? 600 : 400,
                      }}
                    >
                      {item === 'youtube' ? 'YouTube' : item === 'soundcloud' ? 'SoundCloud' : 'Spotify'}
                    </button>
                  ))}
                  <button type="submit" style={{ ...PRIMARY, alignSelf: 'end' }} disabled={searching || !query.trim()}>
                    {searching ? 'Mencari...' : 'Cari'}
                  </button>
                </div>
                <p style={{ ...mutedText, margin: 0 }}>
                  Spotify hanya menyediakan metadata. Audio tetap dicari dari sumber yang diputar Lavalink.
                </p>
              </form>

              {searchError ? (
                <p role="alert" style={{ color: '#f5c2c7', fontSize: 14, marginBottom: 0 }}>
                  {searchError}
                </p>
              ) : null}

              {results && results.length === 0 ? (
                <p style={{ ...mutedText, marginBottom: 0 }}>
                  Tidak ada hasil. Coba kata kunci lain atau sumber lain.
                </p>
              ) : null}

              {results && results.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {results.map((track, index) => (
                    <li
                      key={`${track.uri ?? track.title}-${index}`}
                      className="music-track-row"
                      style={{
                        ...trackRowStyle,
                        background: '#1e1f22',
                        border: '1px solid #2f3136',
                        borderRadius: 10,
                        padding: '10px 12px',
                        alignItems: 'flex-start',
                      }}
                    >
                      {track.artworkUrl ? (
                        <img
                          src={track.artworkUrl}
                          alt=""
                          width={44}
                          height={44}
                          style={{ borderRadius: 6, objectFit: 'cover', background: '#1e1f22' }}
                        />
                      ) : (
                        <div aria-hidden style={smallArtworkPlaceholder} />
                      )}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{track.title}</div>
                        <div style={{ color: '#b5bac1', fontSize: 13 }}>
                          {track.author || 'Artis tidak diketahui'} · {formatDuration(track.durationMs)}
                        </div>
                        <div style={{ color: '#949ba4', fontSize: 12 }}>{trackSourceLabel(track)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={BUTTON}
                          onClick={() => playTrack(track, 'play')}
                          disabled={isBusy}
                          aria-label={`Putar ${track.title}`}
                        >
                          Putar
                        </button>
                        <button
                          type="button"
                          style={BUTTON}
                          onClick={() => playTrack(track, 'enqueue')}
                          disabled={isBusy}
                          aria-label={`Tambahkan ${track.title} ke antrean`}
                        >
                          + Antrean
                        </button>
                        <button
                          type="button"
                          style={BUTTON}
                          onClick={() => void saveTrack(track)}
                          disabled={isBusy || !selected}
                          aria-label={`Simpan ${track.title} ke playlist`}
                        >
                          Simpan
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="music-queue-title">
            <h2 id="music-queue-title" style={headingStyle}>
              Antrean ({queueTracks.length})
            </h2>
            <div style={CARD}>
              {queueTracks.length ? (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                  {queueTracks.map((track, index) => (
                    <li key={`${track.uri ?? track.title}-${index}`} className="music-track-row">
                      <span style={{ color: '#949ba4', width: 24, textAlign: 'right' }}>{index + 1}</span>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{track.title}</div>
                        <div style={{ color: '#b5bac1', fontSize: 13 }}>
                          {track.author || 'Artis tidak diketahui'} · {formatDuration(track.durationMs)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p style={{ ...mutedText, margin: 0 }}>
                  Antrean kosong. Tambahkan lagu dari hasil pencarian.
                </p>
              )}
            </div>
          </section>
        </div>

        <aside aria-labelledby="music-playlists-title" style={{ display: 'grid', gap: 12, minWidth: 0 }}>
          <h2 id="music-playlists-title" style={headingStyle}>
            Playlist personal
          </h2>
          <div style={CARD}>
            <form onSubmit={(event) => void createPlaylist(event)} style={{ display: 'grid', gap: 8 }}>
              <label htmlFor="playlist-name" style={LABEL}>
                Playlist baru
              </label>
              <input
                id="playlist-name"
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                placeholder="Nama playlist"
                style={INPUT}
                maxLength={60}
              />
              <button type="submit" style={PRIMARY} disabled={isBusy || !newPlaylistName.trim()}>
                {busy === 'playlist-create' ? 'Membuat...' : 'Buat playlist'}
              </button>
            </form>
          </div>

          {playlistsError ? (
            <div role="alert" style={{ ...noticeStyle('error'), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>{playlistsError}</span>
              <button type="button" style={{ ...BUTTON, padding: '6px 10px' }} onClick={() => void fetchPlaylists()}>
                Coba lagi
              </button>
            </div>
          ) : null}

          {playlistsLoading ? (
            <div style={{ display: 'grid', gap: 8 }} aria-busy="true" aria-live="polite">
              {[0, 1, 2].map((item) => (
                <div key={item} className="music-skeleton" style={{ height: 62, borderRadius: 12 }} />
              ))}
            </div>
          ) : playlists.length === 0 && !playlistsError ? (
            <p style={mutedText}>
              Belum ada playlist personal. Playlist ini bisa dibuka dari server mana pun tempat Anda
              terautentikasi.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {playlists.map((playlist) => (
                <li key={playlist.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(playlist.id)}
                    aria-pressed={playlist.id === selectedId}
                    style={{
                      ...CARD,
                      width: '100%',
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderColor: playlist.id === selectedId ? '#5865f2' : '#2f3136',
                      color: '#dbdee1',
                      font: 'inherit',
                    }}
                  >
                    <span style={{ display: 'block', fontWeight: 600 }}>{playlist.name}</span>
                    <span style={{ color: '#b5bac1', fontSize: 13 }}>
                      {playlist.trackCount} lagu · {formatDuration(playlist.totalDurationMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <div style={{ ...CARD, display: 'grid', gap: 10 }}>
              <div>
                <label htmlFor="playlist-rename" style={LABEL}>
                  Nama playlist
                </label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input
                    id="playlist-rename"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    style={{ ...INPUT, flex: 1, minWidth: 140 }}
                    maxLength={60}
                  />
                  <button
                    type="button"
                    style={BUTTON}
                    onClick={() => void renamePlaylist()}
                    disabled={isBusy || !renameValue.trim() || renameValue.trim() === selected.name}
                  >
                    {busy === 'playlist-rename' ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  style={PRIMARY}
                  onClick={() => void loadPlaylist()}
                  disabled={isBusy || selected.trackCount === 0}
                >
                  {busy === 'playlist-play' ? 'Memuat...' : 'Muat ke antrean'}
                </button>
                <button
                  type="button"
                  style={BUTTON}
                  onClick={() => void deletePlaylist()}
                  disabled={isBusy}
                >
                  {busy === 'playlist-delete' ? 'Menghapus...' : 'Hapus playlist'}
                </button>
              </div>

              {selected.tracks.length === 0 ? (
                <p style={{ ...mutedText, margin: 0 }}>
                  Playlist ini kosong. Cari lagu lalu tekan Simpan.
                </p>
              ) : (
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                  {selected.tracks.map((track) => (
                    <li key={`${track.position}-${track.uri}`} style={trackRowStyle}>
                      <span style={{ color: '#949ba4', width: 22, textAlign: 'right' }}>{track.position}</span>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{track.title}</div>
                        <div style={{ color: '#b5bac1', fontSize: 13 }}>
                          {track.author || 'Artis tidak diketahui'} · {formatDuration(track.durationMs)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          style={MOVE_BUTTON}
                          onClick={() => void moveTrack(track, -1)}
                          disabled={isBusy || track.position === 1}
                          aria-label={`Naikkan ${track.title} ke posisi ${track.position - 1}`}
                        >
                          {busy === `track-move-${track.position}` ? '...' : 'Naik'}
                        </button>
                        <button
                          type="button"
                          style={MOVE_BUTTON}
                          onClick={() => void moveTrack(track, 1)}
                          disabled={isBusy || track.position === selected.tracks.length}
                          aria-label={`Turunkan ${track.title} ke posisi ${track.position + 1}`}
                        >
                          {busy === `track-move-${track.position}` ? '...' : 'Turun'}
                        </button>
                        <button
                          type="button"
                          style={BUTTON}
                          onClick={() => void removeTrack(track)}
                          disabled={isBusy}
                          aria-label={`Hapus ${track.title} dari playlist`}
                        >
                          {busy === `track-remove-${track.position}` ? 'Menghapus...' : 'Hapus'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <p style={mutedText}>Pilih playlist untuk melihat isi dan memuatnya ke antrean.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function respondWith(error: string | undefined): string {
  return error === 'database-down'
    ? 'Database tidak bisa dihubungi.'
    : 'Permintaan tidak bisa diselesaikan.';
}

function describeDegraded(reason: MusicStateResponse['reason']): string {
  switch (reason) {
    case 'shared-store-down':
      return 'Redis tidak bisa dihubungi. Status pemutar dan antrean tidak tersedia.';
    case 'stale':
      return 'Snapshot terakhir sudah terlalu tua. Bot mungkin berhenti atau kehilangan koneksi.';
    case 'owner-mismatch':
      return 'Snapshot bukan milik proses yang memegang pemutar saat ini.';
    default:
      return 'Status pemutar tidak tersedia.';
  }
}

function trackSourceLabel(track: DashboardTrack): string {
  if (track.metadataSource === 'spotify') {
    return `Metadata Spotify · audio ${track.audioSource ?? 'Lavalink'}`;
  }

  return track.audioSource ? `Audio ${track.audioSource}` : 'Audio Lavalink';
}

function noticeStyle(tone: Notice['tone']): CSSProperties {
  return {
    background: tone === 'ok' ? '#1f3a2a' : tone === 'warn' ? '#4a3a12' : '#3d1d1f',
    border: `1px solid ${tone === 'ok' ? '#2f6b46' : tone === 'warn' ? '#d9a441' : '#7a2f34'}`,
    color: tone === 'ok' ? '#8fe0b0' : tone === 'warn' ? '#f2d59b' : '#f5c2c7',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
  };
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const colors = {
    ok: { bg: '#1f3a2a', fg: '#8fe0b0', border: '#2f6b46' },
    warn: { bg: '#4a3a12', fg: '#f2d59b', border: '#d9a441' },
    muted: { bg: '#2f3136', fg: '#949ba4', border: '#3a3d44' },
  }[tone];

  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        borderRadius: 999,
        padding: '3px 10px',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

const headingStyle: CSSProperties = { fontSize: 18, margin: 0, marginBottom: 8 };
const mutedText: CSSProperties = { color: '#949ba4', fontSize: 14, marginTop: 8 };
const trackRowStyle: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' };
const artworkPlaceholder: CSSProperties = {
  width: 84,
  height: 84,
  borderRadius: 8,
  background: '#1e1f22',
  border: '1px solid #2f3136',
  flex: '0 0 auto',
};
const smallArtworkPlaceholder: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 6,
  background: '#1e1f22',
  border: '1px solid #2f3136',
  flex: '0 0 auto',
};
