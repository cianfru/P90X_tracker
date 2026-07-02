import { lazy, Suspense, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { Session, WorkoutTemplate } from '../db'
import type { Intensity } from './intensity'
import { Card } from './ui'
import { SessionDetail } from './SessionDetail'

// Leaflet is heavy — load it only when the Map tab is opened.
const TravelMap = lazy(() =>
  import('./TravelMap').then((m) => ({ default: m.TravelMap })),
)

export function MapTab({
  sessions,
  templates,
  intensity,
  located,
  places,
}: {
  sessions: Session[]
  templates: WorkoutTemplate[]
  intensity: Map<string, Intensity>
  located: number
  places: number
}) {
  const [open, setOpen] = useState<{ id: string; score: number } | null>(null)

  if (open) {
    return (
      <SessionDetail
        sessionId={open.id}
        score={open.score}
        onBack={() => setOpen(null)}
      />
    )
  }

  if (located === 0) {
    return (
      <div className="mt-10 text-center text-sm text-ink-3">
        No located sessions yet — add a location when you train and they'll
        appear on the map.
      </div>
    )
  }

  return (
    <Card
      title="Training around the world"
      subtitle={`${located.toLocaleString()} sessions · ${places} places · tap a dot, then a session`}
      right={<MapPin size={16} className="text-[#33cbff]" />}
    >
      <Suspense
        fallback={
          <div className="py-12 text-center text-xs text-ink-3">
            Loading map…
          </div>
        }
      >
        <TravelMap
          sessions={sessions}
          templates={templates}
          intensity={intensity}
          onOpenSession={(id, score) => setOpen({ id, score })}
        />
      </Suspense>
    </Card>
  )
}
