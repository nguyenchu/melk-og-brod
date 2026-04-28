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

export function getCampaignKind(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) return 'generic' as const;
  if (/\b\d+\s*for\s*\d+\b/.test(normalized) || /\bkj[øo]p\s*\d+.*betal/.test(normalized)) {
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
