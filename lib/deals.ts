import { supabase } from './supabase';
import type { MenyProduct } from './types';

const MAX_DEAL_AGE_HOURS = 48;

export async function fetchTopDeals(minDropPct = 10, limit = 100): Promise<MenyProduct[]> {
  const freshestAllowed = new Date(Date.now() - MAX_DEAL_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .not('drop_pct', 'is', null)
    .gte('drop_pct', minDropPct)
    .gte('computed_at', freshestAllowed)
    .order('drop_pct', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MenyProduct[];
}

export async function searchProducts(query: string, limit = 30): Promise<MenyProduct[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
  const { data, error } = await supabase
    .from('meny_products')
    .select('*')
    .ilike('name', `%${escaped}%`)
    .order('current_price', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MenyProduct[];
}
