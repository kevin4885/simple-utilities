import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMediaQuery } from '@/lib/useMediaQuery'
import ClientFeatureHost from '../client-features/Host'
import type { Diagnosis, ServerSummary, SessionState } from '../connection/types'
import { getSecret } from '../secrets'
import { useMcpInspectorStore } from '../store'
import { ConnectionSidebar } from './ConnectionSidebar'
import { LogDrawer } from './LogDrawer'
import { diagnosisToText, MIXED_CONTENT_WARNING, preflight, statusLabel, summaryRows } from './logic'
import { TabHost } from './TabHost'
import { useConnection } from './useConnection'
import { copyText } from './viewerIo'

function StatusBadge({ state }: { state: SessionState }) {
  const variant =
    state.status === 'connected' ? 'default' : state.status === 'error' ? 'destructive' : 'secondary'
  return (
    <Badge variant={variant} data-testid="status-badge">
      {statusLabel(state)}
    </Badge>
  )
}

function Summary({ info }: { info: ServerSummary }) {
  return (
    <div className="space-y-2" data-testid="server-summary">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {summaryRows(info).map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="break-all">{r.value}</dd>
          </div>
        ))}
      </dl>
      {info.instructions !== null && info.instructions !== '' && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="xs">
              Server instructions
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {/* Server-supplied text: rendered as plain text only. */}
            <p className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
              {info.instructions}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function DiagnosisPanel({ diagnosis }: { diagnosis: Diagnosis }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <div role="alert" className="space-y-2 rounded-md border border-destructive/50 p-3 text-sm">
      <p className="font-semibold text-destructive">{diagnosis.title}</p>
      <p className="whitespace-pre-wrap">{diagnosis.detail}</p>
      {diagnosis.httpStatus !== null && <p className="text-muted-foreground">HTTP status: {diagnosis.httpStatus}</p>}
      {diagnosis.hints.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {diagnosis.hints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={async () => setCopyState((await copyText(diagnosisToText(diagnosis))) ? 'copied' : 'failed')}
        >
          Copy diagnostics
        </Button>
        {copyState === 'copied' && <span className="text-xs text-muted-foreground">Copied</span>}
        {copyState === 'failed' && <span className="text-xs text-destructive">Copy failed</span>}
      </div>
    </div>
  )
}

export default function McpInspectorShell() {
  const profiles = useMcpInspectorStore((s) => s.profiles)
  const activeProfileId = useMcpInspectorStore((s) => s.activeProfileId)
  const addProfile = useMcpInspectorStore((s) => s.addProfile)
  const profile = profiles.find((p) => p.id === activeProfileId) ?? null

  const conn = useConnection(profile)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [logOpen, setLogOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const pre = profile ? preflight(profile, getSecret, window.location.protocol) : null
  const { state } = conn
  const busy = state.status === 'connecting' || state.status === 'auth-required'
  const canConnect = pre !== null && pre.canConnect && !busy && state.status !== 'connected'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex min-h-0 flex-1">
        {!isMobile && (
          <aside className="w-80 shrink-0 overflow-y-auto border-r" aria-label="Connection profiles">
            <ConnectionSidebar />
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 space-y-3 border-b p-3">
            <div className="flex flex-wrap items-center gap-2">
              {isMobile && (
                <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" size="sm">
                      <Menu /> Profiles
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-80 max-w-[90vw] overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle>Connection</SheetTitle>
                      <SheetDescription>Profiles and connection settings</SheetDescription>
                    </SheetHeader>
                    <ConnectionSidebar />
                  </SheetContent>
                </Sheet>
              )}
              <h1 className="truncate text-sm font-semibold">{profile ? profile.name : 'MCP Inspector'}</h1>
              <StatusBadge state={state} />
              <div className="ml-auto flex gap-2">
                {state.status === 'connected' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void conn.disconnect()}>
                    Disconnect
                  </Button>
                ) : state.status === 'auth-required' ? null : state.status === 'connecting' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void conn.disconnect()}>
                    Cancel
                  </Button>
                ) : (
                  <Button type="button" size="sm" disabled={!canConnect} onClick={() => void conn.connect()}>
                    Connect
                  </Button>
                )}
              </div>
            </div>

            {!profile && (
              <p className="text-sm text-muted-foreground">
                No profile selected.{' '}
                <Button type="button" variant="link" className="h-auto p-0" onClick={() => addProfile()}>
                  Create a profile
                </Button>{' '}
                to connect to an MCP server.
              </p>
            )}

            {pre?.mixedContent && state.status !== 'connected' && (
              <p role="status" className="rounded-md border p-2 text-xs text-muted-foreground" data-testid="mixed-content-warning">
                <span className="font-semibold">Mixed content: </span>
                {MIXED_CONTENT_WARNING}
              </p>
            )}

            {state.status === 'auth-required' && (
              <div className="flex items-center gap-2 text-sm" role="status">
                <span>Waiting for authorization…</span>
                <Button type="button" variant="outline" size="xs" onClick={() => void conn.cancelAuth()}>
                  Cancel
                </Button>
              </div>
            )}

            {state.status === 'error' && <DiagnosisPanel diagnosis={state.diagnosis} />}

            {state.status === 'connected' && <Summary info={state.info} />}
          </div>

          <TabHost
            state={state}
            session={conn.session}
            sessionOptions={conn.sessionOptions}
            profileId={profile?.id ?? null}
            epoch={conn.epoch}
          />
        </main>
      </div>
      <LogDrawer open={logOpen} onOpenChange={setLogOpen} />
      <ClientFeatureHost />
    </div>
  )
}
