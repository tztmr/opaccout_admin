# Single Admin Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace environment-variable administrator credentials with a MongoDB-persisted single administrator and expose a registration page only while no administrator exists.

**Architecture:** A fixed MongoDB document ID (`primary`) is the database-level single-administrator lock. A focused credential module owns `scrypt` hashing and verification, an admin-auth service owns setup/authentication policy, and the Express router maps that service to public setup/login endpoints and the existing session. React adds an initialization gate that chooses `/setup` or `/login` from the server-reported state; Docker keeps using the existing MongoDB volume so setup remains closed after registration.

**Tech Stack:** TypeScript, Node.js `crypto.scrypt`, Express 5, Mongoose 8, express-session, React 19, React Router 7, TanStack Query 5, Vitest 3, Testing Library, MongoDB 8, Docker Compose

## Global Constraints

- The system has exactly one administrator and does not add invitations, roles, password reset, administrator deletion, or credential-editing UI.
- Existing `ADMIN_USERNAME` and `ADMIN_PASSWORD` values are ignored and are not migrated.
- Username is trimmed and must contain 1 to 100 characters.
- Password must contain 12 to 4096 characters.
- Password plaintext, salt, and hash must never appear in API responses, logs, or audit records.
- `GET /api/auth/setup` exposes only `{ "needsSetup": boolean }`.
- `POST /api/auth/setup` creates only the fixed `primary` record and never updates an existing administrator.
- A successful setup automatically creates the same secure administrator session used by login.
- Once an administrator exists, `/setup` redirects to `/login` and no registration link remains.
- MongoDB `mongo_data` is the persistence source of truth across image rebuilds and container restarts.
- Preserve the user-owned untracked `QQ昵称识别API说明.md`; never stage or modify it.

---

## File Structure

### New files

- `apps/api/src/models/admin.ts` — fixed-ID administrator persistence schema; no password behavior.
- `apps/api/src/services/admin-credentials.ts` — `scrypt` hashing and constant-time verification only.
- `apps/api/src/services/admin-auth.ts` — setup/authentication policy and repository interface.
- `apps/api/src/services/admin-repository.ts` — Mongoose implementation of the repository and duplicate-key normalization.
- `apps/api/src/tests/admin-credentials.test.ts` — real hashing and verification behavior.
- `apps/api/src/tests/admin-auth.test.ts` — setup, authentication, duplicate, and concurrency policy.
- `apps/api/src/tests/admin-test-helper.ts` — isolated in-memory repository and preconfigured auth service for route tests.
- `apps/web/src/features/AuthEntry.tsx` — setup-state query, route selection, load error, and retry behavior.
- `apps/web/src/features/SetupPage.tsx` — first-administrator form and setup submission.
- `apps/web/src/tests/auth-bootstrap.test.tsx` — browser-DOM registration/login routing behavior.
- `apps/web/src/tests/setup.ts` — load DOM matchers for frontend tests.

### Modified files

- `apps/api/src/routes/auth.ts` — setup endpoints and database-backed login.
- `apps/api/src/app.ts` — inject the admin-auth service into the auth router.
- `apps/api/src/server.ts` — construct the production Mongoose admin repository/service.
- `apps/api/src/config.ts` — remove required environment administrator credentials.
- `apps/api/src/tests/auth.routes.test.ts` — cover setup, login, session, and duplicate handling.
- `apps/api/src/tests/accounts.routes.test.ts` — log in through a preconfigured test admin service.
- `apps/api/src/tests/app-security.test.ts` — provide the required auth-service dependency to security tests.
- `apps/api/src/tests/test-config.ts` — remove obsolete credential fields.
- `apps/api/src/tests/config.test.ts` — prove config loads without credential environment variables.
- `apps/web/src/app/App.tsx` — mount `/setup` and gate `/login`.
- `apps/web/src/features/SimplePage.tsx` — replace obsolete environment-credential settings copy.
- `apps/web/src/styles.css` — setup confirmation and load-error presentation using the existing login card.
- `apps/web/vite.config.ts` — configure jsdom for frontend component tests.
- `apps/web/package.json` and `pnpm-lock.yaml` — add Testing Library/jsdom development dependencies.
- `.env.example` — remove `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- `docker-compose.yml` — stop forwarding obsolete credentials to the API container.
- `README.md` — document first-run registration, persistence, and no environment fallback.

---

### Task 1: Password Credentials and Single-Administrator Domain Service

**Files:**

- Create: `apps/api/src/models/admin.ts`
- Create: `apps/api/src/services/admin-credentials.ts`
- Create: `apps/api/src/services/admin-auth.ts`
- Create: `apps/api/src/services/admin-repository.ts`
- Create: `apps/api/src/tests/admin-credentials.test.ts`
- Create: `apps/api/src/tests/admin-auth.test.ts`
- Create: `apps/api/src/tests/admin-test-helper.ts`

**Interfaces:**

- Produces: `PasswordDigest = { passwordSalt: string; passwordHash: string }`
- Produces: `hashAdminPassword(password: string): Promise<PasswordDigest>`
- Produces: `verifyAdminPassword(password: string, digest: PasswordDigest): Promise<boolean>`
- Produces: `StoredAdmin = { username: string; passwordSalt: string; passwordHash: string }`
- Produces: `AdminRepository = { exists(): Promise<boolean>; find(): Promise<StoredAdmin | null>; create(admin: StoredAdmin): Promise<void> }`
- Produces: `AdminAlreadyExistsError`
- Produces: `AdminAuthService = { needsSetup(): Promise<boolean>; setup(input: AdminCredentials): Promise<{ username: string }>; authenticate(input: AdminCredentials): Promise<{ username: string } | null> }`
- Produces: `createAdminAuthService(repository: AdminRepository, passwordCodec?: PasswordCodec): AdminAuthService`
- Produces: `createMongooseAdminRepository(): AdminRepository`
- Produces for tests: `createTestAdminAuth(initial?: AdminCredentials): Promise<AdminAuthService>`

- [ ] **Step 1: Read the test quality rules before writing tests**

Read completely:

```bash
sed -n '1,320p' /Users/edking/.codex/plugins/cache/openai-curated-remote/superpowers/6.2.0/skills/test-driven-development/writing-good-tests.md
```

Before each test, name the production behavior that would make it fail. Use real `scrypt` in credential tests and a stateful repository in service tests; do not assert only that mocks were called.

- [ ] **Step 2: Write failing credential tests**

Create `apps/api/src/tests/admin-credentials.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  hashAdminPassword,
  verifyAdminPassword
} from "../services/admin-credentials";

describe("administrator credentials", () => {
  it("stores a salted digest instead of the plaintext password", async () => {
    const password = "a-strong-admin-password";
    const first = await hashAdminPassword(password);
    const second = await hashAdminPassword(password);

    expect(first.passwordSalt).not.toContain(password);
    expect(first.passwordHash).not.toContain(password);
    expect(first.passwordSalt).not.toBe(second.passwordSalt);
    expect(first.passwordHash).not.toBe(second.passwordHash);
  });

  it("accepts only the password used to create the digest", async () => {
    const digest = await hashAdminPassword("a-strong-admin-password");

    await expect(
      verifyAdminPassword("a-strong-admin-password", digest)
    ).resolves.toBe(true);
    await expect(
      verifyAdminPassword("a-different-admin-password", digest)
    ).resolves.toBe(false);
  });

  it("rejects a malformed stored digest without throwing", async () => {
    await expect(
      verifyAdminPassword("a-strong-admin-password", {
        passwordSalt: "not-base64!",
        passwordHash: "not-base64!"
      })
    ).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run the credential tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/admin-credentials.test.ts
```

Expected: FAIL because `../services/admin-credentials` does not exist.

- [ ] **Step 4: Implement the minimal credential module**

Create `apps/api/src/services/admin-credentials.ts` with:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt);
const SALT_BYTES = 16;
const HASH_BYTES = 64;

export type PasswordDigest = {
  passwordSalt: string;
  passwordHash: string;
};

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length > 0 ? decoded : null;
}

export async function hashAdminPassword(
  password: string
): Promise<PasswordDigest> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, HASH_BYTES) as Buffer;
  return {
    passwordSalt: salt.toString("base64"),
    passwordHash: hash.toString("base64")
  };
}

export async function verifyAdminPassword(
  password: string,
  digest: PasswordDigest
): Promise<boolean> {
  const salt = decodeBase64(digest.passwordSalt);
  const expected = decodeBase64(digest.passwordHash);
  if (!salt || !expected || expected.length !== HASH_BYTES) return false;
  const actual = await derive(password, salt, HASH_BYTES) as Buffer;
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 5: Run credential tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/admin-credentials.test.ts
```

Expected: 3 tests PASS with no plaintext or digest output.

- [ ] **Step 6: Write failing admin-auth service tests and its stateful test helper**

Create `apps/api/src/tests/admin-test-helper.ts`:

```ts
import {
  AdminAlreadyExistsError,
  createAdminAuthService,
  type AdminCredentials,
  type AdminRepository,
  type StoredAdmin
} from "../services/admin-auth";

export function createMemoryAdminRepository(): AdminRepository {
  let value: StoredAdmin | null = null;
  return {
    async exists() {
      return value !== null;
    },
    async find() {
      return value ? { ...value } : null;
    },
    async create(admin) {
      if (value) throw new AdminAlreadyExistsError();
      value = { ...admin };
    }
  };
}

export async function createTestAdminAuth(
  initial?: AdminCredentials
) {
  const service = createAdminAuthService(createMemoryAdminRepository());
  if (initial) await service.setup(initial);
  return service;
}
```

Create `apps/api/src/tests/admin-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AdminAlreadyExistsError,
  createAdminAuthService
} from "../services/admin-auth";
import { createMemoryAdminRepository } from "./admin-test-helper";

const credentials = {
  username: "admin",
  password: "a-long-admin-password"
};

describe("administrator authentication service", () => {
  it("requires setup only until the first administrator is created", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());

    await expect(service.needsSetup()).resolves.toBe(true);
    await expect(service.setup(credentials)).resolves.toEqual({
      username: "admin"
    });
    await expect(service.needsSetup()).resolves.toBe(false);
  });

  it("never replaces the first administrator", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    await service.setup(credentials);

    await expect(service.setup({
      username: "replacement",
      password: "another-long-password"
    })).rejects.toBeInstanceOf(AdminAlreadyExistsError);
    await expect(service.authenticate(credentials)).resolves.toEqual({
      username: "admin"
    });
  });

  it("allows only one of two concurrent setup attempts", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    const results = await Promise.allSettled([
      service.setup(credentials),
      service.setup({
        username: "other",
        password: "another-long-password"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("authenticates exact trimmed usernames and the correct password", async () => {
    const service = createAdminAuthService(createMemoryAdminRepository());
    await service.setup({ ...credentials, username: "  admin  " });

    await expect(service.authenticate(credentials)).resolves.toEqual({
      username: "admin"
    });
    await expect(service.authenticate({
      username: "Admin",
      password: credentials.password
    })).resolves.toBeNull();
    await expect(service.authenticate({
      username: "admin",
      password: "incorrect-long-password"
    })).resolves.toBeNull();
  });
});
```

- [ ] **Step 7: Run admin-auth tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/admin-auth.test.ts
```

Expected: FAIL because `../services/admin-auth` does not exist.

- [ ] **Step 8: Implement the admin model, service, and Mongoose repository**

Create `apps/api/src/models/admin.ts`:

```ts
import { model, models, Schema, type Model } from "mongoose";

export type AdminRecord = {
  _id: "primary";
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

const AdminSchema = new Schema<AdminRecord>(
  {
    _id: { type: String, required: true },
    username: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    passwordSalt: { type: String, required: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true, versionKey: false }
);

export const AdminModel: Model<AdminRecord> =
  (models.Admin as Model<AdminRecord> | undefined) ??
  model<AdminRecord>("Admin", AdminSchema);
```

Create `apps/api/src/services/admin-auth.ts`:

```ts
import {
  hashAdminPassword,
  verifyAdminPassword,
  type PasswordDigest
} from "./admin-credentials";

export type AdminCredentials = { username: string; password: string };
export type StoredAdmin = PasswordDigest & { username: string };
export type PasswordCodec = {
  hash(password: string): Promise<PasswordDigest>;
  verify(password: string, digest: PasswordDigest): Promise<boolean>;
};
export type AdminRepository = {
  exists(): Promise<boolean>;
  find(): Promise<StoredAdmin | null>;
  create(admin: StoredAdmin): Promise<void>;
};
export class AdminAlreadyExistsError extends Error {
  constructor() {
    super("administrator already exists");
    this.name = "AdminAlreadyExistsError";
  }
}
export type AdminAuthService = {
  needsSetup(): Promise<boolean>;
  setup(input: AdminCredentials): Promise<{ username: string }>;
  authenticate(input: AdminCredentials): Promise<{ username: string } | null>;
};

const defaultCodec: PasswordCodec = {
  hash: hashAdminPassword,
  verify: verifyAdminPassword
};

export function createAdminAuthService(
  repository: AdminRepository,
  passwordCodec: PasswordCodec = defaultCodec
): AdminAuthService {
  return {
    async needsSetup() {
      return !(await repository.exists());
    },
    async setup(input) {
      const username = input.username.trim();
      const digest = await passwordCodec.hash(input.password);
      await repository.create({ username, ...digest });
      return { username };
    },
    async authenticate(input) {
      const admin = await repository.find();
      if (!admin || input.username.trim() !== admin.username) return null;
      const valid = await passwordCodec.verify(input.password, admin);
      return valid ? { username: admin.username } : null;
    }
  };
}
```

Create `apps/api/src/services/admin-repository.ts`:

```ts
import { AdminModel } from "../models/admin";
import {
  AdminAlreadyExistsError,
  type AdminRepository
} from "./admin-auth";

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000;
}

export function createMongooseAdminRepository(): AdminRepository {
  return {
    async exists() {
      return (await AdminModel.exists({ _id: "primary" })) !== null;
    },
    async find() {
      const admin = await AdminModel.findById("primary").lean();
      return admin ? {
        username: admin.username,
        passwordSalt: admin.passwordSalt,
        passwordHash: admin.passwordHash
      } : null;
    },
    async create(admin) {
      try {
        await AdminModel.create({ _id: "primary", ...admin });
      } catch (error) {
        if (isDuplicateKey(error)) throw new AdminAlreadyExistsError();
        throw error;
      }
    }
  };
}
```

- [ ] **Step 9: Run domain tests and typecheck**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run \
  src/tests/admin-credentials.test.ts \
  src/tests/admin-auth.test.ts
pnpm --filter @douyin-admin/api typecheck
```

Expected: 7 tests PASS and typecheck exits 0.

- [ ] **Step 10: Commit the domain layer**

```bash
git add \
  apps/api/src/models/admin.ts \
  apps/api/src/services/admin-credentials.ts \
  apps/api/src/services/admin-auth.ts \
  apps/api/src/services/admin-repository.ts \
  apps/api/src/tests/admin-credentials.test.ts \
  apps/api/src/tests/admin-auth.test.ts \
  apps/api/src/tests/admin-test-helper.ts
git commit -m "feat(api): add persistent single admin credentials"
```

---

### Task 2: Setup and Database-Backed Login API

**Files:**

- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/tests/auth.routes.test.ts`
- Modify: `apps/api/src/tests/accounts.routes.test.ts`
- Modify: `apps/api/src/tests/app-security.test.ts`
- Modify: `apps/api/src/tests/test-config.ts`
- Modify: `apps/api/src/tests/config.test.ts`

**Interfaces:**

- Consumes: `AdminAuthService`, `AdminAlreadyExistsError`, `createAdminAuthService`, `createMongooseAdminRepository`
- Produces: `createAuthRouter(config: AppConfig, adminAuth: AdminAuthService): Router`
- Produces: `GET /api/auth/setup -> { needsSetup: boolean }`
- Produces: `POST /api/auth/setup -> { authenticated: true; username: string }`
- Preserves: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`

- [ ] **Step 1: Rewrite route tests first**

Update `apps/api/src/tests/auth.routes.test.ts` to construct a fresh auth service per test:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createTestAdminAuth } from "./admin-test-helper";
import { testConfig } from "./test-config";

const credentials = {
  username: "admin",
  password: "a-long-admin-password"
};

async function setupApp(initial = false) {
  const adminAuth = await createTestAdminAuth(initial ? credentials : undefined);
  return createApp({ config: testConfig, adminAuth });
}

describe("authentication routes", () => {
  it("reports setup only before an administrator exists", async () => {
    const empty = await request(await setupApp()).get("/api/auth/setup");
    expect(empty.body).toEqual({ needsSetup: true });
    expect(empty.headers["cache-control"]).toBe("no-store");
    expect((await request(await setupApp(true)).get("/api/auth/setup")).body)
      .toEqual({ needsSetup: false });
  });

  it("creates the first administrator and starts its session", async () => {
    const agent = new request.agent(await setupApp());
    const setup = await agent.post("/api/auth/setup").send(credentials);

    expect(setup.status).toBe(201);
    expect(setup.body).toEqual({ authenticated: true, username: "admin" });
    expect(setup.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect((await agent.get("/api/auth/session")).body).toEqual({
      authenticated: true,
      username: "admin"
    });
    expect((await agent.get("/api/auth/setup")).body)
      .toEqual({ needsSetup: false });
  });

  it("rejects setup after the administrator exists", async () => {
    const app = await setupApp(true);
    const response = await request(app).post("/api/auth/setup").send({
      username: "replacement",
      password: "another-long-password"
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ADMIN_ALREADY_EXISTS");
  });

  it("validates setup credentials", async () => {
    const response = await request(await setupApp())
      .post("/api/auth/setup")
      .send({ username: "admin", password: "short" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("requires setup before login", async () => {
    const response = await request(await setupApp())
      .post("/api/auth/login")
      .send(credentials);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SETUP_REQUIRED");
  });

  it("rejects invalid credentials without identifying the bad field", async () => {
    const response = await request(await setupApp(true))
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
      message: "用户名或密码错误"
    });
  });

  it("sets an HttpOnly SameSite cookie and exposes the session", async () => {
    const agent = new request.agent(await setupApp(true));
    const login = await agent.post("/api/auth/login").send(credentials);

    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
    expect((await agent.get("/api/auth/session")).body).toEqual({
      authenticated: true,
      username: "admin"
    });
  });

  it("destroys the server-side session on logout", async () => {
    const agent = new request.agent(await setupApp(true));
    await agent.post("/api/auth/login").send(credentials);

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/auth.routes.test.ts
```

Expected: FAIL because `createApp` does not accept `adminAuth` and `/api/auth/setup` does not exist.

- [ ] **Step 3: Implement setup routes and database login**

In `apps/api/src/routes/auth.ts`:

- Replace environment credential comparison with `adminAuth.authenticate`.
- Use this shared schema for both setup and login:

```ts
const CredentialsSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(4096)
}).strict();
```

- Add the public status route:

```ts
router.get("/setup", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json({ needsSetup: await adminAuth.needsSetup() });
  } catch (error) {
    next(error);
  }
});
```

- Add the rate-limited setup route before login:

```ts
router.post("/setup", setupLimiter, async (req, res, next) => {
  try {
    const credentials = CredentialsSchema.parse(req.body);
    const admin = await adminAuth.setup(credentials);
    await establishAdminSession(req, admin.username);
    res.status(201).json({ authenticated: true, username: admin.username });
  } catch (error) {
    if (error instanceof AdminAlreadyExistsError) {
      next(new AppError(
        409,
        "ADMIN_ALREADY_EXISTS",
        "管理员已存在，请直接登录"
      ));
      return;
    }
    next(error);
  }
});
```

- Extract the existing regenerate/save block without changing cookie behavior:

```ts
async function establishAdminSession(
  req: Request,
  username: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
  req.session.admin = {
    username,
    authenticatedAt: new Date().toISOString()
  };
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}
```

- Login checks setup before authentication and maps outcomes exactly:

```ts
if (await adminAuth.needsSetup()) {
  throw new AppError(409, "SETUP_REQUIRED", "请先注册管理员");
}
const admin = await adminAuth.authenticate(credentials);
if (!admin) {
  throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误");
}
await establishAdminSession(req, admin.username);
res.json({ authenticated: true, username: admin.username });
```

- Keep separate `setupLimiter` and `loginLimiter` instances, both with 10 requests per 15 minutes and keys based on IP plus normalized username.

- [ ] **Step 4: Inject the service into app and production server**

Change `CreateAppOptions` in `apps/api/src/app.ts`:

```ts
import type { AdminAuthService } from "./services/admin-auth";

type CreateAppOptions = {
  config: AppConfig;
  adminAuth: AdminAuthService;
  // retain the existing optional services
};
```

Pass it to the router:

```ts
app.use("/api/auth", createAuthRouter(config, adminAuth));
```

In `apps/api/src/server.ts`, create and pass the production service after MongoDB connects:

```ts
import { createAdminAuthService } from "./services/admin-auth";
import { createMongooseAdminRepository } from "./services/admin-repository";

const adminAuth = createAdminAuthService(createMongooseAdminRepository());

const app = createApp({
  config,
  adminAuth,
  // retain existing arguments
});
```

- [ ] **Step 5: Remove credential environment configuration with a failing config assertion**

First update `apps/api/src/tests/config.test.ts`:

```ts
const validEnv = {
  NODE_ENV: "test",
  PORT: "3000",
  SESSION_SECRET: "a-session-secret-with-more-than-32-characters",
  SESSION_HOURS: "12",
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  MONGO_URI: "mongodb://admin:password@mongo:27017/douyin?authSource=admin",
  DOUYIN_CHECK_API_URL: "https://unid.tztright.top/check"
};

it("does not load obsolete administrator credentials", () => {
  const config = loadConfig({
    ...validEnv,
    ADMIN_USERNAME: "ignored",
    ADMIN_PASSWORD: "ignored-long-password"
  });

  expect(config).not.toHaveProperty("adminUsername");
  expect(config).not.toHaveProperty("adminPassword");
});
```

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run src/tests/config.test.ts
```

Expected: FAIL because `loadConfig(validEnv)` still requires the removed variables.

Then delete `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `EnvironmentSchema`, `AppConfig`, and the `loadConfig` return value in `apps/api/src/config.ts`. Delete `adminUsername` and `adminPassword` from `apps/api/src/tests/test-config.ts`.

- [ ] **Step 6: Adapt existing app tests to the required auth service**

In tests that only need an unauthenticated app, create the service inline:

```ts
const adminAuth = await createTestAdminAuth();
const app = createApp({ config: testConfig, adminAuth });
```

For `apps/api/src/tests/accounts.routes.test.ts`, create a configured service before each login:

```ts
const adminAuth = await createTestAdminAuth({
  username: "admin",
  password: "a-long-admin-password"
});
const app = createApp({ config: testConfig, adminAuth, accountService });
```

Make affected tests `async` where necessary. Update `apps/api/src/tests/app-security.test.ts` even though it is not behaviorally changed, because `adminAuth` is now a required `createApp` dependency.

- [ ] **Step 7: Run focused and complete API verification**

Run:

```bash
pnpm --filter @douyin-admin/api exec vitest run \
  src/tests/admin-credentials.test.ts \
  src/tests/admin-auth.test.ts \
  src/tests/auth.routes.test.ts \
  src/tests/app-security.test.ts \
  src/tests/accounts.routes.test.ts \
  src/tests/config.test.ts
pnpm --filter @douyin-admin/api test
pnpm --filter @douyin-admin/api typecheck
```

Expected: focused tests PASS, the complete API suite PASS, and typecheck exits 0.

- [ ] **Step 8: Commit the authenticated setup API**

```bash
git add \
  apps/api/src/routes/auth.ts \
  apps/api/src/app.ts \
  apps/api/src/server.ts \
  apps/api/src/config.ts \
  apps/api/src/tests/auth.routes.test.ts \
  apps/api/src/tests/accounts.routes.test.ts \
  apps/api/src/tests/app-security.test.ts \
  apps/api/src/tests/test-config.ts \
  apps/api/src/tests/config.test.ts
git commit -m "feat(api): add one-time admin setup"
```

---

### Task 3: Registration Page and Setup-Aware Routing

**Files:**

- Create: `apps/web/src/features/AuthEntry.tsx`
- Create: `apps/web/src/features/SetupPage.tsx`
- Create: `apps/web/src/tests/auth-bootstrap.test.tsx`
- Create: `apps/web/src/tests/setup.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/features/SimplePage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `api<T>(path, init)` and `ApiError`
- Produces: `SetupState = { needsSetup: boolean }`
- Produces: `AuthEntry({ mode: "setup" | "login" })`
- Produces: `SetupPage()`
- Produces: frontend route `/setup`

- [ ] **Step 1: Add the DOM test dependencies**

Run:

```bash
pnpm --filter @douyin-admin/web add -D \
  @testing-library/jest-dom \
  @testing-library/react \
  @testing-library/user-event \
  jsdom
```

Update `apps/web/vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"]
  }
});
```

Create `apps/web/src/tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Write failing frontend setup-flow tests**

Create `apps/web/src/tests/auth-bootstrap.test.tsx`. Use a real `QueryClient`, `MemoryRouter`, and user events. Mock only the HTTP boundary:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function renderApp(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("administrator bootstrap UI", () => {
  it("shows registration by default when no administrator exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ needsSetup: true })));
    renderApp("/login");

    expect(await screen.findByRole("heading", { name: "注册管理员" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" }))
      .not.toBeInTheDocument();
  });

  it("hides setup and shows login after an administrator exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ needsSetup: false })));
    renderApp("/setup");

    expect(await screen.findByRole("heading", { name: "账号管理台" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "注册管理员" }))
      .not.toBeInTheDocument();
  });

  it("does not submit when password confirmation differs", async () => {
    const fetchMock = vi.fn(async () => json({ needsSetup: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "different-long-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("submits setup and enters the account page", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = String(input);
      if (path === "/api/auth/setup" && !init?.method) {
        return json({ needsSetup: true });
      }
      if (path === "/api/auth/setup" && init.method === "POST") {
        return json({ authenticated: true, username: "admin" }, 201);
      }
      if (path === "/api/auth/session") {
        return json({ authenticated: true, username: "admin" });
      }
      return json({ items: [], total: 0, page: 1, pageSize: 20 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "a-long-admin-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByText("抖音账号")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/setup",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("moves a stale registration page to login after a setup conflict", async () => {
    let setupChecks = 0;
    vi.stubGlobal("fetch", vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const path = String(input);
      if (path === "/api/auth/setup" && init?.method === "POST") {
        return json({
          error: {
            code: "ADMIN_ALREADY_EXISTS",
            message: "管理员已存在，请直接登录"
          },
          requestId: "request-id"
        }, 409);
      }
      if (path === "/api/auth/setup") {
        return json({ needsSetup: setupChecks++ === 0 });
      }
      return json({});
    }));
    renderApp("/setup");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("用户名"), "admin");
    await user.type(screen.getByLabelText("密码"), "a-long-admin-password");
    await user.type(screen.getByLabelText("确认密码"), "a-long-admin-password");
    await user.click(screen.getByRole("button", { name: "注册管理员" }));

    expect(await screen.findByRole("heading", { name: "账号管理台" }))
      .toBeInTheDocument();
  });

  it("shows a retry action when setup state cannot load", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce(json({ needsSetup: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/login");
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("无法确认管理员状态");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "注册管理员" }))
      .toBeInTheDocument();
  });

  it("describes MongoDB as the administrator credential store", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") {
        return json({ authenticated: true, username: "admin" });
      }
      if (path === "/api/settings") {
        return json({ defaultPageSize: 20, sessionHours: 12 });
      }
      return json({});
    }));
    renderApp("/settings");

    expect(await screen.findByText(
      "管理员账号和密码在首次注册后加密保存在 MongoDB 中，不会显示在页面中。"
    )).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run frontend tests and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web exec vitest run src/tests/auth-bootstrap.test.tsx
```

Expected: FAIL because `/setup`, `AuthEntry`, and `SetupPage` do not exist.

- [ ] **Step 4: Implement the setup-state gate**

Create `apps/web/src/features/AuthEntry.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { LoginPage } from "./LoginPage";
import { SetupPage } from "./SetupPage";

export type SetupState = { needsSetup: boolean };

export function AuthEntry({ mode }: { mode: "setup" | "login" }) {
  const setup = useQuery({
    queryKey: ["auth-setup"],
    queryFn: () => api<SetupState>("/api/auth/setup"),
    retry: false
  });

  if (setup.isLoading) {
    return <div className="screen-center">正在确认管理员状态…</div>;
  }
  if (setup.isError) {
    return <div className="login-page">
      <div className="login-card auth-state-error">
        <div className="form-error" role="alert">无法确认管理员状态，请检查服务后重试</div>
        <button className="primary" onClick={() => void setup.refetch()}>重试</button>
      </div>
    </div>;
  }
  if (setup.data.needsSetup && mode === "login") {
    return <Navigate to="/setup" replace />;
  }
  if (!setup.data.needsSetup && mode === "setup") {
    return <Navigate to="/login" replace />;
  }
  return mode === "setup" ? <SetupPage /> : <LoginPage />;
}
```

- [ ] **Step 5: Implement the registration form**

Create `apps/web/src/features/SetupPage.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      queryClient.setQueryData(["auth-setup"], { needsSetup: false });
      queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/accounts", { replace: true });
    } catch (value) {
      if (value instanceof ApiError &&
          value.body.error.code === "ADMIN_ALREADY_EXISTS") {
        await queryClient.invalidateQueries({ queryKey: ["auth-setup"] });
        navigate("/login", { replace: true });
        return;
      }
      setError(value instanceof Error ? value.message : "注册失败");
    } finally {
      setBusy(false);
    }
  };

  return <div className="login-page">
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo">抖</div>
      <h1>注册管理员</h1>
      <p>首次使用请创建唯一管理员，注册完成后此页面将关闭</p>
      <label>用户名
        <input name="username" autoComplete="username" required autoFocus />
      </label>
      <label>密码
        <input name="password" type="password" minLength={12}
          autoComplete="new-password" required />
      </label>
      <label>确认密码
        <input name="confirmation" type="password" minLength={12}
          autoComplete="new-password" required />
      </label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary" disabled={busy}>
        {busy ? "注册中…" : "注册管理员"}
      </button>
    </form>
  </div>;
}
```

- [ ] **Step 6: Wire routes and preserve a login-only page**

Update `apps/web/src/app/App.tsx`:

```tsx
import { AuthEntry } from "../features/AuthEntry";

export function App() {
  return <Routes>
    <Route path="/setup" element={<AuthEntry mode="setup" />} />
    <Route path="/login" element={<AuthEntry mode="login" />} />
    <Route path="/*" element={<Shell />} />
  </Routes>;
}
```

Keep `LoginPage.tsx` free of registration links. Its heading remains `账号管理台`, its password autocomplete remains `current-password`, and a successful login still navigates to `/accounts`.

In `apps/web/src/features/SimplePage.tsx`, replace the obsolete settings copy with:

```tsx
<p>管理员账号和密码在首次注册后加密保存在 MongoDB 中，不会显示在页面中。</p>
```

Add only focused setup/error styling to `apps/web/src/styles.css`:

```css
.auth-state-error { gap: 12px; }
.auth-state-error .form-error { margin: 0; }
```

- [ ] **Step 7: Run frontend verification**

Run:

```bash
pnpm --filter @douyin-admin/web exec vitest run src/tests/auth-bootstrap.test.tsx
pnpm --filter @douyin-admin/web test
pnpm --filter @douyin-admin/web typecheck
pnpm --filter @douyin-admin/web build
```

Expected: bootstrap tests PASS, the complete web suite PASS, typecheck exits 0, and Vite produces the production bundle.

- [ ] **Step 8: Commit the registration UI**

```bash
git add \
  apps/web/src/features/AuthEntry.tsx \
  apps/web/src/features/SetupPage.tsx \
  apps/web/src/app/App.tsx \
  apps/web/src/features/SimplePage.tsx \
  apps/web/src/styles.css \
  apps/web/src/tests/auth-bootstrap.test.tsx \
  apps/web/src/tests/setup.ts \
  apps/web/vite.config.ts \
  apps/web/package.json \
  pnpm-lock.yaml
git commit -m "feat(web): add first admin registration"
```

---

### Task 4: Docker and Operator Documentation

**Files:**

- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**

- Consumes: API configuration without `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- Produces: first-run operator workflow backed by the existing `mongo_data` volume

- [ ] **Step 1: Remove obsolete Docker credentials**

Delete these lines from `.env.example`:

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-long-random-password
```

Replace their comment with:

```dotenv
# 管理员账号和密码在首次打开后台时注册，并保存在 MongoDB 中。
```

Delete these lines from the API `environment` block in `docker-compose.yml`:

```yaml
ADMIN_USERNAME: ${ADMIN_USERNAME}
ADMIN_PASSWORD: ${ADMIN_PASSWORD}
```

Do not edit the user's real `.env`; obsolete values there are harmless and ignored.

- [ ] **Step 2: Update the deployment and recovery documentation**

Update `README.md` so the quick start says:

```markdown
首次部署后打开 `http://localhost:${WEB_PORT}`。如果 MongoDB 中还没有管理员，
页面会自动显示“注册管理员”；注册成功后自动登录，注册页面随即关闭。
之后重启或重新构建容器都只显示登录页，因为管理员凭据保存在 `mongo_data` 数据卷中。
```

Replace instructions that say to configure an administrator password in `.env`. Retain instructions to set MongoDB credentials, session secret, field encryption key, API URLs, port, timezone, and secure-cookie behavior.

Add an explicit recovery boundary:

```markdown
系统不使用 `ADMIN_USERNAME`、`ADMIN_PASSWORD`，也不提供网页密码重置。
请备份 MongoDB 数据卷和管理员密码；丢失密码需要由运维人员直接执行受控恢复，
不能通过重新添加旧环境变量绕过登录。
```

- [ ] **Step 3: Verify config references and Compose rendering**

Run:

```bash
rg -n "ADMIN_USERNAME|ADMIN_PASSWORD" \
  apps packages .env.example docker-compose.yml README.md \
  -g '!**/dist/**' -g '!**/node_modules/**'
docker compose config
```

Expected: `rg` finds only the config regression test that supplies the obsolete names and proves they are ignored; it finds no runtime, example, or documentation dependency. Historical design/plan documents are outside this scan. `docker compose config` exits 0 without requiring administrator variables.

- [ ] **Step 4: Commit deployment documentation**

```bash
git add .env.example docker-compose.yml README.md
git commit -m "docs: document first admin setup"
```

---

### Task 5: Full Verification, Isolated Persistence Proof, and Live Docker Update

**Files:**

- Verify only; no expected source edits.

**Interfaces:**

- Consumes: complete API, web, MongoDB, and Docker changes from Tasks 1–4
- Produces: test evidence, isolated persistence evidence, and the updated local deployment at `http://127.0.0.1:18080`

- [ ] **Step 1: Run the complete repository verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
git status --short
```

Expected:

- all shared, API, and web tests PASS;
- all TypeScript projects typecheck;
- API and web production builds succeed;
- no whitespace errors;
- only the user-owned untracked `QQ昵称识别API说明.md` remains outside committed work.

- [ ] **Step 2: Build the final Docker images**

Run:

```bash
docker compose build api web
```

Expected: both images build from the committed source with no missing administrator environment variables.

- [ ] **Step 3: Prove registration and restart persistence in an isolated Compose project**

Use a separate project name, fixed throwaway test-only credentials, a separate volume, and non-production port. These values are not production secrets and the isolated volume is deleted at the end:

```bash
MONGO_ROOT_USERNAME=bootstrap_test \
MONGO_ROOT_PASSWORD=bootstrap-mongo-password-2026 \
MONGO_DATABASE=bootstrap_accounts \
SESSION_SECRET=bootstrap-session-secret-at-least-32-characters \
SESSION_HOURS=12 \
FIELD_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
DOUYIN_CHECK_API_URL=https://unid.tztright.top/check \
WEB_PORT=18081 \
COOKIE_SECURE=false \
docker compose -p account-admin-bootstrap-test up -d
```

Verify:

1. `GET http://127.0.0.1:18081/api/auth/setup` returns `needsSetup=true`.
2. Send two concurrent `POST /api/auth/setup` requests, both using username `bootstrap_admin` and password `bootstrap-test-password-2026`; verify exactly one returns 201 while the other returns 409 `ADMIN_ALREADY_EXISTS`.
3. A third `POST /api/auth/setup` returns 409 and does not replace the administrator.
4. `GET /api/auth/setup` returns `needsSetup=false`.
5. Restart the isolated API and Web services.
6. Setup still returns `needsSetup=false`.
7. Login with the same throwaway administrator succeeds.
8. Logs contain no password, salt, hash, or session cookie.

Use these exact probes; they print response bodies or status codes but never session cookies:

```bash
curl -fsS http://127.0.0.1:18081/api/auth/setup

node --input-type=module -e '
const body = JSON.stringify({
  username: "bootstrap_admin",
  password: "bootstrap-test-password-2026"
});
const responses = await Promise.all([
  fetch("http://127.0.0.1:18081/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  }),
  fetch("http://127.0.0.1:18081/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  })
]);
process.stdout.write(responses.map((response) => response.status).sort().join(",") + "\n");
'

node --input-type=module -e '
const response = await fetch("http://127.0.0.1:18081/api/auth/setup", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: "bootstrap_admin",
    password: "bootstrap-test-password-2026"
  })
});
process.stdout.write(String(response.status) + "\n");
'

curl -fsS http://127.0.0.1:18081/api/auth/setup
```

Expected output contains concurrent statuses `201,409`, then a third status `409`, and the final setup body is `{"needsSetup":false}`.

Restart with the same isolated project variables shown above:

```bash
MONGO_ROOT_USERNAME=bootstrap_test \
MONGO_ROOT_PASSWORD=bootstrap-mongo-password-2026 \
MONGO_DATABASE=bootstrap_accounts \
SESSION_SECRET=bootstrap-session-secret-at-least-32-characters \
SESSION_HOURS=12 \
FIELD_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
DOUYIN_CHECK_API_URL=https://unid.tztright.top/check \
WEB_PORT=18081 \
COOKIE_SECURE=false \
docker compose -p account-admin-bootstrap-test restart api web

curl -fsS http://127.0.0.1:18081/api/auth/setup

node --input-type=module -e '
const response = await fetch("http://127.0.0.1:18081/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: "bootstrap_admin",
    password: "bootstrap-test-password-2026"
  })
});
process.stdout.write(String(response.status) + "\n");
'
```

Expected: setup remains false and login status is 200.

Clean up only the exact isolated project and its volume:

```bash
MONGO_ROOT_USERNAME=bootstrap_test \
MONGO_ROOT_PASSWORD=bootstrap-mongo-password-2026 \
MONGO_DATABASE=bootstrap_accounts \
SESSION_SECRET=bootstrap-session-secret-at-least-32-characters \
SESSION_HOURS=12 \
FIELD_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
DOUYIN_CHECK_API_URL=https://unid.tztright.top/check \
WEB_PORT=18081 \
COOKIE_SECURE=false \
docker compose -p account-admin-bootstrap-test down -v
```

Report that the isolated administrator and database volume were deleted and are not recoverable.

- [ ] **Step 4: Update the real local deployment without creating a dummy administrator**

Run:

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 api web
```

Expected:

- MongoDB, API, and Web containers are healthy;
- Web remains mapped to `127.0.0.1:18080` according to the user's current `.env`;
- API logs show startup only and no credential material;
- the real MongoDB contains no administrator record before the user registers, so the deployed browser defaults to `/setup`.

Do not register invented credentials in the user's real database.

- [ ] **Step 5: Verify the live UI behavior**

Using the in-app browser:

1. Open `http://127.0.0.1:18080/login`.
2. Confirm it automatically replaces the route with `/setup`.
3. Confirm the visible form has username, password, confirmation, and “注册管理员”.
4. Confirm there is no login button or alternate registration link on the setup screen.
5. Check desktop and narrow mobile viewport layouts for clipping and keyboard-accessible labels.

Stop before submitting the real registration form, because only the user should choose the permanent administrator password.

- [ ] **Step 6: Final repository and service audit**

Run:

```bash
git log -8 --oneline --decorate
git status --short --branch
docker compose ps
```

Report:

- exact commit IDs created by the implementation;
- total passing test counts;
- Docker health and live URL;
- that the real deployment is waiting at the one-time administrator registration page;
- that the user-owned Markdown file was untouched;
- whether a Git remote exists, and do not claim any push unless `git push` and remote synchronization were actually verified.
