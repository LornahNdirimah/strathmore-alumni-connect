import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { adminApi } from '../../lib/api'
import { ApiError } from '../../lib/http'
import type { ImportResult } from '../../types'

const STATUS_LABELS = { ready: 'Ready', created: 'Created', duplicate: 'Skipped — already exists', invalid: 'Needs fixing' }

/**
 * Bulk alumni import (DESIGN_BACKLOG #46): the alumni office's register as a
 * CSV. Preview first — nothing is created until "Import" — then each imported
 * alumnus is emailed a link to set their password.
 */
export function AlumniImport() {
  const queryClient = useQueryClient()
  const [csv, setCsv] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: (dryRun: boolean) => adminApi.importAlumni(csv, dryRun),
    onSuccess: (data) => {
      setResult(data)
      setError(null)
      if (!data.dryRun) {
        void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
        void queryClient.invalidateQueries({ queryKey: ['admin-audit'] })
      }
    },
    onError: (caught) => {
      setResult(null)
      setError(caught instanceof ApiError ? caught.message : 'Could not read that file.')
    },
  })

  const ready = result?.dryRun ? result.summary.ready : 0

  return (
    <div className="panel form-grid">
      <h2>Import alumni</h2>
      <p className="muted-line">
        A CSV with a header row and columns for <strong>name</strong>, <strong>email</strong>,{' '}
        <strong>class year</strong> and <strong>programme</strong>, up to 500 rows. Imported alumni are verified
        straight away and emailed a link, valid for a week, to set their own password.
      </p>

      <label>
        <span>Upload a file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            setCsv(await file.text())
            setResult(null)
          }}
        />
      </label>
      <label>
        <span>…or paste it</span>
        <textarea
          className="textarea-field csv-input"
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value)
            setResult(null)
          }}
          placeholder={'name,email,class year,programme\nGrace Wanjiru,grace@example.com,2015,BCom'}
        />
      </label>

      <div className="row-actions">
        <button className="secondary-btn" type="button" disabled={!csv.trim() || run.isPending} onClick={() => run.mutate(true)}>
          Preview
        </button>
        <button
          className="primary-btn"
          type="button"
          disabled={ready === 0 || run.isPending}
          onClick={() => run.mutate(false)}
        >
          {ready > 0 ? `Import ${ready} alumni` : 'Import'}
        </button>
      </div>
      {error && <p className="error-msg">{error}</p>}

      {result && (
        <>
          <p className={result.dryRun ? 'muted-line' : 'success-msg'}>
            {result.dryRun
              ? `Preview: ${result.summary.ready} ready, ${result.summary.duplicate} already exist, ${result.summary.invalid} need fixing. Nothing has been created yet.`
              : `Created ${result.summary.created} accounts and sent their invitations. ${result.summary.duplicate} skipped, ${result.summary.invalid} need fixing.`}
          </p>
          <table className="import-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Name</th>
                <th>Email</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.line} className={`import-${row.status}`}>
                  <td>{row.line}</td>
                  <td>{row.name}</td>
                  <td>{row.email}</td>
                  <td>
                    {STATUS_LABELS[row.status]}
                    {row.problems.length > 0 && <span className="muted-line"> — {row.problems.join(' ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
