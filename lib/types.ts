export type Household = {
  id: string;
  name: string;
  created_at: string;
};

export type Membership = {
  household_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
};

export type List = {
  id: string;
  household_id: string;
  name: string;
  created_at: string;
};

export type Item = {
  id: string;
  list_id: string;
  name: string;
  checked: boolean;
  added_by: string;
  created_at: string;
};

export type Invite = {
  code: string;
  household_id: string;
  created_by: string;
  expires_at: string;
  used_count: number;
  max_uses: number;
};
