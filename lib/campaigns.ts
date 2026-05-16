export function isLikelyCampaignText(value: string | null | undefined) {
  if (!value) return false;
  const text = value.trim();
  const normalized = text.toLowerCase();

  if (
    text.length > 60 ||
    /[{}[\]":]/.test(text) ||
    /next_public_|window\.env|trumfid|chainid|token|provider|login|rainforest_alliance|fairtrade|utz|oekologisk|okologisk/.test(normalized)
  ) {
    return false;
  }

  return (
    /\b\d+\s*for\s*\d+\b/.test(normalized) ||
    /\b\d+\s*-\s*for\s*-\s*\d+\b/.test(normalized) ||
    /\bkj[øo]p\s*\d+.*betal/.test(normalized) ||
    /\bplukk\s*(?:&|og)\s*miks\b/.test(normalized) ||
    /\bmedlemspris\b/.test(normalized) ||
    /\btrumf(?:-bonus)?\b/.test(normalized) ||
    /\bryddesalg\b/.test(normalized) ||
    /\btilbud\b/.test(normalized) ||
    /\brabatt\b/.test(normalized) ||
    /\bsommerpris\b/.test(normalized)
  );
}

export function getBundlePayForOffer(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return null;

  const directMatch =
    normalized.match(/\b(\d+)\s*for\s*(\d+)\b/) ??
    normalized.match(/\b(\d+)\s*-\s*for\s*-\s*(\d+)\b/);
  if (directMatch) {
    const buy = Number(directMatch[1]);
    const payFor = Number(directMatch[2]);
    if (Number.isFinite(buy) && Number.isFinite(payFor) && buy > 1 && payFor >= 0 && payFor < buy) {
      return { buy, payFor };
    }
  }

  const buyPayMatch = normalized.match(
    /\bkj[øo]p\s*(\d+)[,\s]+betal\s*(?:for\s*)?(\d+)\b/,
  );
  if (buyPayMatch) {
    const buy = Number(buyPayMatch[1]);
    const payFor = Number(buyPayMatch[2]);
    if (Number.isFinite(buy) && Number.isFinite(payFor) && buy > 1 && payFor >= 0 && payFor < buy) {
      return { buy, payFor };
    }
  }

  return null;
}

type BundleItem = {
  price: number | null;
  quantity: number;
  campaign_text?: string | null;
  checked?: boolean;
};

export function computeCartTotals<T extends BundleItem>(items: readonly T[]): {
  total: number;
  naiveSubtotal: number;
  savings: number;
  bundleSavings: { campaign: string; saved: number }[];
} {
  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const item of items) {
    if (item.checked) continue;
    if (item.price == null || item.price <= 0 || item.quantity <= 0) continue;
    const offer = getBundlePayForOffer(item.campaign_text);
    if (offer && item.campaign_text) {
      const key = item.campaign_text.trim();
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    } else {
      ungrouped.push(item);
    }
  }

  let naiveSubtotal = 0;
  let total = 0;
  const bundleSavings: { campaign: string; saved: number }[] = [];

  for (const item of ungrouped) {
    const line = item.price! * item.quantity;
    naiveSubtotal += line;
    total += line;
  }

  for (const [campaign, group] of groups) {
    const offer = getBundlePayForOffer(campaign)!;
    const unitPrices: number[] = [];
    for (const item of group) {
      for (let i = 0; i < item.quantity; i++) unitPrices.push(item.price!);
    }
    unitPrices.sort((a, b) => a - b);
    const totalUnits = unitPrices.length;
    const bundles = Math.floor(totalUnits / offer.buy);
    const freeUnits = bundles * (offer.buy - offer.payFor);
    const groupNaive = unitPrices.reduce((s, p) => s + p, 0);
    const groupPaid = unitPrices.slice(freeUnits).reduce((s, p) => s + p, 0);
    naiveSubtotal += groupNaive;
    total += groupPaid;
    const saved = groupNaive - groupPaid;
    if (saved > 0.001) {
      bundleSavings.push({ campaign, saved });
    }
  }

  return {
    total,
    naiveSubtotal,
    savings: naiveSubtotal - total,
    bundleSavings,
  };
}

export function getCampaignKind(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return 'generic' as const;
  if (getBundlePayForOffer(normalized) || /\bkj[øo]p\s*\d+.*betal/.test(normalized)) {
    return 'bundle' as const;
  }
  if (/\bmedlemspris\b/.test(normalized)) {
    return 'member' as const;
  }
  if (/\btrumf(?:-bonus)?\b/.test(normalized) || /\+\s*\d+\s*%\s*trumf/.test(normalized)) {
    return 'bonus' as const;
  }
  if (/\bryddesalg\b/.test(normalized)) {
    return 'clearance' as const;
  }
  if (/\btilbud\b/.test(normalized) || /\brabatt\b/.test(normalized) || /\bsommerpris\b/.test(normalized)) {
    return 'generic' as const;
  }
  return 'generic' as const;
}
