/**
 * ASP.NET [FromForm] posts flat keys like "Entity.Name" or "BillableItems[0].id".
 * Nest multer leaves them flat on body. Normalizes PascalCase → camelCase.
 */
export function unflattenFormBody(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(flat)) {
    if (rawKey === 'files' || value === undefined) continue;
    const parts = rawKey
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean)
      .map((p) => (/^\d+$/.test(p) ? p : toCamel(p)));

    let cur: Record<string, unknown> | unknown[] = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const nextIsIndex = /^\d+$/.test(parts[i + 1]);
      cur = ensureChild(cur, p, nextIsIndex);
    }
    setLeaf(cur, parts[parts.length - 1], coerceValue(value));
  }
  return root;
}

function ensureChild(
  parent: Record<string, unknown> | unknown[],
  key: string,
  nextIsIndex: boolean,
): Record<string, unknown> | unknown[] {
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (parent[idx] == null) parent[idx] = nextIsIndex ? [] : {};
    return parent[idx] as Record<string, unknown> | unknown[];
  }
  if (parent[key] == null) parent[key] = nextIsIndex ? [] : {};
  if (nextIsIndex && !Array.isArray(parent[key])) parent[key] = [];
  if (!nextIsIndex && (typeof parent[key] !== 'object' || parent[key] === null)) parent[key] = {};
  return parent[key] as Record<string, unknown> | unknown[];
}

function setLeaf(parent: Record<string, unknown> | unknown[], key: string, value: unknown) {
  if (Array.isArray(parent)) parent[Number(key)] = value;
  else parent[key] = value;
}

function toCamel(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function coerceValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
