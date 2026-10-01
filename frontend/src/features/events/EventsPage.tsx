import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCan } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { eventsApi } from '../../lib/api'
import { apiAssetUrl } from '../../lib/http'
import type { EventType } from '../../types'

const filters: Array<EventType | 'All'> = ['All', 'In-Person', 'Online', 'Hybrid']

export function EventsPage() {
  const [filter, setFilter] = useState<EventType | 'All'>('All')
  const queryClient = useQueryClient()
  // Admins run events rather than attend them.
  const canRegister = useCan('events.register')

  const { data, isLoading, error } = useQuery({
    queryKey: ['events', filter],
    queryFn: () => eventsApi.list(filter === 'All' ? undefined : filter),
  })

  const register = useMutation({
    mutationFn: ({ eventId, registered }: { eventId: string; registered: boolean }) =>
      registered ? eventsApi.cancel(eventId) : eventsApi.register(eventId),
    // Refetch rather than patching local state: attendee counts change too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  })

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Events & opportunities</span>
          <h1>Reunions, career fairs, webinars, and networking</h1>
          <p>Stay connected with the Strathmore community through events built for students and alumni alike.</p>
        </div>
      </div>

      <div className="filter-tabs">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            className={filter === item ? 'filter-tab active' : 'filter-tab'}
            onClick={() => setFilter(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.events.length === 0}
        emptyMessage="No events match this filter yet."
      >
        <div className="event-list">
          {(data?.events ?? []).map((event) => (
            <div className="event-card" key={event.id}>
              <span className={event.type === 'Online' ? 'event-tag alt' : 'event-tag'}>{event.tag}</span>
              {event.cancelled && <span className="status busy">Cancelled</span>}
              <h3>{event.title}</h3>
              <p>
                {event.date} · {event.time}
              </p>
              <p className="muted-line">{event.location}</p>
              <p className="muted-line">{event.description}</p>
              <p className="muted-line">
                {event.attendeeCount} registered
                {!event.cancelled && (
                  <>
                    {' · '}
                    <a className="link-btn" href={apiAssetUrl(`/api/events/${event.id}/calendar.ics`)} download>
                      Add to calendar
                    </a>
                  </>
                )}
              </p>
              {/* A cancelled event stays listed so registrants find out, but
                  cannot be registered for. Cancelling one's own registration
                  still works. */}
              {canRegister && (!event.cancelled || event.registered) && (
                <button
                  className={event.registered ? 'secondary-btn' : 'primary-btn'}
                  type="button"
                  disabled={register.isPending}
                  onClick={() => register.mutate({ eventId: event.id, registered: event.registered })}
                >
                  {event.registered ? 'Cancel registration' : 'Register'}
                </button>
              )}
            </div>
          ))}
        </div>
      </QueryState>
    </section>
  )
}
