import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { QueryState } from '../../components/ui/QueryState'
import { Avatar } from '../../components/ui/Avatar'
import { messagingApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import { BlockButton, ReportButton } from '../safety/SafetyControls'

export function MessagingPage() {
  const queryClient = useQueryClient()
  // `?c=` opens a specific thread, e.g. from a mentor's "Message" button.
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('c'))
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)

  // New messages arrive over the live-update stream (app/useLiveUpdates.ts).
  // Polling stays as a slower fallback for when the stream is unavailable; the
  // open thread polls faster because that is where a reply is being waited for.
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => messagingApi.conversations(),
    refetchInterval: 60_000,
  })

  const list = conversations.data?.conversations ?? []

  // Select the first thread once, after the list arrives.
  useEffect(() => {
    if (!selectedId && list.length > 0) setSelectedId(list[0]!.id)
  }, [list, selectedId])

  const messages = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => messagingApi.messages(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: 20_000,
  })

  const markRead = useMutation({
    mutationFn: (conversationId: string) => messagingApi.markRead(conversationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })

  // Opening a thread clears its unread badge — the mock had no way to do this,
  // so unreadCount could only ever grow.
  useEffect(() => {
    if (!selectedId) return
    const conversation = list.find((item) => item.id === selectedId)
    if (conversation && conversation.unreadCount > 0) markRead.mutate(selectedId)
    // markRead is a stable mutation object; including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, list])

  const send = useMutation({
    mutationFn: (text: string) => messagingApi.send(selectedId!, text),
    onSuccess: () => {
      setSendError(null)
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: ['messages', selectedId] })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (error) => setSendError(error instanceof ApiError ? error.message : 'Your message was not sent.'),
  })

  const selected = list.find((item) => item.id === selectedId)

  return (
    <section className="content-panel" aria-labelledby="messages-heading">
      <h1 id="messages-heading" className="sr-only">
        Messages
      </h1>
      <QueryState
        isLoading={conversations.isLoading}
        error={conversations.error}
        isEmpty={list.length === 0}
        emptyMessage="No conversations yet. Message a mentor from their profile to start one."
      >
        <div className="panel messaging-panel">
          <div className="conversation-list">
            {list.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  conversation.id === selectedId ? 'conversation-item active' : 'conversation-item'
                }
                onClick={() => setSelectedId(conversation.id)}
              >
                <Avatar
                  name={conversation.participantName}
                  url={conversation.participantAvatarUrl}
                  size="sm"
                />
                <div className="conversation-meta">
                  <strong>{conversation.participantName}</strong>
                  <p>{conversation.preview}</p>
                </div>
                <div className="conversation-side">
                  <span>{conversation.lastMessageTime}</span>
                  {conversation.unreadCount > 0 && (
                    <span className="score-pill">{conversation.unreadCount}</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="conversation-thread">
            {selected ? (
              <>
                <div className="thread-header">
                  <div>
                    <strong>{selected.participantName}</strong>
                    <span>{selected.participantRole}</span>
                  </div>
                  <div className="row-actions">
                    <ReportButton
                      userId={selected.participantId}
                      name={selected.participantName}
                      contextType="other"
                      contextId={selected.id}
                    />
                    <BlockButton userId={selected.participantId} name={selected.participantName} />
                  </div>
                </div>

                <div className="thread-body" role="log" aria-label={`Conversation with ${selected.participantName}`}>
                  {(messages.data?.messages ?? []).map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.from === 'me' ? 'message-bubble sent' : 'message-bubble received'
                      }
                    >
                      <p>{message.text}</p>
                      <span>{message.time}</span>
                      {message.from === 'them' && selected && (
                        <ReportButton
                          userId={selected.participantId}
                          name={selected.participantName}
                          contextType="message"
                          contextId={message.id}
                          label="Report message"
                        />
                      )}
                    </div>
                  ))}
                  {messages.isLoading && <p className="muted-line">Loading messages…</p>}
                </div>

                <form
                  className="thread-composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (draft.trim()) send.mutate(draft.trim())
                  }}
                >
                  <input
                    className="input-field"
                    placeholder="Type a message..."
                    aria-label={`Message to ${selected.participantName}`}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <button className="primary-btn" type="submit" disabled={send.isPending || !draft.trim()}>
                    {send.isPending ? 'Sending…' : 'Send'}
                  </button>
                </form>
                {/* E.g. a block: the message was refused and must not vanish silently. */}
                {sendError && <p className="error-msg">{sendError}</p>}
              </>
            ) : (
              <p className="muted-line">Select a conversation to start messaging.</p>
            )}
          </div>
        </div>
      </QueryState>
    </section>
  )
}
