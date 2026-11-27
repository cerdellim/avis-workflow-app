export const MAX_PEOPLE = 15;

export type Role = 'admin' | 'coordinator' | 'volunteer';
export type UserStatus = 'invited' | 'active' | 'disabled';
export type GroupStatus = 'active' | 'archived';

export type ProfileGroup = {
  id: string;
  name: string;
  status: GroupStatus;
};

export type Profile = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  groups: ProfileGroup[];
};

export type SessionProfile = Profile & {
  associationName?: string;
};

export type GroupRecord = {
  id: string;
  name: string;
  description: string | null;
  status: GroupStatus;
};

export type MemberRecord = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
};
