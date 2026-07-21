import { cn } from '@/lib/utils'

interface SliderProps {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  className?: string
  id?: string
}

export function Slider({ min, max, step, value, onChange, className, id }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={cn('relative flex w-full items-center', className)}>
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div className="absolute h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  )
}
