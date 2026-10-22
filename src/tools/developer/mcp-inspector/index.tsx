/**
 * MCP Inspector
 *
 * Full-bleed layout (flex flex-col h-full overflow-hidden): profile sidebar, connection
 * summary/diagnostics, tab host, and a collapsible message log. All state lives in the shell
 * folder (see ./shell); this file only mounts it.
 */

import McpInspectorShell from './shell/McpInspectorShell'

export default function McpInspector() {
  return <McpInspectorShell />
}
