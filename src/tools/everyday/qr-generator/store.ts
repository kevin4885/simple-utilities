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
import { useAuth } from '@/lib/auth/useAuth'
import { useToolState } from '@/lib/cloudState/useToolState'
import { registerSweepTarget } from '@/lib/cloudState/importSweep.io'

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

const DEFAULT_STATE: QrGeneratorPersistedState = {
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
}

// ── Local (signed-out) store — unchanged behavior/localStorage key ─────────────

const useLocalQrGeneratorStore = create<QrGeneratorState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

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

// ── Cloud-backed state (Phase 3 of google-auth-cloud-state) ─────────────────────

const TOOL_ID = 'qr-generator'

// Import-sweep registration (Phase 3b of google-auth-cloud-state): on first
// sign-in, the sweep imports this tool's current local data into the cloud
// if no cloud row exists yet for this user/tool. See importSweep.io.ts.
registerSweepTarget({
  toolId: TOOL_ID,
  getLocalItems: () => [{ itemId: 'default', data: useLocalQrGeneratorStore.getState() }],
  schema: QrGeneratorSchema,
})

function useQrGeneratorStoreImpl(): QrGeneratorState {
  const { status } = useAuth()
  const local = useLocalQrGeneratorStore()
  const cloud = useToolState(TOOL_ID, 'default', QrGeneratorSchema, DEFAULT_STATE)

  if (status !== 'signed-in') return local

  const data = cloud.data
  return {
    activeType: data.activeType,
    textParams: data.textParams,
    wifiParams: data.wifiParams,
    vcardParams: data.vcardParams,
    emailParams: data.emailParams,
    smsParams: data.smsParams,
    phoneParams: data.phoneParams,
    geoParams: data.geoParams,
    renderOptions: data.renderOptions,
    setActiveType: (activeType) => cloud.setData({ ...data, activeType }),
    setTextParams: (params) => cloud.setData({ ...data, textParams: params }),
    setWifiParams: (params) => cloud.setData({ ...data, wifiParams: params }),
    setVCardParams: (params) => cloud.setData({ ...data, vcardParams: params }),
    setEmailParams: (params) => cloud.setData({ ...data, emailParams: params }),
    setSmsParams: (params) => cloud.setData({ ...data, smsParams: params }),
    setPhoneParams: (params) => cloud.setData({ ...data, phoneParams: params }),
    setGeoParams: (params) => cloud.setData({ ...data, geoParams: params }),
    setRenderOptions: (opts) =>
      cloud.setData({ ...data, renderOptions: { ...data.renderOptions, ...opts } }),
  }
}

export const useQrGeneratorStore = Object.assign(useQrGeneratorStoreImpl, {
  getState: () => useLocalQrGeneratorStore.getState(),
  setState: (partial: Partial<QrGeneratorState>) => useLocalQrGeneratorStore.setState(partial),
})
