'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Locale } from '@bot/modules/i18n/types.js';
import type { ModulesEnabled } from '@bot/modules/config/types.js';
import {
  DASHBOARD_MODULES,
  DASHBOARD_VALUE_FIELDS,
  type DashboardFieldKey,
} from '@/lib/fieldCatalog.js';
import { dashboardTranslator } from '@/lib/messages.js';

/**
 * Form konfigurasi.
 *
 * **Kenapa komponen klien.** Konfirmasi harus menyebut nilai lama (US-D3), dan
 * daftar channel/role datang dari Discord — keduanya butuh interaksi. Bentuk
 * konfigurasi sendiri sudah selesai di server sebelum halaman dirender.
 *
 * **Semua teks menerjemahkan lewat katalog, tidak ada kalimat yang ditulis
 * langsung di sini.** Kalau ada, halaman tidak bisa mengikuti bahasa server dan
 * dua bahasa akan hidup berdampingan. Label field pun memakai `botTranslator`
 * supaya label di sini dan panel `/config` tidak bisa berbeda.
 *
 * **Perubahan tidak langsung disimpan.** State lokal memegang form;
 * `PATCH /api/config` hanya dipanggil saat Simpan ditekan. Bukan cuma gaya: kalau
 * setiap ketikan langsung disimpan, mengoreksi satu ketikan salah akan
 * menghasilkan beberapa entri `log_entry`, dan riwayat audit akan penuh dengan
 * noise dari orang yang sebenarnya sedang berpikir.
 *
 * **Konfirmasi dikumpulkan, bukan per-field.** Semua perubahan besar diringkas
 * ke satu dialog yang menyebut nilai lamanya. Dialog per-field akan memunculkan
 * lima dialog berturut-turut untuk lima perubahan, dan yang kelima pasti ditekan
 * tanpa dibaca.
 *
 * **Nilai kosong berarti "kosongkan", bukan "jangan sentuh".** Kalau kosong
 * diartikan sebagai "tidak diubah", tidak ada cara membersihkan channel log atau
 * mematikan mode 24/7 dari dashboard — dan keduanya persis perubahan yang paling
 * sering dibutuhkan.
 */

export interface ChannelOption {
  id: string;
  name: string;
}

export interface RoleOption {
  id: string;
  name: string;
}

export interface FormConfig {
  logChannelId: string | null;
  welcomeChannelId: string | null;
  goodbyeChannelId: string | null;
  djRoleId: string | null;
  autoroleId: string | null;
  autoroleBotId: string | null;
  welcomeMessage: string | null;
  goodbyeMessage: string | null;
  defaultVolume: number;
  idleTimeoutSec: number;
  stayChannelId: string | null;
  locale: string;
  modules: ModulesEnabled;
}

export interface FormLabels {
  values: string;
  modules: string;
  modulesHint: string;
  notSet: string;
  channelNone: string;
  save: string;
  saving: string;
  cancel: string;
  confirm: string;
  discard: string;
  savedTitle: string;
  savedOne: string;
  savedMany: string;
  changeLine: string;
  rejectedTitle: string;
  forbidden: string;
  rateLimited: string;
  storeDown: string;
  databaseDown: string;
  sessionGone: string;
  network: string;
  nothingChanged: string;
  confirmTitle: string;
  confirmModuleOff: string;
  auditFailed: string;
  /** Kalimat konfirmasi per field, dengan `{before}` belum diganti. */
  confirms: Partial<Record<DashboardFieldKey, string>>;
  /**
   * Nama field siap tampil, sudah diterjemahkan di server.
   *
   * **Kenapa teks, bukan fungsi penerjemah.** `ConfigForm` adalah client
   * component, dan React tidak boleh mengirim fungsi dari server component ke
   * sana: hanya bentuk Serializable yang boleh lewat, dan fungsi tidak punya
   * bentuk JSON. Jadi server yang membaca katalog bot, lalu mengirim hasilnya
   * sebagai teks biasa.
   *
   * Ini juga alasan katalog bot dipakai langsung: karena yang dikirim adalah teks,
   * bot dan dashboard dijamin memakai kalimat yang sama, bukan dua terjemahan dari
   * satu kunci.
   */
  fieldLabels: Record<DashboardFieldKey, string>;
  /** Nama modul siap tampil, sudah diterjemahkan di server. */
  moduleLabels: Record<string, string>;
  locales: { code: Locale; label: string }[];
}

export interface ConfigFormProps {
  guildId: string;
  locale: Locale;
  config: FormConfig;
  channels: ChannelOption[];
  roles: RoleOption[];
  labels: FormLabels;
  /** Discord tidak menjawab: daftar channel/role kosong dan simpan dimatikan. */
  readOnly: boolean;
}

/**
 * Bentuk state lokal form: setiap field jadi string (sesuai nilai `<input>` dan
 * `<select>`), modul tetap boolean.
 *
 * Diekspor supaya tes bisa membangun draft dengan bentuk yang sama persis — kalau
 * tes memakai bentuknya sendiri, ia menguji fungsi yang berbeda dari yang
 * dipanggil komponen.
 */
export type FormDraft = Record<DashboardFieldKey, string> & { modules: ModulesEnabled };

function toDraft(config: FormConfig): FormDraft {
  return {
    logChannelId: config.logChannelId ?? '',
    welcomeChannelId: config.welcomeChannelId ?? '',
    goodbyeChannelId: config.goodbyeChannelId ?? '',
    djRoleId: config.djRoleId ?? '',
    autoroleId: config.autoroleId ?? '',
    autoroleBotId: config.autoroleBotId ?? '',
    welcomeMessage: config.welcomeMessage ?? '',
    goodbyeMessage: config.goodbyeMessage ?? '',
    defaultVolume: String(config.defaultVolume),
    idleTimeoutSec: String(config.idleTimeoutSec),
    stayChannelId: config.stayChannelId ?? '',
    locale: config.locale,
    modules: { ...config.modules },
  };
}

/**
 * Nilai draft → body PATCH, hanya field yang berubah.
 *
 * Diekspor supaya bisa diuji tanpa merender React: ini aturan yang menentukan
 * apa yang benar-benar dikirim ke database.
 */
export function buildRequestBody(before: FormDraft, after: FormDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  for (const field of DASHBOARD_VALUE_FIELDS) {
    const key = field.patchKey;
    if (before[key] === after[key]) continue;

    body[key] = field.kind === 'volume' || field.kind === 'integer' ? Number(after[key]) : after[key] || null;
  }

  if (after.locale !== before.locale) body.locale = after.locale;

  const modules: Record<string, boolean> = {};
  for (const module of DASHBOARD_MODULES) {
    if (after.modules[module.moduleKey] !== before.modules[module.moduleKey]) {
      modules[module.moduleKey] = after.modules[module.moduleKey];
    }
  }
  if (Object.keys(modules).length > 0) body.modules = modules;

  return body;
}

interface SaveResponse {
  ok?: boolean;
  error?: string;
  config?: FormConfig;
  changes?: { field: string; before: string; after: string }[];
  auditRecorded?: boolean;
  issues?: { field: string; message: string }[];
  retryAfterSeconds?: number;
}

export function ConfigForm(props: ConfigFormProps) {
  const { guildId, locale, config, channels, roles, labels, readOnly } = props;
  const t = dashboardTranslator(locale);

  const [saved, setSaved] = useState<FormConfig>(config);
  const [draft, setDraft] = useState<FormDraft>(() => toDraft(config));
  const [confirming, setConfirming] = useState<null | string[]>(null);
  const [result, setResult] = useState<null | { tone: 'ok' | 'bad'; title: string; lines: string[] }>(null);
  const [busy, setBusy] = useState(false);

  const body = useMemo(() => buildRequestBody(toDraft(saved), draft), [saved, draft]);
  const changedKeys = Object.keys(body);

  function setField(key: DashboardFieldKey, value: string) {
    setResult(null);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setModule(key: keyof ModulesEnabled, value: boolean) {
    setResult(null);
    setDraft((current) => ({ ...current, modules: { ...current.modules, [key]: value } }));
  }

  /** Nilai lama sebuah field dalam kalimat, untuk dialog konfirmasi. */
  function describeBefore(key: DashboardFieldKey): string {
    const field = DASHBOARD_VALUE_FIELDS.find((item) => item.patchKey === key);
    const raw = saved[key];
    if (raw === null || raw === undefined || raw === '') return labels.notSet;
    if (field?.kind === 'channel' || field?.kind === 'role') {
      return nameOf(field.kind, String(raw), channels, roles);
    }

    return String(raw);
  }

  /**
   * Kalimat konfirmasi untuk semua perubahan besar sekaligus.
   *
   * Modul yang dimatikan ikut di sini: mematikan modul menghentikan pemrosesannya
   * seketika, jadi_)
   */
  function confirmationLines(): string[] {
    const lines: string[] = [];

    for (const key of changedKeys as DashboardFieldKey[]) {
      const template = labels.confirms[key];
      if (template) lines.push(template.replace('{before}', describeBefore(key)));
    }

    const pendingModules = (body.modules ?? {}) as Record<string, boolean>;
    for (const module of DASHBOARD_MODULES) {
      if (pendingModules[module.moduleKey] === false) {
        const moduleLabel = labels.moduleLabels[module.moduleKey] ?? module.moduleKey;
        lines.push(labels.confirmModuleOff.replace('{module}', moduleLabel));
      }
    }

    return lines;
  }

  async function submit() {
    if (changedKeys.length === 0) {
      setResult({ tone: 'bad', title: labels.nothingChanged, lines: [] });
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const response = await fetch(`/api/config?guildId=${guildId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as SaveResponse;

      if (response.ok && payload.ok && payload.config) {
        const changes = payload.changes ?? [];
        setSaved(payload.config);
        setDraft(toDraft(payload.config));
        setResult({
          tone: 'ok',
          title: labels.savedTitle,
          lines: [
            changes.length > 1 ? labels.savedMany.replace('{count}', String(changes.length)) : labels.savedOne,
            ...changes.map((change) =>
              labels.changeLine
                .replace('{field}', change.field)
                .replace('{before}', change.before)
                .replace('{after}', change.after),
            ),
            ...(payload.auditRecorded === false ? [`⚠️ ${labels.auditFailed}`] : []),
          ],
        });
        return;
      }

      setResult({ tone: 'bad', title: labels.rejectedTitle, lines: failureLines(payload, labels) });
    } catch {
      setResult({ tone: 'bad', title: labels.rejectedTitle, lines: [labels.network] });
    } finally {
      setBusy(false);
    }
  }

  function onSaveClick() {
    const lines = confirmationLines();
    setConfirming(lines.length > 0 ? lines : null);
    if (lines.length === 0) void submit();
  }

  return (
    <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
      {result ? <ResultBox tone={result.tone} title={result.title} lines={result.lines} /> : null}

      <section>
        <h2 style={sectionTitle}>{labels.values}</h2>
        <div style={gridStyle}>
          {DASHBOARD_VALUE_FIELDS.map((field) => (
            <Field
              key={field.patchKey}
              field={field}
              value={draft[field.patchKey]}
              options={field.kind === 'role' ? roles : channels}
              labels={labels}
              t={t}
              disabled={readOnly}
              changed={changedKeys.includes(field.patchKey)}
              onChange={(value) => setField(field.patchKey, value)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 style={sectionTitle}>{labels.modules}</h2>
        <p style={{ color: '#949ba4', fontSize: 14, marginTop: -4 }}>{labels.modulesHint}</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {DASHBOARD_MODULES.map((module) => (
            <label
              key={module.moduleKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${changedKeys.includes(`modules.${module.moduleKey}`) ? '#d9a441' : '#2f3136'}`,
                borderRadius: 8,
                background: '#232428',
                cursor: readOnly ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={draft.modules[module.moduleKey]}
                disabled={readOnly}
                onChange={(event) => setModule(module.moduleKey, event.target.checked)}
              />
              <span>{labels.moduleLabels[module.moduleKey]}</span>
            </label>
          ))}
        </div>
      </section>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onSaveClick} disabled={busy || readOnly} style={{ ...primaryButton, opacity: busy || readOnly ? 0.6 : 1 }}>
          {busy ? labels.saving : labels.save}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(toDraft(saved));
            setResult(null);
          }}
          disabled={busy || changedKeys.length === 0}
          style={secondaryButton}
        >
          {labels.discard}
        </button>
      </div>

      {confirming ? (
        <ConfirmDialog
          title={labels.confirmTitle}
          lines={confirming}
          confirmLabel={labels.confirm}
          cancelLabel={labels.cancel}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void submit();
          }}
        />
      ) : null}
    </div>
  );
}

function nameOf(
  kind: 'channel' | 'role',
  id: string,
  channels: ChannelOption[],
  roles: RoleOption[],
): string {
  const found = kind === 'channel' ? channels.find((item) => item.id === id) : roles.find((item) => item.id === id);

  return found ? found.name : id;
}

function Field(props: {
  field: (typeof DASHBOARD_VALUE_FIELDS)[number];
  value: string;
  options: (ChannelOption & RoleOption)[];
  labels: FormLabels;
  t: ReturnType<typeof dashboardTranslator>;
  disabled: boolean;
  changed: boolean;
  onChange: (value: string) => void;
}) {
  const { field, value, options, labels, t, disabled, changed, onChange } = props;
  const isSelect = field.kind === 'channel' || field.kind === 'role';
  // Opsi yang tidak lagi ada (dihapus di Discord sejak halaman dirender) tetap
  // ditampilkan sebagai ID, supaya nilainya terlihat dan bisa dikosongkan.
  const missing = isSelect && value !== '' && !options.some((option) => option.id === value);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label htmlFor={`field-${field.patchKey}`} style={{ fontWeight: 600, fontSize: 14 }}>
        {labels.fieldLabels[field.patchKey]} {changed ? <span style={{ color: '#d9a441' }}>•</span> : null}
      </label>

      {isSelect ? (
        <select
          id={`field-${field.patchKey}`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={inputStyle}
        >
          <option value="">{labels.channelNone}</option>
          {missing ? <option value={value}>{`${value} — ${t('config.valueChannelMissing', { id: value })}`}</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      ) : null}

      {field.kind === 'locale' ? (
        <select
          id={`field-${field.patchKey}`}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={inputStyle}
        >
          {labels.locales.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {field.kind === 'volume' || field.kind === 'integer' ? (
        <input
          id={`field-${field.patchKey}`}
          type="number"
          inputMode="numeric"
          value={value}
          min={field.min}
          max={field.max}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={inputStyle}
        />
      ) : null}

      {field.kind === 'text' ? (
        <textarea
          id={`field-${field.patchKey}`}
          value={value}
          rows={3}
          maxLength={field.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : null}

      <small style={{ color: '#949ba4' }}>
        {t(field.helpKey)}
        {field.min !== undefined ? ` (${field.min}–${field.max})` : ''}
        {field.maxLength !== undefined ? ` (≤ ${field.maxLength})` : ''}
      </small>
    </div>
  );
}

function failureLines(payload: SaveResponse, labels: FormLabels): string[] {
  const byReason: Record<string, string> = {
    forbidden: labels.forbidden,
    'permission-unknown': labels.storeDown,
    'rate-limited': labels.rateLimited.replace('{seconds}', String(payload.retryAfterSeconds ?? 60)),
    'shared-store-down': labels.storeDown,
    'database-down': labels.databaseDown,
  };

  const base = payload.error ? (byReason[payload.error] ?? labels.network) : labels.network;

  return [base, ...(payload.issues ?? []).map((issue) => `${issue.field}: ${issue.message}`)];
}

function ResultBox({ tone, title, lines }: { tone: 'ok' | 'bad'; title: string; lines: string[] }) {
  const colors =
    tone === 'ok'
      ? { bg: '#1f3a2a', fg: '#b6e6c9', border: '#2f6b46' }
      : { bg: '#3d1d1f', fg: '#f5c2c7', border: '#7a2f34' };

  return (
    <div
      role={tone === 'ok' ? 'status' : 'alert'}
      data-testid={tone === 'ok' ? 'save-result-ok' : 'save-result-error'}
      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.fg, borderRadius: 10, padding: '12px 14px' }}
    >
      <strong>{title}</strong>
      {lines.length > 0 ? (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14 }}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ConfirmDialog(props: {
  title: string;
  lines: string[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="confirm-dialog"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', padding: 20 }}
    >
      <div style={{ background: '#232428', border: '1px solid #d9a441', borderRadius: 12, padding: 20, maxWidth: 520 }}>
        <h3 style={{ marginTop: 0 }}>{props.title}</h3>
        <ul style={{ paddingLeft: 18 }}>
          {props.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={props.onCancel} style={secondaryButton}>
            {props.cancelLabel}
          </button>
          <button type="button" onClick={props.onConfirm} style={primaryButton}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionTitle: CSSProperties = { fontSize: 18, margin: 0, marginBottom: 10 };

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 18,
};

const inputStyle: CSSProperties = {
  background: '#1e1f22',
  color: '#dbdee1',
  border: '1px solid #3a3d44',
  borderRadius: 8,
  padding: '8px 10px',
  font: 'inherit',
  width: '100%',
};

const primaryButton: CSSProperties = {
  background: '#5865f2',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton: CSSProperties = {
  background: '#4e5058',
  color: '#f2f3f5',
  border: 'none',
  borderRadius: 8,
  padding: '10px 14px',
  font: 'inherit',
  cursor: 'pointer',
};