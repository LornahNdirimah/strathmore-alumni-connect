/**
 * Why a mentor was suggested (DESIGN_BACKLOG #37), as short chips beside the
 * match score. Only present on recommendations.
 */
export function MatchReasons({ reasons }: { reasons?: string[] }) {
  if (!reasons || reasons.length === 0) return null
  return (
    <ul className="reason-chips" aria-label="Why this mentor was suggested">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}
