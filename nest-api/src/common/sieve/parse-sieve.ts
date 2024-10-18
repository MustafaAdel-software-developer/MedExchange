/**
 * Minimal Sieve-style query parser for Orders list endpoints.
 * Supports: status==8|9, archievedAt==null, archievedAt!=null, patientName@=x, Page, PageSize, Sorts=-Field
 */

export type SieveQuery = {
  filters?: string;
  page?: number | string;
  pageSize?: number | string;
  sorts?: string;
};

export type ParsedSieve = {
  statusIn?: number[];
  archievedAtNull?: boolean | null;
  patientNameContains?: string;
  skip: number;
  take: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
};

export function parseSieveQuery(q: SieveQuery): ParsedSieve {
  const page = Math.max(1, Number(q.page) || 1);
  const take = Math.max(1, Math.min(100, Number(q.pageSize) || 10));
  const skip = (page - 1) * take;

  const result: ParsedSieve = {
    skip,
    take,
    orderBy: [{ OrderTrackingNumber: 'desc' }],
  };

  if (q.sorts) {
    const sorts = q.sorts.split(',').filter(Boolean);
    const orderBy: Array<Record<string, 'asc' | 'desc'>> = [];
    for (const s of sorts) {
      const desc = s.startsWith('-');
      const raw = desc ? s.slice(1) : s;
      const field = mapSortField(raw);
      if (field) orderBy.push({ [field]: desc ? 'desc' : 'asc' });
    }
    if (orderBy.length) result.orderBy = orderBy;
  }

  if (!q.filters) return result;

  const parts = decodeURIComponent(q.filters)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (part.startsWith('status==')) {
      const vals = part
        .slice('status=='.length)
        .split('|')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n));
      if (vals.length) result.statusIn = vals;
      continue;
    }
    if (part === 'archievedAt==null' || part === 'ArchievedAt==null') {
      result.archievedAtNull = true;
      continue;
    }
    if (part === 'archievedAt!=null' || part === 'ArchievedAt!=null') {
      result.archievedAtNull = false;
      continue;
    }
    const contains = part.match(/^patientName@=(.+)$/i);
    if (contains) {
      result.patientNameContains = contains[1];
    }
  }

  return result;
}

function mapSortField(raw: string): string | null {
  const map: Record<string, string> = {
    OrderTrackingNumber: 'OrderTrackingNumber',
    orderTrackingNumber: 'OrderTrackingNumber',
    OrderedDate: 'OrderedDate',
    orderedDate: 'OrderedDate',
    ScheduledDate: 'ScheduledDate',
    scheduledDate: 'ScheduledDate',
    Status: 'Status',
    status: 'Status',
    // ServiceName sorts against Services.Name — handled separately if needed
    ServiceName: 'OrderedDate',
    serviceName: 'OrderedDate',
  };
  return map[raw] ?? null;
}
