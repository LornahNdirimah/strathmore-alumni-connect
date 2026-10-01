import { useQuery } from '@tanstack/react-query'

import { QueryState } from '../../components/ui/QueryState'
import { groupsApi } from '../../lib/api'

type CommunityDetailPageProps = {
  groupId: string
  onBack: () => void
}

export function CommunityDetailPage({ groupId, onBack }: CommunityDetailPageProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.detail(groupId),
    enabled: Boolean(groupId),
  })

  return (
    <section className="content-panel">
      <button className="ghost-btn" type="button" onClick={onBack}>
        ← Back to communities
      </button>

      <QueryState isLoading={isLoading} error={error}>
        {data && (
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h2>{data.group.name}</h2>
            <p className="muted-line">{data.group.topic}</p>
            <p className="muted-line">{data.group.description}</p>

            <div className="chip-row" style={{ marginTop: '0.75rem' }}>
              <span>{data.group.memberCount} members</span>
              <span>
                {data.group.visibility === 'alumni-only' ? 'Alumni only' : 'Open to students'}
              </span>
              <span>Created by {data.group.creatorName}</span>
            </div>

            <h3 style={{ marginTop: '1.5rem' }}>Resources</h3>
            <div className="directory-list">
              {data.resources.map((resource) => (
                <div className="directory-item" key={resource.title}>
                  <div>
                    <strong>{resource.title}</strong>
                    {resource.url && <p className="muted-line">{resource.url}</p>}
                  </div>
                </div>
              ))}
              {data.resources.length === 0 && <p className="muted-line">No resources shared yet.</p>}
            </div>
          </div>
        )}
      </QueryState>
    </section>
  )
}
