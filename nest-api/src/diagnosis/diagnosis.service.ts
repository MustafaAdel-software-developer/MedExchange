import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Cap flat search results before tree-building. Moustafa: full Sieve parity / paging — G-CAT-01. */
const DIAGNOSIS_TAKE = 200;

type DiagnosisNode = {
  key: string;
  parentId: string | null;
  Code: string | null;
  label: string | null;
  children?: DiagnosisNode[];
  count?: number;
};

export type { DiagnosisNode };

/**
 * Thin Diagnosis search for OrderDetails tree picker.
 * Moustafa: full Sieve Description@=* multi-term + unlimited result set — G-CAT-01.
 */
@Injectable()
export class DiagnosisService {
  constructor(private readonly prisma: PrismaService) {}

  async getDiagnosis(filters: string) {
    const trimmed = filters.trim();
    if (!trimmed) return [];

    const where: Prisma.DiagnosisWhereInput = hasDigit(trimmed)
      ? { Name: { contains: trimmed.replace(/\./g, ''), mode: 'insensitive' } }
      : {
          AND: trimmed
            .split(/\s+/)
            .filter(Boolean)
            .map((term) => ({ Description: { contains: term, mode: 'insensitive' as const } })),
        };

    // Digit path in .NET strips dots from Name then Contains — approximate with contains on raw Name too.
    if (hasDigit(trimmed)) {
      where.OR = [
        { Name: { contains: trimmed.replace(/\./g, ''), mode: 'insensitive' } },
        { Name: { contains: trimmed, mode: 'insensitive' } },
      ];
      delete (where as { Name?: unknown }).Name;
    }

    const rows = await this.prisma.diagnosis.findMany({
      where,
      take: DIAGNOSIS_TAKE,
      select: { Key: true, ParentId: true, Name: true, Description: true },
    });

    const flat: DiagnosisNode[] = rows.map((r) => ({
      key: r.Key,
      parentId: r.ParentId,
      Code: r.Name,
      label: r.Description,
    }));

    const tree = buildTree(flat);
    if (tree.length > 0) tree[0].count = flat.length;
    return tree;
  }
}

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

function buildTree(flat: DiagnosisNode[]): DiagnosisNode[] {
  const byKey = new Map(flat.map((n) => [n.key, { ...n, children: [] as DiagnosisNode[] }]));
  const roots: DiagnosisNode[] = [];
  for (const node of byKey.values()) {
    if (node.parentId && byKey.has(node.parentId)) {
      byKey.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
