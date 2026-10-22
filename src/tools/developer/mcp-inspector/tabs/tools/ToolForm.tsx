import { useMemo } from 'react'
import CodeEditor from '@/components/editor/CodeEditor'
import { Button } from '@/components/ui/button'
import { SchemaForm, supportsForm, type FieldError } from '../../schema-form'
import { formBlockedReason, parseArgsText, type McpTool, type ToolDraft } from './logic'

// Argument editor for one tool: a Form/JSON toggle over the schema form or a JSON editor.
// The draft is owned by the caller; every schema string is rendered as text by SchemaForm.

export interface ToolFormProps {
  tool: McpTool
  draft: ToolDraft
  onDraftChange(next: ToolDraft): void
  onModeChange(to: ToolDraft['mode']): void
  /** Field errors from a failed validation (form mode). */
  formErrors: FieldError[]
  /** Errors found while converting the form to JSON; shown above the JSON editor. */
  switchErrors: FieldError[]
  notice: string | null
  disabled: boolean
}

const pathText = (e: FieldError): string => (e.path === '' ? e.message : `${e.path}: ${e.message}`)

export function ToolForm({ tool, draft, onDraftChange, onModeChange, formErrors, switchErrors, notice, disabled }: ToolFormProps) {
  const schemaSupport = useMemo(() => supportsForm(tool.inputSchema), [tool.inputSchema])
  const blocked = useMemo(() => formBlockedReason(tool.inputSchema, draft), [tool.inputSchema, draft])
  const jsonError = useMemo(() => {
    if (draft.mode !== 'json') return null
    const parsed = parseArgsText(draft.jsonText)
    return parsed.ok ? null : parsed.error
  }, [draft.mode, draft.jsonText])

  return (
    <section aria-label="Arguments" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Arguments</h3>
        <div role="group" aria-label="Argument editor" className="ml-auto flex gap-1">
          <Button
            type="button"
            size="xs"
            variant={draft.mode === 'form' ? 'default' : 'outline'}
            aria-pressed={draft.mode === 'form'}
            disabled={disabled || (draft.mode !== 'form' && blocked !== null)}
            title={blocked ?? undefined}
            // A disabled button swallows pointer events by default, which would hide the reason in its title.
            className="disabled:pointer-events-auto"
            onClick={() => onModeChange('form')}
          >
            Form
          </Button>
          <Button
            type="button"
            size="xs"
            variant={draft.mode === 'json' ? 'default' : 'outline'}
            aria-pressed={draft.mode === 'json'}
            disabled={disabled}
            onClick={() => onModeChange('json')}
          >
            JSON
          </Button>
        </div>
      </div>

      {!schemaSupport.ok && (
        <p className="text-xs text-muted-foreground" data-testid="form-unavailable">
          Form unavailable: {schemaSupport.reason}. Edit the arguments as JSON.
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground" data-testid="mode-notice">
          {notice}
        </p>
      )}

      {draft.mode === 'form' ? (
        <SchemaForm
          schema={tool.inputSchema}
          value={draft.formValue}
          errors={formErrors}
          disabled={disabled}
          onChange={(formValue) => onDraftChange({ ...draft, formValue })}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {switchErrors.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/50 p-2 text-xs text-destructive" data-testid="switch-errors">
              <p className="font-medium">The form has errors, so the JSON starts empty:</p>
              <ul className="list-disc pl-4">
                {switchErrors.map((e, i) => (
                  <li key={i}>{pathText(e)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="h-56 overflow-hidden rounded-md border" data-testid="json-editor">
            <CodeEditor
              value={draft.jsonText}
              language="json"
              height="100%"
              readOnly={disabled}
              onChange={(jsonText) => onDraftChange({ ...draft, jsonText })}
            />
          </div>
          {jsonError !== null && (
            <p role="alert" className="text-xs text-destructive" data-testid="json-error">
              Invalid JSON: {jsonError}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
