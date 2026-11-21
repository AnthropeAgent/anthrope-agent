/** ClickHouse tidak mendukung multi-statement per request: buang komentar, pecah per ';' di akhir baris. */
export function splitClickhouse(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}
