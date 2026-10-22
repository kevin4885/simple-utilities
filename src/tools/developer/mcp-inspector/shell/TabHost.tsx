import type { ComponentType } from 'react'
import type { McpSession } from '../connection/session'
import type { ServerSummary, SessionState } from '../connection/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import ClientTab from '../tabs/client/ClientTab'
import ConformanceTab from '../tabs/conformance/ConformanceTab'
import PromptsTab from '../tabs/prompts/PromptsTab'
import RawTab from '../tabs/raw/RawTab'
import ResourcesTab from '../tabs/resources/ResourcesTab'
import ToolsTab from '../tabs/tools/ToolsTab'
import {
  isTabEnabled,
  resolveActiveTab,
  TAB_DEFS,
  TAB_DISABLED_REASON,
  type TabProps,
} from './logic'
import { useUiStore, type TabId } from './uiStore'
import type { SessionBaseOptions } from './useConnection'

// Tabs are listed statically: adding a tab touches only its own file.
const TAB_COMPONENTS: Record<TabId, ComponentType<TabProps>> = {
  tools: ToolsTab,
  resources: ResourcesTab,
  prompts: PromptsTab,
  raw: RawTab,
  conformance: ConformanceTab,
  client: ClientTab,
}

export interface TabHostProps {
  state: SessionState
  session: McpSession | null
  sessionOptions: SessionBaseOptions | null
  profileId: string | null
  /** Increments on every successful connect; the active tab is remounted when it changes. */
  epoch: number
  className?: string
}

export function TabHost({ state, session, sessionOptions, profileId, epoch, className }: TabHostProps) {
  const requested = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)

  const info: ServerSummary | null = state.status === 'connected' ? state.info : null
  const ready = info !== null && session !== null && sessionOptions !== null && profileId !== null
  const capabilities = info?.capabilities ?? {}
  const active = resolveActiveTab(requested, capabilities)
  const ActiveTab = TAB_COMPONENTS[active]

  return (
    <Tabs
      value={active}
      onValueChange={(v) => setActiveTab(v as TabId)}
      className={cn('flex min-h-0 flex-1 flex-col gap-0', className)}
    >
      <TabsList variant="line" className="h-auto w-full shrink-0 justify-start overflow-x-auto border-b px-2">
        {TAB_DEFS.map((t) => {
          const enabled = ready && isTabEnabled(t.id, capabilities)
          // Before connecting nothing is selectable, but there is nothing to explain either.
          const reason = ready && !enabled ? TAB_DISABLED_REASON : undefined
          return (
            <TabsTrigger
              key={t.id}
              value={t.id}
              disabled={!enabled}
              title={reason}
              // Disabled triggers swallow pointer events by default, which would hide the tooltip.
              className="flex-none disabled:pointer-events-auto"
            >
              {t.label}
            </TabsTrigger>
          )
        })}
      </TabsList>
      <div className="min-h-0 flex-1 overflow-auto">
        {ready ? (
          <TabsContent key={`${active}:${epoch}`} value={active} className="h-full">
            <ActiveTab session={session} info={info} sessionOptions={sessionOptions} profileId={profileId} />
          </TabsContent>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Connect to a server to begin.</p>
        )}
      </div>
    </Tabs>
  )
}
