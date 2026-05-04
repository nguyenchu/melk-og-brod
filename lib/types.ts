export type PricePoint = { date: string; price: number };

export type MenyProduct = {
  ean: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  vendor_url: string | null;
  current_price: number | null;
  median_30d: number | null;
  original_price: number | null;
  price_source: 'meny' | 'median' | null;
  drop_pct: number | null;
  campaign_text: string | null;
  computed_at: string;
  price_history: PricePoint[] | null;
};

export type CartItem = {
  id: string;
  name: string;
  ean: string | null;
  image_url: string | null;
  price: number | null;
  drop_pct: number | null;
  campaign_text: string | null;
  quantity: number;
  checked: boolean;
  added_at: string;
};
