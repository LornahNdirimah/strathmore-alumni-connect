import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCan } from '../../app/SessionContext'
import { QueryState } from '../../components/ui/QueryState'
import { groupsApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { GroupVisibility } from '../../types'

type CommunitiesPageProps = {
  onOpenGroup: (groupId: string) => void
}

export function CommunitiesPage({ onOpenGroup }: CommunitiesPageProps) {
  const queryClient = useQueryClient()
  // Admins moderate but never join (ROADMAP D1); students and alumni join.
  const canJoin = useCan('communities.join')
  const canModerate = useCan('communities.moderate')
  const canCreate = useCan('communities.create')
  const [notice, setNotice] = useState<string | null>(null)

  // The server decides what this user may see: students get only groups
  // explicitly opened to them (DESIGN_BACKLOG #1), so there is no client-side
  // filtering to get wrong here.
  const { data, isLoading, error } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['groups'] })

  const membership = useMutation({
    mutationFn: ({ groupId, isMember }: { groupId: string; isMember: boolean }) =>
      isMember ? groupsApi.leave(groupId) : groupsApi.join(groupId),
    onSuccess: invalidate,
  })

  const removal = useMutation({
    mutationFn: (groupId: string) => groupsApi.remove(groupId),
    onSuccess: (result) => {
      setNotice(result.message)
      void invalidate()
    },
    onError: (error) =>
      setNotice(error instanceof ApiError ? error.message : 'Could not remove the group.'),
  })

  const visibility = useMutation({
    mutationFn: ({ groupId, next }: { groupId: string; next: GroupVisibility }) =>
      groupsApi.setVisibility(groupId, next),
    onSuccess: invalidate,
  })

  return (
    <section className="content-panel">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Communities</span>
          <h1>Collaboration groups across the alumni network</h1>
          <p>Join topic-focused groups to share resources, discuss industry trends, and support each other's growth.</p>
        </div>
      </div>

      {notice && <p className="success-msg">{notice}</p>}

      {canCreate && (
        <CreateCommunityForm
          onCreated={(message) => {
            setNotice(message)
            void invalidate()
          }}
        />
      )}

      <QueryState
        isLoading={isLoading}
        error={error}
        isEmpty={data?.groups.length === 0}
        emptyMessage="No groups are open to you yet."
      >
        <div className="group-grid">
          {(data?.groups ?? []).map((group) => (
            <article className="group-card" key={group.id}>
              <h3 onClick={() => onOpenGroup(group.id)}>{group.name}</h3>
              <p className="muted-line">{group.topic}</p>
              <p className="muted-line">{group.description}</p>

              <div className="chip-row">
                <span>{group.memberCount} members</span>
                <span>{group.visibility === 'alumni-only' ? 'Alumni only' : 'Open to students'}</span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button className="secondary-btn" type="button" onClick={() => onOpenGroup(group.id)}>
                  View group
                </button>
                {canJoin && (
                  <button
                    className={group.isMember ? 'ghost-btn' : 'primary-btn'}
                    type="button"
                    disabled={membership.isPending}
                    onClick={() => membership.mutate({ groupId: group.id, isMember: group.isMember })}
                  >
                    {group.isMember ? 'Leave group' : 'Join group'}
                  </button>
                )}

                {canModerate && (
                  <button
                    className="ghost-btn"
                    type="button"
                    aria-label={`Remove ${group.name}`}
                    disabled={removal.isPending}
                    onClick={() => removal.mutate(group.id)}
                  >
                    Remove group
                  </button>
                )}

                {/* Only the creator sees this, and the server enforces it too. */}
                {group.canEditVisibility && (
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={visibility.isPending}
                    onClick={() =>
                      visibility.mutate({
                        groupId: group.id,
                        next:
                          group.visibility === 'alumni-only' ? 'open-to-students' : 'alumni-only',
                      })
                    }
                  >
                    {group.visibility === 'alumni-only' ? 'Open to students' : 'Make alumni only'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </QueryState>
    </section>
  )
}

/**
 * Starting a community (DESIGN_BACKLOG #27). The API always allowed alumni to
 * create groups; nothing in the UI called it.
 *
 * New groups default to alumni-only (DESIGN_BACKLOG #1); the creator can open
 * one to students here or later from its card.
 */
function CreateCommunityForm({ onCreated }: { onCreated: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    topic: '',
    description: '',
    visibility: 'alumni-only' as GroupVisibility,
  })
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => groupsApi.create(form),
    onSuccess: (result) => {
      setForm({ name: '', topic: '', description: '', visibility: 'alumni-only' })
      setError(null)
      setOpen(false)
      onCreated(result.message)
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not create the community.'),
  })

  if (!open) {
    return (
      <div className="panel">
        <button className="primary-btn" type="button" onClick={() => setOpen(true)}>
          Start a community
        </button>
      </div>
    )
  }

  return (
    <form
      className="panel form-grid"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <h2>Start a community</h2>
      <div className="form-row">
        <label>
          <span>Name</span>
          <input
            className="input-field"
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            placeholder="Fintech circle"
            required
          />
        </label>
        <label>
          <span>Topic</span>
          <input
            className="input-field"
            value={form.topic}
            onChange={(event) => setForm((c) => ({ ...c, topic: event.target.value }))}
            placeholder="Finance"
            required
          />
        </label>
      </div>
      <label>
        <span>What is it for?</span>
        <textarea
          className="textarea-field"
          value={form.description}
          onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
          required
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.visibility === 'open-to-students'}
          onChange={(event) =>
            setForm((c) => ({ ...c, visibility: event.target.checked ? 'open-to-students' : 'alumni-only' }))
          }
        />
        <span>Open to students as well as alumni</span>
      </label>
      <div className="row-actions">
        <button className="primary-btn" type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create community'}
        </button>
        <button className="ghost-btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="error-msg">{error}</p>}
    </form>
  )
}
