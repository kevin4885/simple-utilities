import { ProtocolError, type Client, type ClientCapabilities, type CreateMessageResult, type ElicitResult } from '@modelcontextprotocol/client'
import type { ClientFeatureSetup } from '../connection/types'
import {
  capabilitiesFromSettings,
  rootsResult,
  SAMPLING_REJECT_CODE,
  SAMPLING_REJECT_MESSAGE,
  snapshotSettings,
} from './logic'
import { useClientPending } from './pendingStore'
import { useClientSettings } from './settingsStore'

// Answers server-to-client requests (roots / sampling / elicitation) for the connection layer.
//
// Lifetime model: McpSession calls `configure(client)` once per connection attempt (before connect) and
// `dispose()` once per teardown of that attempt - but a slow `close()` can make an OLD attempt's dispose()
// arrive after the NEXT attempt's configure(). So nothing here is shared between connections:
//  - every configure() creates its own context (id + the handlers of that client);
//  - every pending request is tagged with its context id and is rejected only by that context's disposal;
//  - dispose() takes no argument and the session pairs each configure with exactly one dispose, in order,
//    so it disposes the OLDEST context that is still live - never the newest;
//  - as a second, order-independent safety net, each request is also cancelled by its own
//    `ctx.mcpReq.signal`, which the SDK aborts when THAT client closes.

export interface ClientFeatureSetupOptions {
  /**
   * Declare `roots.listChanged` so the Client tab announces roots edits with `notifications/roots/list_changed`.
   * The app declares plain `{roots:{}}` (false); the option exists for servers/tests that need the notification.
   */
  rootsListChanged?: boolean
}

const DISCONNECTED = 'Disconnected before the request was answered'

export function createClientFeatureSetup(options: ClientFeatureSetupOptions = {}): ClientFeatureSetup {
  /** Context ids of configure() calls that have not been disposed yet, oldest first. */
  const live: number[] = []
  let nextCtxId = 1

  function currentCapabilities(): ClientCapabilities {
    const caps = capabilitiesFromSettings(useClientSettings.getState())
    if (options.rootsListChanged && caps.roots) caps.roots = { listChanged: true }
    return caps
  }

  return {
    // Read by the session when it builds the Client, i.e. at connect time.
    get capabilities() {
      return currentCapabilities()
    },

    configure(client: Client): void {
      const settings = useClientSettings.getState()
      const ctxId = nextCtxId++

      const rootsAtConnect = settings.roots.items.map((r) => ({ ...r }))
      if (settings.roots.enabled) {
        // Answered at once from the settings, without asking the user. Without roots.listChanged the server
        // sees the list as it was at connect time (edits need a reconnect); with it the list is live.
        client.setRequestHandler('roots/list', () =>
          rootsResult(options.rootsListChanged ? useClientSettings.getState().roots.items : rootsAtConnect),
        )
      }
      if (settings.sampling.enabled) {
        client.setRequestHandler(
          'sampling/createMessage',
          (request, rpc) =>
            useClientPending.getState().enqueue({
              ctxId,
              kind: 'sampling',
              params: request.params,
              signal: rpc.mcpReq.signal,
            }) as Promise<CreateMessageResult>,
        )
      }
      if (settings.elicitation.enabled) {
        client.setRequestHandler(
          'elicitation/create',
          (request, rpc) =>
            useClientPending.getState().enqueue({
              ctxId,
              kind: 'elicitation',
              params: request.params,
              signal: rpc.mcpReq.signal,
            }) as Promise<ElicitResult>,
        )
      }

      // Registered only once every handler is in place: if a registration above throws, the session treats this
      // configure() as failed and never pairs it with a dispose(), so it must not occupy a slot in live.
      live.push(ctxId)
      useClientPending.getState().setApplied(ctxId, snapshotSettings(settings, currentCapabilities()))
    },

    dispose(): void {
      const ctxId = live.shift()
      if (ctxId === undefined) return
      const store = useClientPending.getState()
      store.disposeContext(ctxId, new Error(DISCONNECTED))
      store.clearApplied(ctxId)
    },
  }
}

/** The instance the shell passes to `createSession`. */
export const clientFeatureSetup: ClientFeatureSetup = createClientFeatureSetup()

/** The JSON-RPC error a rejected sampling request is answered with (code -1). */
export function samplingRejection(): ProtocolError {
  return new ProtocolError(SAMPLING_REJECT_CODE, SAMPLING_REJECT_MESSAGE)
}
