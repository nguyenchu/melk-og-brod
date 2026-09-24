export type PricePoint = { date: string; price: number };

// Ett tilbud i én kjede – grunnlaget for prissammenligning på tvers av butikker.
export type StoreOffer = {
  chain: string | null;
  code: string | null;
  price: number;
  drop_pct: number | null;
};

// Denormalisert produkt fra Supabase (matet av Kassal-syncen, alle kjeder).
// Beholder navnet MenyProduct midlertidig så skjermene ikke må endres på én gang.
export type MenyProduct = {
  ean: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  vendor_url: string | null;
  chain: string | null; // kjede med tilbudsprisen (overskriften)
  current_price: number | null; // tilbudsprisen (eller billigste hvis ingen tilbud)
  median_30d: number | null; // normalpris (median) for tilbudsbutikken
  original_price: number | null;
  price_source: 'meny' | 'median' | 'tjek' | null;
  drop_pct: number | null;
  campaign_text: string | null;
  cheapest_price: number | null; // billigste nåpris på tvers av kjeder
  cheapest_chain: string | null;
  stores: StoreOffer[] | null; // alle kjeder for prissammenligning
  computed_at: string;
  price_history: PricePoint[] | null;
  valid_from?: string | null; // kun tjek: når tilbudet starter (f.eks. «kun fredag»)
  valid_until?: string | null; // kun tjek: ukestilbudet utløper (ISO-dato)
  // Fastpris-multibuy, f.eks. «3 for 100»: kjøp `quantity` for `price` totalt,
  // resten til `single` (vanlig enkeltpris). null = ikke multibuy.
  multibuy?: { quantity: number; price: number; single: number } | null;
};

export type CartItem = {
  id: string;
  name: string;
  ean: string | null;
  chain: string | null; // hvilken kjede tilbudet kom fra – gruppering per butikk
  image_url: string | null;
  price: number | null;
  drop_pct: number | null;
  campaign_text: string | null;
  quantity: number;
  checked: boolean;
  added_at: string;
  deal_expired: boolean;
  multibuy?: { quantity: number; price: number; single: number } | null;
};
