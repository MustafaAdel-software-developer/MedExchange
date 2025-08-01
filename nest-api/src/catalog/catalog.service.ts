import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CategoryNode = {
  key: string;
  parentId: string | null;
  label: string | null;
  description: string | null;
  isSelectable: boolean;
  children?: CategoryNode[];
};

export type TaxonomyNode = {
  key: string;
  parentId: string | null;
  code: string | null;
  label: string | null;
  description: string | null;
  weight: number;
  children?: TaxonomyNode[];
};

/**
 * Thin catalog reads (States, Categories, Taxonomies).
 * Moustafa: category/taxonomy admin CRUD + Diagnosis unlimited Sieve — G-CAT-01.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getStates(): Promise<string[]> {
    const rows = await this.prisma.states.findMany({
      where: { IsDeleted: false },
      orderBy: { Name: 'asc' },
      select: { Name: true },
    });
    return rows.map((r) => r.Name).filter((n): n is string => !!n);
  }

  async getCategories(): Promise<CategoryNode[]> {
    const rows = await this.prisma.categories.findMany({
      where: { IsDeleted: false },
      orderBy: { Name: 'asc' },
      select: { Key: true, ParentId: true, Name: true, Description: true, IsSelectable: true },
    });
    const flat: CategoryNode[] = rows
      .filter((r) => !!r.Key)
      .map((r) => ({
        key: r.Key!,
        parentId: r.ParentId,
        label: r.Name,
        description: r.Description,
        isSelectable: r.IsSelectable,
      }));
    return buildTree(flat);
  }

  /** Matches .NET Taxonomies/GetTaxonomies (tree; .NET skips soft-delete filter on this table). */
  async getTaxonomies(): Promise<TaxonomyNode[]> {
    const rows = await this.prisma.taxonomies.findMany({
      orderBy: [{ Weight: 'asc' }, { Label: 'asc' }],
      select: {
        Key: true,
        ParentId: true,
        Code: true,
        Label: true,
        Description: true,
        Weight: true,
      },
    });
    const flat: TaxonomyNode[] = rows.map((r) => ({
      key: String(r.Key),
      parentId: r.ParentId != null ? String(r.ParentId) : null,
      code: r.Code,
      label: r.Label,
      description: r.Description,
      weight: r.Weight,
    }));
    return buildTree(flat);
  }
}

function buildTree<T extends { key: string; parentId: string | null; children?: T[] }>(flat: T[]): T[] {
  const byKey = new Map(flat.map((n) => [n.key, { ...n, children: [] as T[] }]));
  const roots: T[] = [];
  for (const node of byKey.values()) {
    if (node.parentId && byKey.has(node.parentId)) {
      byKey.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
