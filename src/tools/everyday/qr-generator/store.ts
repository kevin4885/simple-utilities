import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { z } from 'zod'
import type {
  QrContentType,
  WifiSecurityType,
  PlainTextParams,
  WifiParams,
  VCardParams,
  EmailParams,
  SmsParams,
  PhoneParams,
  GeoParams,
} from './logic'

// ── Per-type field schemas ────────────────────────────────────────────────────
//
// No .default() here — defaults live in the Zustand factory.
// Partial rehydration pattern: missing fields stay as current-store defaults.

const PlainTextSchema = z.object({
  text: z.string(),
})

const WifiSchema = z.object({
  ssid: z.string(),
  password: z.string(),
  security: z.enum(['WPA', 'WEP', 'nopass']),
  hidden: z.boolean(),
})

const VCardSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  org: z.string(),
})

const EmailSchema = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
})

const SmsSchema = z.object({
  phone: z.string(),
  message: z.string(),
})

const PhoneSchema = z.object({
  phone: z.string(),
})

const GeoSchema = z.object({
  lat: z.string(),
  lng: z.string(),
  query: z.string(),
})

// ── Rendering options schema ──────────────────────────────────────────────────

const RenderOptionsSchema = z.object({
  /** Error correction level: L=7%, M=15%, Q=25%, H=30% */
  errorCorrectionLevel: z.enum(['L', 'M', 'Q', 'H']),
  /** Output size in pixels (for PNG download) */
  size: z.number().int().min(64).max(2048),
  /** Foreground (dark module) color — 6-digit hex with # prefix */
  fgColor: z.string(),
  /** Background (light module) color — 6-digit hex with # prefix */
  bgColor: z.string(),
  /** Quiet zone margin (number of modules) */
  margin: z.number().int().min(0).max(10),
})

export type RenderOptions = z.infer<typeof RenderOptionsSchema>

// ── Root schema ───────────────────────────────────────────────────────────────

const QrGeneratorSchema = z.object({
  activeType: z.enum(['text', 'wifi', 'vcard', 'email', 'sms', 'phone', 'geo']),
  textParams: PlainTextSchema,
  wifiParams: WifiSchema,
  vcardParams: VCardSchema,
  emailParams: EmailSchema,
  smsParams: SmsSchema,
  phoneParams: PhoneSchema,
  geoParams: GeoSchema,
  renderOptions: RenderOptionsSchema,
})

export type QrGeneratorPersistedState = z.infer<typeof QrGeneratorSchema>

// ── Store state ───────────────────────────────────────────────────────────────

export interface QrGeneratorState extends QrGeneratorPersistedState {
  setActiveType: (activeType: QrContentType) => void
  setTextParams: (params: PlainTextParams) => void
  setWifiParams: (params: WifiParams) => void
  setVCardParams: (params: VCardParams) => void
  setEmailParams: (params: EmailParams) => void
  setSmsParams: (params: SmsParams) => void
  setPhoneParams: (params: PhoneParams) => void
  setGeoParams: (params: GeoParams) => void
  setRenderOptions: (opts: Partial<RenderOptions>) => void
}

// ── Rehydration ───────────────────────────────────────────────────────────────

export function mergePersisted(
  persisted: unknown,
  current: QrGeneratorState,
): QrGeneratorState {
  const result = QrGeneratorSchema.partial().safeParse(persisted)
  if (!result.success) return current
  const patch: Partial<QrGeneratorPersistedState> = {}
  for (const [k, v] of Object.entries(result.data) as [
    keyof QrGeneratorPersistedState,
    unknown,
  ][]) {
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v
  }
  // Deep-merge renderOptions so partial saves work correctly
  if (patch.renderOptions) {
    patch.renderOptions = {
      ...current.renderOptions,
      ...patch.renderOptions,
    }
  }
  return { ...current, ...patch }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useQrGeneratorStore = create<QrGeneratorState>()(
  persist(
    (set, get) => ({
      activeType: 'text' as QrContentType,

      textParams: { text: '' },
      wifiParams: {
        ssid: '',
        password: '',
        security: 'WPA' as WifiSecurityType,
        hidden: false,
      },
      vcardParams: { name: '', phone: '', email: '', org: '' },
      emailParams: { to: '', subject: '', body: '' },
      smsParams: { phone: '', message: '' },
      phoneParams: { phone: '' },
      geoParams: { lat: '', lng: '', query: '' },

      renderOptions: {
        errorCorrectionLevel: 'M' as RenderOptions['errorCorrectionLevel'],
        size: 512,
        fgColor: '#000000',
        bgColor: '#ffffff',
        margin: 4,
      },

      setActiveType: (activeType) => set({ activeType }),
      setTextParams: (params) => set({ textParams: params }),
      setWifiParams: (params) => set({ wifiParams: params }),
      setVCardParams: (params) => set({ vcardParams: params }),
      setEmailParams: (params) => set({ emailParams: params }),
      setSmsParams: (params) => set({ smsParams: params }),
      setPhoneParams: (params) => set({ phoneParams: params }),
      setGeoParams: (params) => set({ geoParams: params }),
      setRenderOptions: (opts) =>
        set({ renderOptions: { ...get().renderOptions, ...opts } }),
    }),
    {
      name: 'su:qr-generator',
      merge: (persisted, current) =>
        mergePersisted(persisted, current as QrGeneratorState),
    },
  ),
)
