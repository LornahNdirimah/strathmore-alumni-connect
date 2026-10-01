/**
 * A small RFC 4180 CSV reader for the alumni import (DESIGN_BACKLOG #46).
 *
 * Handles what spreadsheets actually export: quoted fields, commas and line
 * breaks inside quotes, doubled quotes as a literal quote, CRLF or LF line
 * endings, a UTF-8 byte-order mark, and blank lines. Enough for a registry
 * export without adding a dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const input = text.replace(/^﻿/, '')

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Blank lines carry no data.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}
