import type { PlanItem } from '@/types/chat'

// A turn's to-do list, from the `plan_updated` stream event: the whole list each
// time it changes, each item pending → in_progress → completed (or failed).

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'failed'])

/** The event's items as PlanItems — malformed rows dropped — or null when there are none. */
export function toPlan(items: unknown): PlanItem[] | null {
  if (!Array.isArray(items)) return null
  const plan = items.flatMap((item): PlanItem[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || !STATUSES.has(row.status as string)) return []
    return [{ id: row.id, title: row.title, status: row.status as PlanItem['status'] }]
  })
  return plan.length > 0 ? plan : null
}
