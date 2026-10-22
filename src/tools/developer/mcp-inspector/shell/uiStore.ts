import { create } from 'zustand'

export type TabId = 'tools' | 'resources' | 'prompts' | 'raw' | 'conformance' | 'client'

export interface RawDraft {
  method: string
  paramsText: string
  nonce: number
}

interface UiState {
  activeTab: TabId
  setActiveTab(t: TabId): void
  rawDraft: RawDraft | null
  /** Last nonce handed out; kept across `setRawDraft(null)` so a later draft always has a larger nonce. */
  draftNonce: number
  setRawDraft(d: { method: string; paramsText: string } | null): void
}

/** Runtime (NOT persisted) UI state shared between the log drawer and the tabs. */
export const useUiStore = create<UiState>()((set) => ({
  activeTab: 'tools',
  setActiveTab: (activeTab) => set({ activeTab }),
  rawDraft: null,
  draftNonce: 0,
  setRawDraft: (d) =>
    set((s) =>
      d === null
        ? { rawDraft: null }
        : {
            rawDraft: { method: d.method, paramsText: d.paramsText, nonce: s.draftNonce + 1 },
            draftNonce: s.draftNonce + 1,
          },
    ),
}))
