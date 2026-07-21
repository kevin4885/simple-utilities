import { Waves } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function LlanoCastellPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Llano River @ Castell</h1>
        <p className="mt-1 text-sm text-muted-foreground">USGS Gauge 08150700</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Waves className="h-5 w-5 text-primary" />
            Coming Soon
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This tool will display real-time river level and CFS (cubic feet per second) readings
            for the <strong className="text-foreground">Llano River at Castell, TX</strong> using
            USGS gauge <code className="rounded bg-muted px-1 py-0.5 text-xs">08150700</code>.
          </p>
          <p>Planned features:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Current stage (ft) and discharge (CFS)</li>
            <li>7-day hydrograph chart</li>
            <li>Flood stage thresholds</li>
            <li>Swimming/paddling suitability indicator</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
