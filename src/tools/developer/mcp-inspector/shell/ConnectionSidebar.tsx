import { useRef, useState } from 'react'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/client'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import AuthPanel from '../auth/AuthPanel'
import { exportProfiles, headerSecretKey, importProfiles, isSecretHeaderName } from '../logic'
import { MAX_HEADERS, type HeaderEntry, type Profile } from '../schemas'
import { deleteSecret, getSecret, replaceSecret, setSecret } from '../secrets'
import { useMcpInspectorStore } from '../store'
import { preflight } from './logic'
import { downloadBlob } from './viewerIo'

const EXPORT_FILENAME = 'mcp-inspector-profiles.json'
const AUTO = 'auto'

const SECRET_WRITE_FAILED =
  'Could not store a secret value: browser storage is unavailable or full. The value will not be sent or kept.'

const TRANSPORT_OPTIONS: { value: Profile['transport']; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'streamable-http', label: 'Streamable HTTP' },
  { value: 'sse', label: 'Legacy SSE' },
]

function newHeaderId(): string {
  return crypto.randomUUID()
}

// ── Header editor ─────────────────────────────────────────────────────────────

/**
 * Secret header values never live in the profile: the typed text is kept in `values` (seeded
 * from the secrets store) and handed to updateProfile, which moves it into secrets.ts and keeps
 * `value: ''` in the stored header.
 */
function HeaderEditor({ profile, onSecretError }: { profile: Profile; onSecretError(message: string | null): void }) {
  const updateProfile = useMcpInspectorStore((s) => s.updateProfile)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const h of profile.headers) if (h.secret) out[h.id] = getSecret(headerSecretKey(profile.id, h.id)) ?? ''
    return out
  })
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set())
  /** Rows whose secret flag the user set by hand: typing the name must not override those. */
  const touchedSecret = useRef<Set<string>>(new Set())

  const { warnings, invalid } = preflight(profile, getSecret, window.location.protocol)

  /** Writes headers to the store; `typed` names the one secret row whose value just changed. */
  const commit = (headers: HeaderEntry[], nextValues: Record<string, string>, typed?: string) => {
    const forStore = headers.map((h) => (h.secret ? { ...h, value: h.id === typed ? (nextValues[h.id] ?? '') : '' } : h))
    updateProfile(profile.id, { headers: forStore })
    setValues(nextValues)
    if (typed === undefined) return
    const row = headers.find((h) => h.id === typed)
    if (!row?.secret) return
    const key = headerSecretKey(profile.id, row.id)
    const value = nextValues[row.id] ?? ''
    if (value === '') {
      deleteSecret(key)
      onSecretError(null)
      return
    }
    // updateProfile already moved the value into secrets.ts (setSecret with persist = profile.persistSecrets);
    // it ignores a refused write, so read it back to tell the user when storage said no.
    onSecretError(getSecret(key) === value ? null : SECRET_WRITE_FAILED)
  }

  const patchRow = (id: string, patch: Partial<HeaderEntry>, valueText?: string) => {
    const headers = profile.headers.map((h) => (h.id === id ? { ...h, ...patch } : h))
    const next = valueText === undefined ? values : { ...values, [id]: valueText }
    commit(headers, next, valueText === undefined ? undefined : id)
  }

  const onName = (h: HeaderEntry, name: string) => {
    // The flag follows the typed name until the user sets it by hand; it never silently drops a secret that has a value.
    const hasValue = (values[h.id] ?? '') !== ''
    const secret = touchedSecret.current.has(h.id) ? h.secret : isSecretHeaderName(name) || (h.secret && hasValue)
    if (secret === h.secret) return patchRow(h.id, { name })
    toggleSecret(h, secret, name)
  }

  const toggleSecret = (h: HeaderEntry, secret: boolean, name = h.name) => {
    if (secret) {
      // plain -> secret: the visible text becomes the secret value
      const typedValue = h.value
      patchRow(h.id, { name, secret: true }, typedValue)
    } else {
      // secret -> plain: the stored secret text becomes the plain value (and the secret is dropped)
      const plain = values[h.id] ?? ''
      const nextValues = { ...values }
      delete nextValues[h.id]
      commit(profile.headers.map((x) => (x.id === h.id ? { ...x, name, secret: false, value: plain } : x)), nextValues)
      onSecretError(null)
    }
  }

  const addHeader = () => {
    if (profile.headers.length >= MAX_HEADERS) return
    const row: HeaderEntry = { id: newHeaderId(), name: '', value: '', secret: false, enabled: true }
    commit([...profile.headers, row], values)
  }

  const removeHeader = (id: string) => {
    const nextValues = { ...values }
    delete nextValues[id]
    touchedSecret.current.delete(id)
    commit(
      profile.headers.filter((h) => h.id !== id),
      nextValues,
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Headers</Label>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={addHeader}
          disabled={profile.headers.length >= MAX_HEADERS}
        >
          <Plus /> Add header
        </Button>
      </div>
      {profile.headers.length === 0 && <p className="text-xs text-muted-foreground">No custom headers.</p>}
      <ul className="space-y-2">
        {profile.headers.map((h, i) => {
          const shown = !h.secret || revealed.has(h.id)
          return (
            <li key={h.id} className="space-y-1.5 rounded-md border p-2" data-slot="header-row">
              <Input
                aria-label={`Header ${i + 1} name`}
                placeholder="Name, e.g. Authorization"
                value={h.name}
                onChange={(e) => onName(h, e.target.value)}
                className="h-8 text-xs md:text-xs"
              />
              <div className="flex gap-1">
                <Input
                  aria-label={`Header ${i + 1} value`}
                  placeholder="Value"
                  type={shown ? 'text' : 'password'}
                  autoComplete="off"
                  value={h.secret ? (values[h.id] ?? '') : h.value}
                  onChange={(e) =>
                    h.secret ? patchRow(h.id, {}, e.target.value) : patchRow(h.id, { value: e.target.value })
                  }
                  className="h-8 text-xs md:text-xs"
                />
                {h.secret && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={revealed.has(h.id) ? `Hide header ${i + 1} value` : `Reveal header ${i + 1} value`}
                    aria-pressed={revealed.has(h.id)}
                    onClick={() =>
                      setRevealed((prev) => {
                        const next = new Set(prev)
                        if (!next.delete(h.id)) next.add(h.id)
                        return next
                      })
                    }
                  >
                    {revealed.has(h.id) ? <EyeOff /> : <Eye />}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    aria-label={`Header ${i + 1} secret`}
                    checked={h.secret}
                    onCheckedChange={(c) => {
                      touchedSecret.current.add(h.id)
                      toggleSecret(h, c === true)
                    }}
                  />
                  Secret
                </label>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    aria-label={`Header ${i + 1} enabled`}
                    checked={h.enabled}
                    onCheckedChange={(c) => patchRow(h.id, { enabled: c === true })}
                  />
                  Enabled
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label={`Remove header ${i + 1}`}
                  onClick={() => removeHeader(h.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {invalid.length > 0 && (
        <p role="alert" className="text-xs text-destructive">
          Invalid header name{invalid.length > 1 ? 's' : ''}: {invalid.join(', ')}. Use letters, digits and
          {' !#$%&\'*+-.^_`|~'} only. Connect is disabled until fixed.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground" aria-label="Header warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Profile editor ────────────────────────────────────────────────────────────

function ProfileEditor({ profile }: { profile: Profile }) {
  const updateProfile = useMcpInspectorStore((s) => s.updateProfile)
  const [secretError, setSecretError] = useState<string | null>(null)
  const [confirmUntick, setConfirmUntick] = useState(false)
  const pre = preflight(profile, getSecret, window.location.protocol)
  const hasSecrets = profile.headers.some((h) => h.secret)

  const setPersist = (persistSecrets: boolean) => {
    if (!persistSecrets) {
      // Untick: the saved copies are deleted from localStorage, but the values the user is working with
      // are kept for this tab session so the form and the connection keep agreeing.
      const current: [string, string][] = []
      for (const h of profile.headers) {
        const key = headerSecretKey(profile.id, h.id)
        const v = h.secret ? getSecret(key) : null
        if (v !== null && v !== '') current.push([key, v])
      }
      updateProfile(profile.id, { persistSecrets })
      let kept = true
      for (const [key, v] of current) if (!setSecret(key, v, { persist: false })) kept = false
      setSecretError(kept ? null : SECRET_WRITE_FAILED)
      return
    }
    updateProfile(profile.id, { persistSecrets })
    // Make sure every secret really reached persistent storage (the store ignores a refused write).
    let ok = true
    for (const h of profile.headers) {
      if (!h.secret) continue
      const key = headerSecretKey(profile.id, h.id)
      const v = getSecret(key)
      if (v !== null && v !== '' && !replaceSecret(key, v, { persist: true })) ok = false
    }
    setSecretError(ok ? null : SECRET_WRITE_FAILED)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="mcp-url">Server URL</Label>
        <Input
          id="mcp-url"
          placeholder="https://example.com/mcp"
          value={profile.url}
          onChange={(e) => updateProfile(profile.id, { url: e.target.value })}
          aria-invalid={pre.urlError !== null}
          aria-describedby={pre.urlError ? 'mcp-url-error' : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {pre.urlError && (
          <p id="mcp-url-error" role="alert" className="text-xs text-destructive">
            {pre.urlError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          stdio? Browsers cannot spawn stdio servers. Bridge the server to HTTP with an external tool and enter that
          HTTP URL here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label id="mcp-transport-label">Transport</Label>
          <Select
            value={profile.transport}
            onValueChange={(v) => updateProfile(profile.id, { transport: v as Profile['transport'] })}
          >
            <SelectTrigger aria-labelledby="mcp-transport-label" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSPORT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label id="mcp-protocol-label">Protocol version</Label>
          <Select
            value={profile.protocolVersion ?? AUTO}
            onValueChange={(v) => updateProfile(profile.id, { protocolVersion: v === AUTO ? null : v })}
          >
            <SelectTrigger aria-labelledby="mcp-protocol-label" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Auto</SelectItem>
              {SUPPORTED_PROTOCOL_VERSIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <HeaderEditor key={profile.id} profile={profile} onSecretError={setSecretError} />

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            className="mt-0.5"
            aria-label="Remember secrets in this browser"
            checked={profile.persistSecrets}
            onCheckedChange={(c) => {
              if (c === true) setPersist(true)
              else if (hasSecrets) setConfirmUntick(true)
              else setPersist(false)
            }}
          />
          <span>
            Remember secrets in this browser
            <span className="block text-muted-foreground">
              Warning: secret values will be stored unencrypted in this browser&apos;s local storage. Leave unticked to
              keep them for this tab session only.
            </span>
          </span>
        </label>
        {secretError && (
          <p role="alert" className="text-xs text-destructive">
            {secretError}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Authentication</Label>
        <AuthPanel profile={profile} onChange={(patch) => updateProfile(profile.id, patch)} />
      </div>

      <AlertDialog open={confirmUntick} onOpenChange={setConfirmUntick}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop remembering secrets?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved secrets of this profile will be deleted from this browser&apos;s persistent storage. They are
              kept for the current tab session only, so you will have to enter them again in a new session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep remembering</AlertDialogCancel>
            <AlertDialogAction onClick={() => setPersist(false)}>Delete saved secrets</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function ConnectionSidebar({ className }: { className?: string }) {
  const profiles = useMcpInspectorStore((s) => s.profiles)
  const activeProfileId = useMcpInspectorStore((s) => s.activeProfileId)
  const addProfile = useMcpInspectorStore((s) => s.addProfile)
  const duplicateProfile = useMcpInspectorStore((s) => s.duplicateProfile)
  const deleteProfile = useMcpInspectorStore((s) => s.deleteProfile)
  const setActiveProfile = useMcpInspectorStore((s) => s.setActiveProfile)
  const updateProfile = useMcpInspectorStore((s) => s.updateProfile)

  const active = profiles.find((p) => p.id === activeProfileId) ?? null
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const commitRename = () => {
    if (renaming) updateProfile(renaming.id, { name: renaming.text })
    setRenaming(null)
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportMessage({ ok: false, text: 'Could not read the selected file.' })
      return
    }
    const result = importProfiles(text)
    if (!result.ok) {
      setImportMessage({ ok: false, text: result.error })
      return
    }
    // The store has no bulk-add action: create each profile, then apply the imported fields.
    const previous = useMcpInspectorStore.getState().activeProfileId
    for (const p of result.profiles) {
      const created = addProfile({ name: p.name, url: p.url })
      updateProfile(created.id, {
        transport: p.transport,
        protocolVersion: p.protocolVersion,
        headers: p.headers,
        auth: p.auth,
      })
    }
    if (previous !== null) setActiveProfile(previous)
    setImportMessage({ ok: true, text: `Imported ${result.profiles.length}, skipped ${result.skipped}` })
  }

  return (
    <div className={cn('space-y-4 p-3', className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Profiles</h2>
          <Button type="button" size="xs" onClick={() => addProfile()}>
            <Plus /> New
          </Button>
        </div>
        {profiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No profiles yet. Create one to connect to a server.</p>
        ) : (
          <ul className="space-y-1" aria-label="Profiles">
            {profiles.map((p) => (
              <li key={p.id}>
                {renaming?.id === p.id ? (
                  <Input
                    autoFocus
                    aria-label="Profile name"
                    value={renaming.text}
                    onChange={(e) => setRenaming({ id: p.id, text: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                    maxLength={80}
                    className="h-8"
                  />
                ) : (
                  <button
                    type="button"
                    aria-current={p.id === activeProfileId ? 'true' : undefined}
                    onClick={() => setActiveProfile(p.id)}
                    className={cn(
                      'w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                      p.id === activeProfileId && 'bg-accent font-medium',
                    )}
                  >
                    {p.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {active && (
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setRenaming({ id: active.id, text: active.name })}
            >
              Rename
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                const copy = duplicateProfile(active.id)
                if (copy) setActiveProfile(copy.id)
              }}
            >
              Duplicate
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={profiles.length === 0}
            onClick={() => downloadBlob(EXPORT_FILENAME, exportProfiles(profiles), 'application/json')}
          >
            Export
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => fileInput.current?.click()}>
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Import profiles file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              void onImportFile(file)
            }}
          />
        </div>
        {importMessage && (
          <p
            role={importMessage.ok ? 'status' : 'alert'}
            className={cn('text-xs', importMessage.ok ? 'text-muted-foreground' : 'text-destructive')}
          >
            {importMessage.text}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Exports never include secret values.</p>
      </div>

      {active && <ProfileEditor key={active.id} profile={active} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete profile?</AlertDialogTitle>
            <AlertDialogDescription>
              {active ? `"${active.name}"` : 'This profile'} and its saved secrets and history will be deleted from this
              browser. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (active) deleteProfile(active.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
