import type { ServerSummary } from '../connection/types'
import { REDACTED } from '../connection/logic'
import { CHECK_STATUSES, type CheckCounts, type CheckResult, type CheckStatus } from './types'

export const REPORT_TOOL_NAME = 'Simple Utilities MCP Inspector'

export interface ConformanceReport {
  generatedAt: string
  tool: typeof REPORT_TOOL_NAME
  server: {
    name: string
    version: string
    protocolVersion: string
    transport: ServerSummary['transport']
    capabilities: Record<string, unknown>
  }
  results: { id: string; status: CheckStatus; message: string }[]
  counts: CheckCounts
}

export function countResults(results: Pick<CheckResult, 'status'>[]): CheckCounts {
  const counts: CheckCounts = { pass: 0, fail: 0, warn: 0, skip: 0, info: 0, total: 0 }
  for (const r of results) {
    if (CHECK_STATUSES.includes(r.status)) counts[r.status] += 1
    counts.total += 1
  }
  return counts
}

function scrub(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join(REDACTED)
  return out
}

/**
 * Builds the exportable report. Fields are picked one by one: the server summary also carries the
 * session id, and header values live in the session options - none of that may leak here.
 * `secrets` (header values, session id) are scrubbed out of messages as defence in depth.
 */
export function buildReport(
  results: CheckResult[],
  info: ServerSummary,
  now: number | Date,
  secrets: string[] = [],
): ConformanceReport {
  return {
    generatedAt: new Date(now).toISOString(),
    tool: REPORT_TOOL_NAME,
    server: {
      name: info.serverName,
      version: info.serverVersion,
      protocolVersion: info.protocolVersion,
      transport: info.transport,
      capabilities: info.capabilities,
    },
    results: results.map((r) => ({ id: r.id, status: r.status, message: scrub(r.message, secrets) })),
    counts: countResults(results),
  }
}

function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ')
}

/** Markdown summary: a heading, the server line, the counts, and a table of id / status / message. */
export function buildMarkdown(report: ConformanceReport): string {
  const { server, counts } = report
  const lines = [
    '# MCP conformance report',
    '',
    `Server: ${cell(server.name)} ${cell(server.version)} (protocol ${cell(server.protocolVersion)}, ${server.transport})`,
    `Generated: ${report.generatedAt}`,
    `Pass: ${counts.pass} | Fail: ${counts.fail} | Warn: ${counts.warn} | Skip: ${counts.skip} | Info: ${counts.info}`,
    '',
    '| id | status | message |',
    '| --- | --- | --- |',
    ...report.results.map((r) => `| ${cell(r.id)} | ${r.status} | ${cell(r.message)} |`),
  ]
  return lines.join('\n') + '\n'
}
