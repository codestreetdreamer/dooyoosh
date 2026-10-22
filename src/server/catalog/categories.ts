/** GET /categories (owner: Backend & Database). Active categories as a tree; name falls back to 'en', then slug. */
import "server-only";
import type { CategoryNode } from "@/contracts/catalog";
import type { Locale } from "@/contracts/common";
import { asAnon } from "../db/client";

export async function listCategories(locale: Locale): Promise<CategoryNode[]> {
  const rows = await asAnon((tx) => tx<{ id: string; parent_id: string | null; slug: string; kind: CategoryNode["kind"]; name: string; description: string | null; sort_order: number }[]>`
    select c.id, c.parent_id, c.slug, c.kind, coalesce(t.name, te.name, c.slug) as name,
           coalesce(t.description, te.description) as description, c.sort_order
      from public.categories c
      left join public.category_translations t on t.category_id = c.id and t.locale = ${locale}
      left join public.category_translations te on te.category_id = c.id and te.locale = 'en'
     where c.is_active
     order by c.sort_order, c.slug`);
  const nodes = new Map<string, CategoryNode & { parentId: string | null }>();
  for (const r of rows) nodes.set(r.id, { id: r.id, slug: r.slug, kind: r.kind, name: r.name, description: r.description, sortOrder: r.sort_order, children: [], parentId: r.parent_id });
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (n.parentId && !parent) continue; // parent inactive => hide subtree
    (parent ? parent.children : roots).push(n);
  }
  const strip = (n: CategoryNode & { parentId?: string | null }): CategoryNode => ({
    id: n.id, slug: n.slug, kind: n.kind, name: n.name, description: n.description, sortOrder: n.sortOrder, children: n.children.map(strip),
  });
  return roots.map(strip);
}
