/**
 * QR Code Generator
 *
 * Features:
 *   – Content-type tabs: Plain text/URL, WiFi, vCard, Email, SMS, Phone, Geo
 *   – Per-type form fields with validation
 *   – Live QR preview rendered as SVG (via qrcode package)
 *   – Rendering options: error correction level, size, fg/bg color pickers,
 *     quiet-zone margin
 *   – Low-contrast color warning (WCAG ratio < 3)
 *   – Downloads: PNG (canvas) and SVG (qrcode string output)
 *   – Copy payload string button
 *   – All inputs persisted via Zustand store (su:qr-generator)
 *   – "Data stays in your browser" privacy note
 */

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  buildPayload,
  validatePayload,
  isLowContrast,
  type QrContentType,
  type WifiSecurityType,
} from './logic'
import { useQrGeneratorStore, type RenderOptions } from './store'

// ── Types ─────────────────────────────────────────────────────────────────────

type EcLevel = RenderOptions['errorCorrectionLevel']

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { value: QrContentType; label: string }[] = [
  { value: 'text', label: 'Text / URL' },
  { value: 'wifi', label: 'WiFi' },
  { value: 'vcard', label: 'Contact' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'phone', label: 'Phone' },
  { value: 'geo', label: 'Geo' },
]

const EC_LEVELS: { value: EcLevel; label: string; desc: string }[] = [
  { value: 'L', label: 'L', desc: '~7% recovery' },
  { value: 'M', label: 'M', desc: '~15% recovery' },
  { value: 'Q', label: 'Q', desc: '~25% recovery' },
  { value: 'H', label: 'H', desc: '~30% recovery' },
]

const WIFI_SECURITY_OPTIONS: { value: WifiSecurityType; label: string }[] = [
  { value: 'WPA', label: 'WPA/WPA2' },
  { value: 'WEP', label: 'WEP' },
  { value: 'nopass', label: 'None (open)' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function QrGenerator() {
  const store = useQrGeneratorStore()
  const {
    activeType,
    textParams,
    wifiParams,
    vcardParams,
    emailParams,
    smsParams,
    phoneParams,
    geoParams,
    renderOptions,
    setActiveType,
    setTextParams,
    setWifiParams,
    setVCardParams,
    setEmailParams,
    setSmsParams,
    setPhoneParams,
    setGeoParams,
    setRenderOptions,
  } = store

  // ── Derived payload & validation ─────────────────────────────────────────

  function getCurrentQrParams() {
    switch (activeType) {
      case 'text':
        return { type: 'text' as const, params: textParams }
      case 'wifi':
        return { type: 'wifi' as const, params: wifiParams }
      case 'vcard':
        return { type: 'vcard' as const, params: vcardParams }
      case 'email':
        return { type: 'email' as const, params: emailParams }
      case 'sms':
        return { type: 'sms' as const, params: smsParams }
      case 'phone':
        return { type: 'phone' as const, params: phoneParams }
      case 'geo':
        return { type: 'geo' as const, params: geoParams }
    }
  }

  const qrParams = getCurrentQrParams()
  const validationError = validatePayload(qrParams)
  const payload = validationError ? '' : buildPayload(qrParams)
  const lowContrast = isLowContrast(renderOptions.fgColor, renderOptions.bgColor)

  // ── QR SVG rendering ──────────────────────────────────────────────────────

  const [svgString, setSvgString] = useState('')
  const [qrError, setQrError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (!payload) {
        setSvgString('')
        setQrError(null)
        return
      }
      try {
        const svg = await QRCode.toString(payload, {
          type: 'svg',
          errorCorrectionLevel: renderOptions.errorCorrectionLevel,
          margin: renderOptions.margin,
          color: {
            dark: renderOptions.fgColor,
            light: renderOptions.bgColor,
          },
        })
        if (!cancelled) {
          setSvgString(svg)
          setQrError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setSvgString('')
          setQrError((err as Error).message ?? 'Failed to generate QR code')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [payload, renderOptions])

  // ── Copy payload ──────────────────────────────────────────────────────────

  const [copied, setCopied] = useState(false)

  async function handleCopyPayload() {
    if (!payload) return
    await navigator.clipboard.writeText(payload)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Download PNG ──────────────────────────────────────────────────────────

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const downloadPng = useCallback(async () => {
    if (!payload) return
    const canvas = canvasRef.current ?? document.createElement('canvas')
    await QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: renderOptions.errorCorrectionLevel,
      margin: renderOptions.margin,
      width: renderOptions.size,
      color: {
        dark: renderOptions.fgColor,
        light: renderOptions.bgColor,
      },
    })
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `qr-${activeType}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [payload, renderOptions, activeType])

  // ── Download SVG ──────────────────────────────────────────────────────────

  const downloadSvg = useCallback(async () => {
    if (!payload) return
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: renderOptions.errorCorrectionLevel,
      margin: renderOptions.margin,
      color: {
        dark: renderOptions.fgColor,
        light: renderOptions.bgColor,
      },
    })
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qr-${activeType}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [payload, renderOptions, activeType])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">QR Code Generator</h1>
        <p className="text-sm text-muted-foreground">
          Generate QR codes for URLs, WiFi, contacts, and more.{' '}
          <span className="text-muted-foreground/70">
            All data stays in your browser — nothing is sent to any server.
          </span>
        </p>
      </div>

      {/* ── Content type tabs ────────────────────────────────────────────────── */}
      <Tabs
        value={activeType}
        onValueChange={(v) => setActiveType(v as QrContentType)}
      >
        <TabsList className="flex h-auto flex-wrap gap-1 bg-muted p-1 w-full">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-1 text-xs sm:text-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Text / URL ──────────────────────────────────────────────────── */}
        <TabsContent value="text" className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qr-text">Text or URL</Label>
            <Textarea
              id="qr-text"
              rows={3}
              placeholder="https://example.com or any text…"
              value={textParams.text}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setTextParams({ text: e.target.value })
              }
            />
          </div>
        </TabsContent>

        {/* ── WiFi ───────────────────────────────────────────────────────── */}
        <TabsContent value="wifi" className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wifi-ssid">Network name (SSID)</Label>
            <Input
              id="wifi-ssid"
              placeholder="MyHomeNetwork"
              value={wifiParams.ssid}
              onChange={(e) => setWifiParams({ ...wifiParams, ssid: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Security</Label>
            <div className="flex gap-1.5 flex-wrap">
              {WIFI_SECURITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    setWifiParams({ ...wifiParams, security: opt.value })
                  }
                  aria-pressed={wifiParams.security === opt.value}
                  className={cn(
                    'h-8 rounded px-3 text-sm font-medium transition-colors',
                    wifiParams.security === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {wifiParams.security !== 'nopass' && (
            <div className="space-y-1.5">
              <Label htmlFor="wifi-password">Password</Label>
              <Input
                id="wifi-password"
                type="password"
                placeholder="Network password"
                value={wifiParams.password}
                onChange={(e) =>
                  setWifiParams({ ...wifiParams, password: e.target.value })
                }
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={wifiParams.hidden}
              onClick={() =>
                setWifiParams({ ...wifiParams, hidden: !wifiParams.hidden })
              }
              className={cn(
                'h-4 w-4 rounded border-2 transition-colors shrink-0',
                wifiParams.hidden
                  ? 'bg-primary border-primary'
                  : 'bg-background border-input',
              )}
            />
            <Label
              className="cursor-pointer text-sm"
              onClick={() =>
                setWifiParams({ ...wifiParams, hidden: !wifiParams.hidden })
              }
            >
              Hidden network
            </Label>
          </div>
        </TabsContent>

        {/* ── vCard / Contact ─────────────────────────────────────────────── */}
        <TabsContent value="vcard" className="mt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vcard-name">Full name</Label>
              <Input
                id="vcard-name"
                placeholder="Alice Smith"
                value={vcardParams.name}
                onChange={(e) =>
                  setVCardParams({ ...vcardParams, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vcard-org">Organisation</Label>
              <Input
                id="vcard-org"
                placeholder="ACME Corp"
                value={vcardParams.org}
                onChange={(e) =>
                  setVCardParams({ ...vcardParams, org: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vcard-phone">Phone</Label>
              <Input
                id="vcard-phone"
                type="tel"
                placeholder="+1 555 0100"
                value={vcardParams.phone}
                onChange={(e) =>
                  setVCardParams({ ...vcardParams, phone: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vcard-email">Email</Label>
              <Input
                id="vcard-email"
                type="email"
                placeholder="alice@example.com"
                value={vcardParams.email}
                onChange={(e) =>
                  setVCardParams({ ...vcardParams, email: e.target.value })
                }
              />
            </div>
          </div>
        </TabsContent>

        {/* ── Email ──────────────────────────────────────────────────────── */}
        <TabsContent value="email" className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email-to">To address</Label>
            <Input
              id="email-to"
              type="email"
              placeholder="recipient@example.com"
              value={emailParams.to}
              onChange={(e) =>
                setEmailParams({ ...emailParams, to: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-subject">
              Subject <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="email-subject"
              placeholder="Meeting follow-up"
              value={emailParams.subject}
              onChange={(e) =>
                setEmailParams({ ...emailParams, subject: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-body">
              Body <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="email-body"
              rows={3}
              placeholder="Hi there,&#10;…"
              value={emailParams.body}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setEmailParams({ ...emailParams, body: e.target.value })
              }
            />
          </div>
        </TabsContent>

        {/* ── SMS ────────────────────────────────────────────────────────── */}
        <TabsContent value="sms" className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sms-phone">Phone number</Label>
            <Input
              id="sms-phone"
              type="tel"
              placeholder="+1 555 0100"
              value={smsParams.phone}
              onChange={(e) =>
                setSmsParams({ ...smsParams, phone: e.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sms-message">
              Message <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="sms-message"
              rows={2}
              placeholder="Your message…"
              value={smsParams.message}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setSmsParams({ ...smsParams, message: e.target.value })
              }
            />
          </div>
        </TabsContent>

        {/* ── Phone ──────────────────────────────────────────────────────── */}
        <TabsContent value="phone" className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone-number">Phone number</Label>
            <Input
              id="phone-number"
              type="tel"
              placeholder="+1 555 0100"
              value={phoneParams.phone}
              onChange={(e) =>
                setPhoneParams({ phone: e.target.value })
              }
            />
          </div>
        </TabsContent>

        {/* ── Geo ────────────────────────────────────────────────────────── */}
        <TabsContent value="geo" className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="geo-lat">Latitude</Label>
              <Input
                id="geo-lat"
                type="number"
                step="any"
                min={-90}
                max={90}
                placeholder="40.7128"
                value={geoParams.lat}
                onChange={(e) =>
                  setGeoParams({ ...geoParams, lat: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="geo-lng">Longitude</Label>
              <Input
                id="geo-lng"
                type="number"
                step="any"
                min={-180}
                max={180}
                placeholder="-74.0060"
                value={geoParams.lng}
                onChange={(e) =>
                  setGeoParams({ ...geoParams, lng: e.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geo-query">
              Label / query <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="geo-query"
              placeholder="Empire State Building"
              value={geoParams.query}
              onChange={(e) =>
                setGeoParams({ ...geoParams, query: e.target.value })
              }
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Validation error ─────────────────────────────────────────────────── */}
      {validationError && (
        <p className="text-sm text-destructive">{validationError}</p>
      )}

      {/* ── QR Preview ──────────────────────────────────────────────────────── */}
      {(svgString || qrError) && (
        <>
          <Separator />
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Preview</h2>

            {qrError ? (
              <p className="text-sm text-destructive">{qrError}</p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                {/* QR image */}
                <div
                  className="rounded-lg border border-border overflow-hidden shrink-0 self-center sm:self-start"
                  style={{ width: 200, height: 200 }}
                  dangerouslySetInnerHTML={{ __html: svgString }}
                />

                {/* Actions */}
                <div className="flex-1 space-y-3 w-full">
                  {/* Payload display */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Payload</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyPayload}
                        className="h-6 px-2 text-xs"
                      >
                        {copied ? '✓ Copied' : 'Copy'}
                      </Button>
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-muted-foreground break-all max-h-20 overflow-y-auto">
                      {payload}
                    </div>
                  </div>

                  {/* Download buttons */}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadSvg}
                      className="flex-1 sm:flex-none"
                    >
                      ↓ SVG
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={downloadPng}
                      className="flex-1 sm:flex-none"
                    >
                      ↓ PNG ({renderOptions.size}px)
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Rendering options ───────────────────────────────────────────────── */}
      <Separator />
      <div className="space-y-5">
        <h2 className="text-sm font-semibold">Options</h2>

        {/* Error correction */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Error correction</Label>
          <div className="flex gap-1.5">
            {EC_LEVELS.map((ec) => (
              <button
                key={ec.value}
                type="button"
                onClick={() =>
                  setRenderOptions({ errorCorrectionLevel: ec.value })
                }
                aria-pressed={renderOptions.errorCorrectionLevel === ec.value}
                title={ec.desc}
                className={cn(
                  'h-8 rounded px-3 text-sm font-medium transition-colors',
                  renderOptions.errorCorrectionLevel === ec.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {ec.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Higher levels allow more of the QR code to be damaged/obscured while still scanning.
          </p>
        </div>

        {/* Colors */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Colors</Label>
          <div className="grid grid-cols-2 gap-4">
            <ColorPicker
              id="fg-color"
              label="Foreground (dark)"
              value={renderOptions.fgColor}
              onChange={(v) => setRenderOptions({ fgColor: v })}
            />
            <ColorPicker
              id="bg-color"
              label="Background (light)"
              value={renderOptions.bgColor}
              onChange={(v) => setRenderOptions({ bgColor: v })}
            />
          </div>

          {lowContrast && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>
                Low color contrast — QR scanners may struggle to read this code.
                Use a high-contrast pair such as black on white.
              </span>
            </div>
          )}
        </div>

        {/* Size */}
        <div className="space-y-1.5">
          <Label htmlFor="qr-size" className="text-sm font-medium">
            PNG download size
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="qr-size"
              type="number"
              min={64}
              max={2048}
              step={64}
              value={renderOptions.size}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 64 && v <= 2048) {
                  setRenderOptions({ size: v })
                }
              }}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">px</span>
          </div>
        </div>

        {/* Margin */}
        <div className="space-y-1.5">
          <Label htmlFor="qr-margin" className="text-sm font-medium">
            Quiet zone margin
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="qr-margin"
              type="number"
              min={0}
              max={10}
              step={1}
              value={renderOptions.margin}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!isNaN(v) && v >= 0 && v <= 10) {
                  setRenderOptions({ margin: v })
                }
              }}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">modules</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The quiet zone is the white border around the QR code. Min 4 recommended for reliable scanning.
          </p>
        </div>
      </div>

      {/* hidden canvas for PNG export */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}

// ── ColorPicker ───────────────────────────────────────────────────────────────

interface ColorPickerProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

function ColorPicker({ id, label, value, onChange }: ColorPickerProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 rounded border border-input shrink-0 cursor-pointer overflow-hidden"
          style={{ backgroundColor: value }}
        >
          <input
            id={id}
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="opacity-0 w-full h-full cursor-pointer"
            aria-label={label}
          />
        </div>
        <Input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            // Accept partial hex while typing; only propagate valid 7-char #rrggbb
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
              onChange(v)
            }
          }}
          maxLength={7}
          placeholder="#000000"
          className="font-mono text-sm w-28"
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  )
}
