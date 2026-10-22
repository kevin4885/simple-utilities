import { useId } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  blankValue,
  defaultFieldValue,
  describeField,
  enumOptions,
  indexPath,
  joinPath,
  jsonEqual,
  optionLabel,
  type FieldDesc,
  type FieldError,
  type FormValue,
  type JsonSchema,
} from './logic'

// Every string that comes from the server-supplied schema (title, description, enum labels, keys) is rendered
// as a React text child - never as HTML.

interface FormCtx {
  uid: string
  disabled: boolean
  errors: Map<string, string[]>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Copy of `rec` with `key` replaced (or removed when `value` is undefined), preserving key order. */
function withKey(rec: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const entries: [string, unknown][] = []
  let placed = false
  for (const [k, v] of Object.entries(rec)) {
    if (k === key) {
      placed = true
      if (value !== undefined) entries.push([k, value])
    } else {
      entries.push([k, v])
    }
  }
  if (!placed && value !== undefined) entries.push([key, value])
  return Object.fromEntries(entries)
}

function groupErrors(errors: FieldError[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const e of errors ?? []) {
    const list = map.get(e.path)
    if (list) list.push(e.message)
    else map.set(e.path, [e.message])
  }
  return map
}

function fieldDomId(ctx: FormCtx, path: string): string {
  return `${ctx.uid}-${path || 'root'}`
}

function ErrorText({ id, messages }: { id: string; messages: string[] | undefined }) {
  if (!messages || messages.length === 0) return null
  return (
    <div id={id} className="flex flex-col gap-0.5">
      {messages.map((m, i) => (
        <p key={i} role="alert" className="text-xs text-destructive">
          {m}
        </p>
      ))}
    </div>
  )
}

interface FieldProps {
  ctx: FormCtx
  label: string
  schema: unknown
  path: string
  value: unknown
  onChange: (v: unknown) => void
  /** Object property that is listed in `required`. */
  required?: boolean
  /** Array element: always included, no include checkbox and no required marker. */
  isItem?: boolean
}

function Field({ ctx, label, schema, path, value, onChange, required = false, isItem = false }: FieldProps) {
  const desc = describeField(schema)
  const id = fieldDomId(ctx, path)
  const labelId = `${id}-label`
  const errId = `${id}-error`
  const messages = ctx.errors.get(path)
  const invalid = !!messages && messages.length > 0

  const showInclude = !required && !isItem
  const included = isItem || required || value !== undefined
  const isNull = value === null && desc.nullable
  const controlDisabled = ctx.disabled || !included || isNull
  const shown = value === undefined || isNull ? blankValue(desc) : value
  const title = desc.title ?? label
  const isGroup = desc.kind === 'object' || desc.kind === 'array'

  return (
    <div
      className={cn('flex flex-col gap-1.5', !included && 'opacity-60')}
      data-testid={`field-${path}`}
      {...(isGroup ? { role: 'group', 'aria-labelledby': labelId } : {})}
    >
      <div className="flex flex-wrap items-center gap-2">
        {showInclude && (
          <Checkbox
            aria-label={`Include ${title}`}
            checked={included}
            disabled={ctx.disabled}
            onCheckedChange={(c) => onChange(c === true ? defaultFieldValue(desc) : undefined)}
          />
        )}
        <Label id={labelId} htmlFor={isGroup ? undefined : id} className="gap-1">
          {title}
          {required && !isItem && (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          )}
        </Label>
        {desc.nullable && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              aria-label={`Set ${title} to null`}
              checked={isNull}
              disabled={ctx.disabled || !included}
              onCheckedChange={(c) => onChange(c === true ? null : blankValue(desc))}
            />
            null
          </label>
        )}
      </div>
      {desc.description && <p className="text-xs text-muted-foreground">{desc.description}</p>}
      <Control
        ctx={ctx}
        desc={desc}
        id={id}
        labelId={labelId}
        path={path}
        title={title}
        shown={shown}
        onChange={onChange}
        required={required && !isItem}
        invalid={invalid}
        errId={messages ? errId : undefined}
        controlDisabled={controlDisabled}
      />
      <ErrorText id={errId} messages={messages} />
    </div>
  )
}

interface ControlProps {
  ctx: FormCtx
  desc: FieldDesc
  id: string
  labelId: string
  path: string
  title: string
  shown: unknown
  onChange: (v: unknown) => void
  required: boolean
  invalid: boolean
  errId: string | undefined
  controlDisabled: boolean
}

function Control(p: ControlProps) {
  const { ctx, desc, id, path, title, shown, onChange, controlDisabled } = p
  const aria = {
    'aria-invalid': p.invalid || undefined,
    'aria-describedby': p.errId,
    'aria-required': p.required || undefined,
  }

  switch (desc.kind) {
    case 'string':
      return (
        <Input
          id={id}
          type="text"
          value={typeof shown === 'string' ? shown : ''}
          disabled={controlDisabled}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      )
    case 'number':
    case 'integer':
      return (
        <Input
          id={id}
          type="text"
          inputMode={desc.kind === 'integer' ? 'numeric' : 'decimal'}
          value={typeof shown === 'number' || typeof shown === 'string' ? String(shown) : ''}
          disabled={controlDisabled}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      )
    case 'boolean':
      return (
        <Checkbox
          id={id}
          checked={shown === true}
          disabled={controlDisabled}
          onCheckedChange={(c) => onChange(c === true)}
          {...aria}
        />
      )
    case 'enum': {
      const options = enumOptions(desc.schema)
      const idx = options.findIndex((o) => jsonEqual(o, shown))
      return (
        <Select
          value={idx >= 0 ? String(idx) : ''}
          disabled={controlDisabled}
          onValueChange={(v) => onChange(options[Number(v)])}
        >
          <SelectTrigger id={id} className="w-full" {...aria}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o, i) => (
              <SelectItem key={i} value={String(i)}>
                {optionLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    case 'const':
      return (
        <p id={id} className="font-mono text-sm text-muted-foreground">
          {optionLabel(desc.schema.const)}
        </p>
      )
    case 'raw':
      return (
        <div className="flex flex-col gap-1">
          <Textarea
            id={id}
            className="min-h-24 font-mono text-xs"
            spellCheck={false}
            placeholder="JSON value"
            value={typeof shown === 'string' ? shown : ''}
            disabled={controlDisabled}
            onChange={(e) => onChange(e.target.value)}
            {...aria}
          />
          <p className="text-xs text-muted-foreground">
            This field&apos;s schema is not supported by the form; enter it as JSON.
          </p>
        </div>
      )
    case 'object':
      return (
        <div className="flex flex-col gap-3 border-l border-border pl-3">
          <ObjectFields
            ctx={{ ...ctx, disabled: controlDisabled }}
            schema={desc.schema}
            path={path}
            value={isRecord(shown) ? shown : {}}
            onChange={onChange}
          />
        </div>
      )
    case 'array': {
      const rows = Array.isArray(shown) ? shown : []
      const itemSchema = desc.schema.items
      const itemDesc = describeField(itemSchema)
      return (
        <div className="flex flex-col gap-2 border-l border-border pl-3">
          {rows.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  ctx={{ ...ctx, disabled: controlDisabled }}
                  label={`Item ${i + 1}`}
                  schema={itemSchema}
                  path={indexPath(path, i)}
                  value={row}
                  isItem
                  onChange={(v) => onChange(rows.map((r, j) => (j === i ? v : r)))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${title} item ${i + 1}`}
                disabled={controlDisabled}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Add ${title} item`}
              disabled={controlDisabled}
              onClick={() => onChange([...rows, defaultFieldValue(itemDesc)])}
            >
              <Plus />
              Add
            </Button>
          </div>
        </div>
      )
    }
  }
}

function ObjectFields({
  ctx,
  schema,
  path,
  value,
  onChange,
}: {
  ctx: FormCtx
  schema: JsonSchema
  path: string
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const props = isRecord(schema.properties) ? Object.entries(schema.properties) : []
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return (
    <>
      {props.map(([key, sub]) => (
        <Field
          key={key}
          ctx={ctx}
          label={key}
          schema={sub}
          path={joinPath(path, key)}
          value={Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined}
          required={required.has(key)}
          onChange={(v) => onChange(withKey(value, key, v))}
        />
      ))}
    </>
  )
}

export function SchemaForm(props: {
  schema: JsonSchema
  value: FormValue
  onChange(v: FormValue): void
  errors?: FieldError[]
  disabled?: boolean
}) {
  const uid = useId()
  const ctx: FormCtx = { uid, disabled: props.disabled === true, errors: groupErrors(props.errors) }
  const schema = isRecord(props.schema) ? props.schema : {}
  const hasProps = isRecord(schema.properties) && Object.keys(schema.properties).length > 0
  const rootErrors = ctx.errors.get('')

  return (
    <div className="flex flex-col gap-4">
      <ErrorText id={`${uid}-root-error`} messages={rootErrors} />
      {hasProps ? (
        <ObjectFields
          ctx={ctx}
          schema={schema}
          path=""
          value={isRecord(props.value) ? props.value : {}}
          onChange={props.onChange}
        />
      ) : (
        <p className="text-sm text-muted-foreground">This schema has no properties.</p>
      )}
    </div>
  )
}
