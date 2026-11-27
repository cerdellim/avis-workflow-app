import type {
  GroupStatus,
  MemberRecord,
  Profile,
  ProfileGroup,
  Role,
  UserStatus,
} from '../shared/account';

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  role: Role;
  status: UserStatus;
};

type GroupLink = {
  user_id: string;
  id: string;
  name: string;
  status: GroupStatus;
};

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, email, full_name, password_hash, role, status
       FROM users
       WHERE email = ?`,
    )
    .bind(email)
    .first<UserRow>();
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, email, full_name, password_hash, role, status
       FROM users
       WHERE id = ?`,
    )
    .bind(id)
    .first<UserRow>();
}

export async function loadProfile(db: D1Database, userId: string): Promise<Profile | null> {
  const user = await findUserById(db, userId);
  if (!user) {
    return null;
  }
  const groups = await groupsForUsers(db, [userId]);
  return toProfile(user, groups.get(userId) ?? []);
}

export async function listProfiles(db: D1Database): Promise<Profile[]> {
  const users = await db
    .prepare(
      'SELECT id, email, full_name, password_hash, role, status FROM users ORDER BY full_name COLLATE NOCASE',
    )
    .all<UserRow>();
  const groups = await groupsForUsers(
    db,
    users.results.map((user) => user.id),
  );
  return users.results.map((user) => toProfile(user, groups.get(user.id) ?? []));
}

export async function listMembers(db: D1Database, groupId: string): Promise<MemberRecord[]> {
  const rows = await db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.role, u.status
       FROM group_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY u.full_name COLLATE NOCASE`,
    )
    .bind(groupId)
    .all<{ id: string; full_name: string; email: string; role: Role; status: UserStatus }>();
  return rows.results.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
  }));
}

export function toProfile(user: UserRow, groups: ProfileGroup[]): Profile {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
    groups,
  };
}

async function groupsForUsers(
  db: D1Database,
  userIds: string[],
): Promise<Map<string, ProfileGroup[]>> {
  const grouped = new Map<string, ProfileGroup[]>();
  if (userIds.length === 0) {
    return grouped;
  }
  const rows = await db
    .prepare(
      `SELECT m.user_id, g.id, g.name, g.status
       FROM group_members m
       JOIN groups g ON g.id = m.group_id
       WHERE m.user_id IN (${placeholders(userIds.length)})
       ORDER BY g.name COLLATE NOCASE`,
    )
    .bind(...userIds)
    .all<GroupLink>();
  for (const row of rows.results) {
    const current = grouped.get(row.user_id) ?? [];
    current.push({ id: row.id, name: row.name, status: row.status });
    grouped.set(row.user_id, current);
  }
  return grouped;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export function changed(result: D1Result | undefined): number {
  return Number(result?.meta.changes ?? 0);
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function countActiveAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
