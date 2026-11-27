import type { Hono } from 'hono';
import {
  createGroup,
  createUser,
  disableUser,
  enableUser,
  getUser,
  groupMembers,
  issuePasswordReset,
  listGroups,
  listUsers,
  reinvite,
  replaceMembers,
  updateGroup,
  updateUser,
} from '../directory-service';
import { jsonBody, requireUuid } from '../http';
import {
  createUserSchema,
  groupSchema,
  membersSchema,
  patchGroupSchema,
  patchUserSchema,
} from '../../shared/schemas';
import type { AppEnv } from '../types';

export function mountDirectory(app: Hono<AppEnv>): void {
  app.get('/api/users', async (c) => c.json(await listUsers(c)));
  app.post('/api/users', jsonBody(createUserSchema), async (c) =>
    c.json(await createUser(c, c.req.valid('json')), 201),
  );
  app.get('/api/users/:id', async (c) => c.json(await getUser(c, requireUuid(c.req.param('id')))));
  app.patch('/api/users/:id', jsonBody(patchUserSchema), async (c) =>
    c.json(await updateUser(c, requireUuid(c.req.param('id')), c.req.valid('json'))),
  );
  app.post('/api/users/:id/invite', async (c) =>
    c.json(await reinvite(c, requireUuid(c.req.param('id')))),
  );
  app.post('/api/users/:id/password-reset', async (c) =>
    c.json(await issuePasswordReset(c, requireUuid(c.req.param('id')))),
  );
  app.post('/api/users/:id/disable', async (c) =>
    c.json(await disableUser(c, requireUuid(c.req.param('id')))),
  );
  app.post('/api/users/:id/enable', async (c) =>
    c.json(await enableUser(c, requireUuid(c.req.param('id')))),
  );

  app.get('/api/groups', async (c) => c.json(await listGroups(c)));
  app.post('/api/groups', jsonBody(groupSchema), async (c) =>
    c.json(await createGroup(c, c.req.valid('json')), 201),
  );
  app.patch('/api/groups/:id', jsonBody(patchGroupSchema), async (c) =>
    c.json(await updateGroup(c, requireUuid(c.req.param('id')), c.req.valid('json'))),
  );
  app.get('/api/groups/:id/members', async (c) =>
    c.json(await groupMembers(c, requireUuid(c.req.param('id')))),
  );
  app.put('/api/groups/:id/members', jsonBody(membersSchema), async (c) =>
    c.json(await replaceMembers(c, requireUuid(c.req.param('id')), c.req.valid('json').userIds)),
  );
}
