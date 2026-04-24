import { supabase } from './supabase';

export async function getMyHouseholds() {
  const { data, error } = await supabase
    .from('memberships')
    .select('household_id, role, households(id, name)')
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createHousehold(name: string) {
  const { data, error } = await supabase.rpc('create_household', { household_name: name });
  if (error) throw error;
  return data as string;
}

function randomCode(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ingen forvirrende tegn (0/O, 1/I/L)
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function createInvite(householdId: string) {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('Ikke innlogget');

  const code = randomCode(10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invites')
    .insert({
      code,
      household_id: householdId,
      created_by: user.user.id,
      expires_at: expiresAt,
      max_uses: 10,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function redeemInvite(code: string) {
  const { data, error } = await supabase.rpc('redeem_invite', { invite_code: code.trim().toUpperCase() });
  if (error) throw error;
  return data as string;
}
