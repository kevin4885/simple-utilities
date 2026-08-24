/**
 * JWT Decoder
 *
 * jwt.io-style viewer. Fully client-side — never sends the token anywhere.
 * Full-bleed layout matching markdown-editor pattern.
 */

import { useDeferredValue, useState, useCallback } from 'react'
import { decodeJwt, buildClaimInfos, isExpired } from './logic'
import type { ClaimInfo } from './logic'
import { Button } from '@/components/ui/button'
import { Copy, Trash2, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Claim value rendering ─────────────────────────────────────────────────────

function ClaimRow({ claim }: { claim: ClaimInfo }) {
  const isExpiredClaim = claim.key === 'exp' && claim.expired

  return (
    <tr className={cn('border-b border-border last:border-0', isExpiredClaim && 'bg-destructive/5')}>
      <td className="py-1.5 pr-4 align-top">
        <span
          className={cn(
            'font-mono text-xs font-medium',
            isExpiredClaim ? 'text-destructive' : 'text-primary',
          )}
        >
          {claim.key}
        </span>
      </td>
      <td className="py-1.5 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs break-all">
            {renderRawValue(claim.rawValue)}
          </span>
          {claim.formatted && (
            <span
              className={cn(
                'text-xs',
                isExpiredClaim
                  ? 'text-destructive flex items-center gap-1'
                  : 'text-muted-foreground',
              )}
            >
              {isExpiredClaim && <AlertTriangle className="h-3 w-3 inline-block" />}
              {claim.formatted}
              {isExpiredClaim && ' (expired)'}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

function renderRawValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return JSON.stringify(value)
}

// ── Section panel ─────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  badge,
  badgeVariant = 'default',
}: {
  title: string
  children: React.ReactNode
  badge?: string
  badgeVariant?: 'default' | 'error' | 'expired'
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {badge && (
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded font-medium',
              badgeVariant === 'expired'
                ? 'bg-destructive/15 text-destructive'
                : badgeVariant === 'error'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-primary/10 text-primary',
            )}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ getText, label = 'Copy' }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    const text = getText()
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [getText])
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={label}
    >
      <Copy className="h-3 w-3" />
      {copied ? 'Copied!' : label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function JwtDecoder() {
  const [token, setToken] = useState('')

  // Defer decode so fast typing never lags
  const deferredToken = useDeferredValue(token)
  const result = deferredToken.trim() ? decodeJwt(deferredToken) : null

  // Capture "now" once (on mount) for expiry checking — stays stable across re-renders
  const [nowMs] = useState<number>(() => Date.now())

  const expiredClaim =
    result?.ok
      ? (result.payload.exp !== undefined && typeof result.payload.exp === 'number'
          ? isExpired(result.payload.exp, nowMs)
          : false)
      : false

  const claimInfos = result?.ok ? buildClaimInfos(result.payload, nowMs) : []

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Privacy notice + clear ───────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-3 py-2 bg-background">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
          Decoded entirely in your browser — token never leaves this page.
        </span>
        <div className="ml-auto flex items-center gap-2">
          {result?.ok && (
            expiredClaim ? (
              <span className="flex items-center gap-1 text-xs text-destructive font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Expired
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Valid structure
              </span>
            )
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setToken('')}
            disabled={token === ''}
            className="gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* ── Main scrollable area ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-4 space-y-4 max-w-4xl mx-auto">
          {/* Token input */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">JWT Token</label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your JWT here…"
              spellCheck={false}
              rows={4}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 font-mono text-xs',
                'placeholder:text-muted-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                'resize-none',
                result?.ok === false && token.trim()
                  ? 'border-destructive'
                  : 'border-border',
              )}
            />
          </div>

          {/* Error */}
          {result?.ok === false && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{result.error}</span>
            </div>
          )}

          {/* Decoded sections */}
          {result?.ok && (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Header */}
              <Section title="Header" badge={String(result.header.alg ?? '')}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs text-muted-foreground">
                    {result.header.typ ? `type: ${result.header.typ}` : ''}
                  </span>
                  <CopyButton getText={() => result.headerJson} label="Copy JSON" />
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(result.header).map(([key, value]) => (
                      <tr key={key} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-4 align-top font-mono text-xs font-medium text-primary">
                          {key}
                        </td>
                        <td className="py-1.5 align-top font-mono text-xs break-all">
                          {renderRawValue(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              {/* Payload */}
              <Section
                title="Payload"
                badge={expiredClaim ? 'Expired' : undefined}
                badgeVariant={expiredClaim ? 'expired' : 'default'}
              >
                <div className="flex justify-end mb-2">
                  <CopyButton getText={() => result.payloadJson} label="Copy JSON" />
                </div>
                {claimInfos.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {claimInfos.map((claim) => (
                        <ClaimRow key={claim.key} claim={claim} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Empty payload</p>
                )}
              </Section>

              {/* Signature */}
              <div className="md:col-span-2">
                <Section title="Signature">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs break-all text-muted-foreground flex-1">
                      {result.signature}
                    </p>
                    <CopyButton getText={() => result.signature} label="Copy" />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Signature is shown as-is (base64url). Verification requires the secret or
                    public key and is not performed here.
                  </p>
                </Section>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
