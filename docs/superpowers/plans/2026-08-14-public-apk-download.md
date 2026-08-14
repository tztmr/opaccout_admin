# Public APK Same-Origin Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the verified `短位op修复.apk` artifact through the public short-OP site at the same-origin path `/downloads/short-op.apk`, available without authentication.

**Architecture:** Vite copies the APK from `apps/web/public/downloads/` into the Web build unchanged. Both public-page implementations link to a relative URL; the container Nginx serves one exact static path with download headers, and the deployment script's public-domain Nginx allowlist proxies only that exact path.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, Vitest 3, Node test runner, Nginx 1.27, Docker Compose

## Global Constraints

- Public URL is exactly `/downloads/short-op.apk` on `op.tztright.qzz.io`.
- The page link must be relative so the download remains same-origin in every environment.
- Download requires no administrator session.
- Browser-visible filename is `短位op修复.apk`.
- Only `GET` and `HEAD` are accepted; other methods return `405`.
- Expected artifact size is exactly 881,585 bytes.
- Expected SHA-256 is exactly `04b2b747ee36eb9891cc64bff8e135431b2bf39daa8692d4d1f8a0bd8f8c36cd`.
- Do not widen the public domain's existing API or catch-all route boundaries.
- Preserve all unrelated dirty-worktree changes and stage only the files named by each task.

---

## File Structure

- Create `apps/web/public/downloads/short-op.apk`: immutable APK bytes copied into the Web build.
- Modify `apps/web/public/op.html`: production static public page and its download-button styling.
- Modify `apps/web/src/features/ShortOpPage.tsx`: React development/fallback public page.
- Modify `apps/web/src/styles.css`: React download-button styling.
- Modify `apps/web/src/tests/public-static-op.test.ts`: artifact integrity, static page, and container route regression coverage.
- Modify `apps/web/src/tests/short-op-page.test.tsx`: React same-origin link behavior.
- Modify `apps/web/nginx.conf`: exact container-level download route and response headers.
- Modify `test/deploy-dual-domain.test.mjs`: rendered outer-Nginx allowlist regression coverage.
- Modify `deploy-opaccout-admin.sh`: exact public-domain proxy route.
- Modify `README.md`: published URL, filename, and verification guidance.

### Task 1: Add the verified APK build input

**Files:**
- Create: `apps/web/public/downloads/short-op.apk`
- Modify: `apps/web/src/tests/public-static-op.test.ts`

**Interfaces:**
- Consumes: `/Users/edking/Downloads/短位op修复.apk`
- Produces: a Vite public asset at `/downloads/short-op.apk` with the fixed size and SHA-256 above

- [ ] **Step 1: Write the failing artifact-integrity test**

Add imports and a focused test to `apps/web/src/tests/public-static-op.test.ts`:

```ts
import { createHash } from "node:crypto";

const apkPath = join(publicDir, "downloads", "short-op.apk");

it("ships the approved short OP APK bytes", () => {
  const apk = readFileSync(apkPath);
  expect(apk.byteLength).toBe(881_585);
  expect(createHash("sha256").update(apk).digest("hex")).toBe(
    "04b2b747ee36eb9891cc64bff8e135431b2bf39daa8692d4d1f8a0bd8f8c36cd"
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts`

Expected: FAIL because `apps/web/public/downloads/short-op.apk` does not exist.

- [ ] **Step 3: Copy only the approved bytes into the Web public tree**

```bash
mkdir -p apps/web/public/downloads
install -m 0644 /Users/edking/Downloads/短位op修复.apk apps/web/public/downloads/short-op.apk
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts`

Expected: PASS, including exact byte length and SHA-256.

- [ ] **Step 5: Commit the artifact and integrity test**

```bash
git add apps/web/public/downloads/short-op.apk apps/web/src/tests/public-static-op.test.ts
git commit -m "build: add verified short OP APK download"
```

### Task 2: Add same-origin download links to both public pages

**Files:**
- Modify: `apps/web/src/tests/public-static-op.test.ts`
- Modify: `apps/web/src/tests/short-op-page.test.tsx`
- Modify: `apps/web/public/op.html`
- Modify: `apps/web/src/features/ShortOpPage.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `/downloads/short-op.apk` from Task 1
- Produces: a link named `下载短位 OP APK` with `href="/downloads/short-op.apk"` and `download="短位op修复.apk"`

- [ ] **Step 1: Write failing page-link tests**

Add this test to the static-page suite:

```ts
it("offers the APK through a relative same-origin download link", () => {
  expect(opHtml).toContain('href="/downloads/short-op.apk"');
  expect(opHtml).toContain('download="短位op修复.apk"');
  expect(opHtml).toContain("下载短位 OP APK");
  expect(opHtml).not.toContain("https://op.tztright.qzz.io/downloads/short-op.apk");
});
```

Add this test to `apps/web/src/tests/short-op-page.test.tsx`:

```tsx
it("offers the APK through the current public origin", () => {
  render(
    <MemoryRouter>
      <ShortOpPage hostname="op.tztright.qzz.io" onWake={vi.fn()} />
    </MemoryRouter>
  );

  expect(screen.getByRole("link", { name: "下载短位 OP APK" })).toHaveAttribute(
    "href",
    "/downloads/short-op.apk"
  );
  expect(screen.getByRole("link", { name: "下载短位 OP APK" })).toHaveAttribute(
    "download",
    "短位op修复.apk"
  );
});
```

- [ ] **Step 2: Run both focused suites and verify RED**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts src/tests/short-op-page.test.tsx
```

Expected: FAIL because neither public page renders the download link.

- [ ] **Step 3: Add the minimal static and React links**

Place this anchor immediately after each short-OP form:

```html
<a class="short-op-download" href="/downloads/short-op.apk" download="短位op修复.apk">
  下载短位 OP APK
</a>
```

Use JSX attribute casing in `ShortOpPage.tsx`:

```tsx
<a className="short-op-download" href="/downloads/short-op.apk" download="短位op修复.apk">
  下载短位 OP APK
</a>
```

Add matching compact secondary-button styling to the inline static CSS and `apps/web/src/styles.css`:

```css
.short-op-download {
  min-height: 46px;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cad3e2;
  border-radius: 12px;
  color: #354bc4;
  background: #fff;
  font-weight: 700;
  text-decoration: none;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts src/tests/short-op-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the page behavior**

```bash
git add apps/web/public/op.html apps/web/src/features/ShortOpPage.tsx apps/web/src/styles.css apps/web/src/tests/public-static-op.test.ts apps/web/src/tests/short-op-page.test.tsx
git commit -m "feat: add public APK download link"
```

### Task 3: Serve the exact APK path from the Web container

**Files:**
- Modify: `apps/web/src/tests/public-static-op.test.ts`
- Modify: `apps/web/nginx.conf`

**Interfaces:**
- Consumes: `/usr/share/nginx/html/downloads/short-op.apk` produced by the existing Docker build
- Produces: exact route `/downloads/short-op.apk`; `GET` and `HEAD` return the APK, all other methods return `405`

- [ ] **Step 1: Write the failing container-route contract test**

Add a test that names the three relevant failure modes: missing exact route, wrong attachment filename, and an overly broad downloads prefix.

```ts
it("serves only the approved APK path with download-safe headers", () => {
  expect(nginxConf).toMatch(
    /location = \/downloads\/short-op\.apk\s*\{[\s\S]*if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405; \}/
  );
  expect(nginxConf).toMatch(
    /location = \/downloads\/short-op\.apk\s*\{[\s\S]*application\/vnd\.android\.package-archive/
  );
  expect(nginxConf).toContain(
    "filename*=UTF-8''%E7%9F%AD%E4%BD%8Dop%E4%BF%AE%E5%A4%8D.apk"
  );
  expect(nginxConf).toMatch(
    /location = \/downloads\/short-op\.apk\s*\{[\s\S]*X-Content-Type-Options nosniff/
  );
  expect(nginxConf).not.toMatch(/location \/downloads\//);
});
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts`

Expected: FAIL because the exact Nginx location is absent.

- [ ] **Step 3: Add the minimal exact Nginx location**

Add before the generic `/assets/` and `/` locations:

```nginx
location = /downloads/short-op.apk {
  if ($request_method !~ ^(GET|HEAD)$) { return 405; }
  types { application/vnd.android.package-archive apk; }
  add_header Content-Disposition "attachment; filename=\"short-op.apk\"; filename*=UTF-8''%E7%9F%AD%E4%BD%8Dop%E4%BF%AE%E5%A4%8D.apk" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Cache-Control "public, max-age=3600" always;
  try_files /downloads/short-op.apk =404;
}
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run: `pnpm --filter @douyin-admin/web test -- src/tests/public-static-op.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the container route**

```bash
git add apps/web/nginx.conf apps/web/src/tests/public-static-op.test.ts
git commit -m "feat: serve APK from exact Web route"
```

### Task 4: Allowlist the exact download path on the public domain

**Files:**
- Modify: `test/deploy-dual-domain.test.mjs`
- Modify: `deploy-opaccout-admin.sh`

**Interfaces:**
- Consumes: exact container route from Task 3
- Produces: an outer Nginx `location = /downloads/short-op.apk` that preserves the original URI and proxy trust headers

- [ ] **Step 1: Write the failing rendered-config test**

Extend `renders separate admin and public OP hosts with their intended boundaries` with:

```js
assert.match(
  publicOp,
  /location = \/downloads\/short-op\.apk\s*\{[\s\S]*if \(\$request_method !~ \^\(GET\|HEAD\)\$\) \{ return 405; \}/
);
assert.match(
  publicOp,
  /location = \/downloads\/short-op\.apk\s*\{[\s\S]*proxy_pass http:\/\/127\.0\.0\.1:8080;/
);
assert.doesNotMatch(publicOp, /location \/downloads\//);
```

- [ ] **Step 2: Run the deployment test and verify RED**

Run: `node --test test/deploy-dual-domain.test.mjs`

Expected: FAIL because the rendered public host has no APK route.

- [ ] **Step 3: Add the exact public-domain proxy location**

Add this block before the final public-domain `location / { return 404; }`:

```nginx
location = /downloads/short-op.apk {
    if (\$request_method !~ ^(GET|HEAD)\$) { return 405; }
    proxy_pass http://127.0.0.1:${web_port};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
}
```

- [ ] **Step 4: Run the deployment test and verify GREEN**

Run: `node --test test/deploy-dual-domain.test.mjs`

Expected: PASS with the existing `/api/` and catch-all boundary assertions still green.

- [ ] **Step 5: Commit the outer allowlist**

```bash
git add deploy-opaccout-admin.sh test/deploy-dual-domain.test.mjs
git commit -m "feat: allow public same-origin APK download"
```

### Task 5: Document, build, and verify the complete download chain

**Files:**
- Modify: `README.md`
- Verify: `apps/web/dist/downloads/short-op.apk` generated output

**Interfaces:**
- Consumes: completed Tasks 1-4
- Produces: build evidence, local HTTP evidence when Docker is available, and an explicit production verification result

- [ ] **Step 1: Update operator documentation**

Replace the retired artifact reference with:

```markdown
公开下载地址为 `https://op.tztright.qzz.io/downloads/short-op.apk`，页面使用同源相对链接 `/downloads/short-op.apk`。公开下载无需管理员登录，只允许 `GET` 和 `HEAD`。
```

Document the approved SHA-256 and the rule that only a successful public `GET` with the same hash proves deployment.

- [ ] **Step 2: Run all code-level verification**

```bash
pnpm --filter @douyin-admin/web test
node --test test/deploy-dual-domain.test.mjs
pnpm --filter @douyin-admin/web typecheck
pnpm --filter @douyin-admin/web build
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command exits `0` with no test failures or TypeScript errors.

- [ ] **Step 3: Verify build-output identity**

```bash
stat -f '%z' apps/web/dist/downloads/short-op.apk
shasum -a 256 /Users/edking/Downloads/短位op修复.apk apps/web/public/downloads/short-op.apk apps/web/dist/downloads/short-op.apk
```

Expected: size `881585` and the same approved SHA-256 for all three files.

- [ ] **Step 4: Run an actual local HTTP check when Docker is available**

```bash
DOCKER_BUILDKIT=0 docker compose up -d --build
download_check_dir="$(mktemp -d)"
web_port="$(awk -F= '$1 == "WEB_PORT" { print $2 }' .env)"
web_port="${web_port:-8080}"
curl --fail --silent --show-error --dump-header "${download_check_dir}/headers.txt" --output "${download_check_dir}/short-op.apk" "http://127.0.0.1:${web_port}/downloads/short-op.apk"
curl --fail --silent --show-error --head "http://127.0.0.1:${web_port}/downloads/short-op.apk"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "http://127.0.0.1:${web_port}/downloads/short-op.apk")" = "405"
shasum -a 256 "${download_check_dir}/short-op.apk"
```

Expected: `GET` and `HEAD` return `200`, POST returns `405`, response headers include the APK content type and attachment filename, and the downloaded SHA-256 matches the approved value.

- [ ] **Step 5: Commit the documentation**

```bash
git add README.md
git commit -m "docs: publish APK download contract"
```

- [ ] **Step 6: Push the implementation branch**

```bash
git push origin codex/fix-batch-recheck-selection
git status --short --branch
```

Expected: push succeeds and the branch no longer reports commits ahead of `origin/codex/fix-batch-recheck-selection`. This uploads the source/artifact to GitHub but does not by itself prove the production server updated.

- [ ] **Step 7: Verify the production URL without overstating deployment**

```bash
public_check_dir="$(mktemp -d)"
curl --fail --silent --show-error --dump-header "${public_check_dir}/headers.txt" --output "${public_check_dir}/short-op.apk" https://op.tztright.qzz.io/downloads/short-op.apk
shasum -a 256 "${public_check_dir}/short-op.apk"
```

Expected after the production server has pulled and rebuilt this branch: HTTP `200`, attachment headers, and SHA-256 `04b2b747ee36eb9891cc64bff8e135431b2bf39daa8692d4d1f8a0bd8f8c36cd`. If the URL remains `404`, report that source upload is complete but server deployment still requires running `./deploy-opaccout-admin.sh deploy` on the production host with the deployed branch; do not claim the public download is live.
