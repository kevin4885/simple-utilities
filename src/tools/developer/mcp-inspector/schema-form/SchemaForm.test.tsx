import { useState } from 'react'
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaForm } from './SchemaForm'
import { initialFormValue, toArguments, type FieldError, type FormValue, type JsonSchema } from './index'

function Harness({
  schema,
  initial,
  errors,
  disabled,
  onValue,
}: {
  schema: JsonSchema
  initial?: FormValue
  errors?: FieldError[]
  disabled?: boolean
  onValue?: (v: FormValue) => void
}) {
  const [value, setValue] = useState<FormValue>(initial ?? initialFormValue(schema))
  return (
    <SchemaForm
      schema={schema}
      value={value}
      errors={errors}
      disabled={disabled}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
    />
  )
}

const args = (schema: JsonSchema, value: FormValue) => {
  const r = toArguments(schema, value)
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.arguments
}

describe('SchemaForm', () => {
  // jsdom lacks the DOM APIs Radix Select touches when its listbox opens.
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => {}
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.releasePointerCapture ??= () => {}
  })

  it('renders title-or-key labels and descriptions', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        plain: { type: 'string', description: 'The plain one' },
        titled: { type: 'string', title: 'Nice Title' },
      },
    }
    render(<Harness schema={schema} />)
    expect(screen.getByText('plain')).toBeInTheDocument()
    expect(screen.getByText('Nice Title')).toBeInTheDocument()
    expect(screen.getByText('The plain one')).toBeInTheDocument()
  })

  it('marks required fields only', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['must'],
      properties: { must: { type: 'string' }, may: { type: 'string' } },
    }
    render(<Harness schema={schema} />)
    expect(screen.getByTestId('field-must').querySelector('label')?.textContent).toContain('*')
    expect(screen.getByTestId('field-may').querySelector('label')?.textContent).not.toContain('*')
    expect(screen.getByRole('textbox', { name: /must/ })).toHaveAttribute('aria-required', 'true')
  })

  it('typing in a string input calls onChange and round-trips through toArguments', async () => {
    const schema: JsonSchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    await userEvent.type(screen.getByRole('textbox', { name: /name/ }), 'abc')
    expect(onValue).toHaveBeenCalled()
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ name: 'abc' })
  })

  it('number input keeps text and converts in toArguments', async () => {
    const schema: JsonSchema = { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    await userEvent.type(screen.getByRole('textbox', { name: /n/ }), '42')
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ n: 42 })
  })

  it('boolean renders a checkbox that toggles', async () => {
    const schema: JsonSchema = { type: 'object', required: ['flag'], properties: { flag: { type: 'boolean' } } }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    const box = screen.getByRole('checkbox', { name: /flag/ })
    expect(box).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(box)
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ flag: true })
  })

  it('enum renders the shadcn Select (combobox) and shows the chosen value', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['mode'],
      properties: { mode: { enum: ['fast', 'slow'] } },
    }
    render(<Harness schema={schema} initial={{ mode: 'slow' }} />)
    const trigger = screen.getByRole('combobox', { name: /mode/ })
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    expect(trigger).toHaveTextContent('slow')
  })

  it('enum selection round-trips non-string values', async () => {
    const schema: JsonSchema = { type: 'object', required: ['level'], properties: { level: { enum: [1, 2, 3] } } }
    const onValue = vi.fn()
    render(<Harness schema={schema} initial={{ level: 1 }} onValue={onValue} />)
    const trigger = screen.getByRole('combobox', { name: /level/ })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const option = await screen.findByRole('option', { name: '3' })
    fireEvent.click(option)
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ level: 3 })
  })

  it('optional fields have an include checkbox and are disabled until included', async () => {
    const schema: JsonSchema = { type: 'object', properties: { note: { type: 'string' } } }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    const include = screen.getByRole('checkbox', { name: 'Include note' })
    const input = screen.getByRole('textbox', { name: /note/ })
    expect(include).toHaveAttribute('aria-checked', 'false')
    expect(input).toBeDisabled()
    expect(args(schema, { })).toEqual({})

    await userEvent.click(include)
    expect(input).toBeEnabled()
    await userEvent.type(input, 'hi')
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ note: 'hi' })

    await userEvent.click(include)
    expect(input).toBeDisabled()
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({})
  })

  it('required fields have no include checkbox', () => {
    const schema: JsonSchema = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } }
    render(<Harness schema={schema} />)
    expect(screen.queryByRole('checkbox', { name: /Include/ })).toBeNull()
  })

  it('including an optional field applies its default', async () => {
    const schema: JsonSchema = { type: 'object', properties: { n: { type: 'number', default: 7 } } }
    render(<Harness schema={schema} initial={{}} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include n' }))
    expect(screen.getByRole('textbox', { name: /n/ })).toHaveValue('7')
  })

  it('arrays have Add and Remove controls that produce and remove rows', async () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['tags'],
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    const add = screen.getByRole('button', { name: /Add tags item/ })
    await userEvent.click(add)
    await userEvent.click(add)
    const rows = screen.getAllByRole('textbox')
    expect(rows).toHaveLength(2)
    await userEvent.type(rows[0], 'a')
    await userEvent.type(rows[1], 'b')
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ tags: ['a', 'b'] })

    await userEvent.click(screen.getByRole('button', { name: /Remove tags item 1/ }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ tags: ['b'] })
  })

  it('renders nested objects and arrays of objects', async () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['address', 'items'],
      properties: {
        address: { type: 'object', required: ['zip'], properties: { zip: { type: 'string' } } },
        items: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
      },
    }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    await userEvent.type(screen.getByRole('textbox', { name: /zip/ }), '9')
    await userEvent.click(screen.getByRole('button', { name: /Add items item/ }))
    await userEvent.type(within(screen.getByTestId('field-items[0].name')).getByRole('textbox'), 'n')
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ address: { zip: '9' }, items: [{ name: 'n' }] })
  })

  it('nullable fields get a null toggle that yields an explicit null', async () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['maybe'],
      properties: { maybe: { type: ['string', 'null'] } },
    }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    const toggle = screen.getByRole('checkbox', { name: /Set maybe to null/ })
    const input = screen.getByRole('textbox', { name: /maybe/ })
    await userEvent.click(toggle)
    expect(input).toBeDisabled()
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ maybe: null })
    await userEvent.click(toggle)
    expect(input).toBeEnabled()
    await userEvent.type(input, 'x')
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ maybe: 'x' })
  })

  it('unsupported fields render a JSON textarea', async () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['blob'],
      properties: { blob: { $ref: '#/$defs/x' }, other: { type: 'string' } },
    }
    const onValue = vi.fn()
    render(<Harness schema={schema} onValue={onValue} />)
    const area = screen.getByRole('textbox', { name: /blob/ })
    expect(area.tagName).toBe('TEXTAREA')
    fireEvent.change(area, { target: { value: '{"a":1}' } })
    expect(args(schema, onValue.mock.lastCall![0])).toEqual({ blob: { a: 1 } })
  })

  it('renders errors under the matching field and sets aria-invalid', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    }
    render(<Harness schema={schema} errors={[{ path: 'a', message: 'Required' }]} />)
    const a = screen.getByRole('textbox', { name: /a/ })
    const b = screen.getByRole('textbox', { name: /^b/ })
    expect(a).toHaveAttribute('aria-invalid', 'true')
    expect(b).not.toHaveAttribute('aria-invalid')
    const alert = within(screen.getByTestId('field-a')).getByRole('alert')
    expect(alert).toHaveTextContent('Required')
    expect(a.getAttribute('aria-describedby')).toBe(alert.parentElement!.id)
    expect(within(screen.getByTestId('field-b')).queryByRole('alert')).toBeNull()
  })

  it('shows errors for nested and indexed paths and the root', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['address', 'items'],
      properties: {
        address: { type: 'object', required: ['zip'], properties: { zip: { type: 'string' } } },
        items: { type: 'array', items: { type: 'string' } },
      },
    }
    render(
      <Harness
        schema={schema}
        initial={{ address: { zip: '' }, items: ['x'] }}
        errors={[
          { path: 'address.zip', message: 'Bad zip' },
          { path: 'items[0]', message: 'Bad item' },
          { path: '', message: 'Root problem' },
        ]}
      />,
    )
    expect(within(screen.getByTestId('field-address.zip')).getByRole('alert')).toHaveTextContent('Bad zip')
    expect(within(screen.getByTestId('field-items[0]')).getByRole('alert')).toHaveTextContent('Bad item')
    expect(screen.getByText('Root problem')).toBeInTheDocument()
  })

  it('disabled disables every control', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['s', 'b', 'e', 'arr', 'j'],
      properties: {
        s: { type: 'string' },
        b: { type: 'boolean' },
        e: { enum: ['x', 'y'] },
        arr: { type: 'array', items: { type: 'string' } },
        j: { $ref: '#/x' },
        opt: { type: ['string', 'null'] },
      },
    }
    render(<Harness schema={schema} initial={{ s: '', b: false, e: 'x', arr: ['one'], j: '' }} disabled />)
    for (const el of [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('checkbox'), ...screen.queryAllByRole('combobox'), ...screen.queryAllByRole('button')]) {
      expect(el).toBeDisabled()
    }
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('combobox').length).toBe(1)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(1)
  })

  it('renders an HTML-looking description and title as literal text', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        evil: { type: 'string', description: payload, title: payload },
        pick: { enum: [payload, 'ok'], description: payload },
      },
    }
    const { container } = render(<Harness schema={schema} initial={{ evil: '', pick: payload }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getAllByText(payload).length).toBeGreaterThanOrEqual(2)
  })

  it('shows a message for a schema without properties', () => {
    render(<Harness schema={{ type: 'object' }} />)
    expect(screen.getByText(/no properties/i)).toBeInTheDocument()
  })

  it('does not crash on a malformed schema', () => {
    expect(() => render(<Harness schema={5 as unknown as JsonSchema} />)).not.toThrow()
  })
})
