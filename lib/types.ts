export type MenyProduct = {
  ean: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  vendor_url: string | null;
  current_price: number | null;
  median_30d: number | null;
  drop_pct: number | null;
  campaign_text: string | null;
  computed_at: string;
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
