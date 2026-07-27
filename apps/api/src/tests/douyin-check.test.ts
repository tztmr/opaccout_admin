import { describe, expect, it, vi } from "vitest";
import bannedFixture from "./fixtures/douyin-banned.json";
import normalFixture from "./fixtures/douyin-normal.json";
import violationFixture from "./fixtures/douyin-violation.json";
import {
  createDouyinChecker,
  parseDouyinResponse
} from "../services/douyin-check";

describe("parseDouyinResponse", () => {
  it.each([
    ["normal", normalFixture, "normal"],
    ["banned", bannedFixture, "banned"],
    ["violation", violationFixture, "violation"]
  ] as const)("maps %s payload", (_name, fixture, expected) => {
    expect(parseDouyinResponse(fixture).accountStatus).toBe(expected);
  });

  it("extracts sec_uid from the nested body string", () => {
    expect(parseDouyinResponse(normalFixture).secUid).toBe(
      "MS4wLjABAAAA-normal-fixture"
    );
  });

  it("maps unknown punish_title to violation instead of failing", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-unknown",
          is_ban: true,
          punish_remind_info: { is_punish: true, ban_type: 99 }
        }
      })
    };

    expect(parseDouyinResponse(fixture).accountStatus).toBe("violation");
  });

  it("maps banned status from punish_title without ban_type", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-title-banned",
          punish_remind_info: { punish_title: "账号已被封禁" }
        }
      })
    };

    expect(parseDouyinResponse(fixture)).toMatchObject({
      secUid: "MS4wLjABAAAA-title-banned",
      accountStatus: "banned"
    });
  });

  it("accepts user_info without is_ban when profile is present", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-no-is-ban"
        }
      })
    };

    expect(parseDouyinResponse(fixture)).toMatchObject({
      secUid: "MS4wLjABAAAA-no-is-ban",
      accountStatus: "normal"
    });
  });
});

describe("createDouyinChecker", () => {
  it("uses primary num check only when it succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(normalFixture), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      now: () => new Date("2026-07-27T00:00:00.000Z")
    });

    const result = await checkDouyinId("94 946");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94+946");
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("sec_uid=");
    expect(result.checkedAt.toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(result.accountStatus).toBe("normal");
  });

  it("falls back to sec_uid recheck only after primary num check fails", async () => {
    const emptyBody = { status: 200, body: "" };
    const withSecUid = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-from-num",
          unique_id: "94946893573"
        }
      })
    };
    const rechecked = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-from-num",
          is_ban: true,
          punish_remind_info: {
            is_punish: true,
            ban_type: 1,
            punish_title: "账号已被封禁"
          }
        }
      })
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      // primary path retries and fails with empty body
      .mockResolvedValueOnce(
        new Response(JSON.stringify(emptyBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(emptyBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(emptyBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      // fallback: recover sec_uid via num
      .mockResolvedValueOnce(
        new Response(JSON.stringify(withSecUid), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      // fallback: recheck by sec_uid
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rechecked), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      maxAttempts: 3,
      retryDelayMs: 0
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-from-num",
      accountStatus: "banned"
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94946893573");
    expect(
      fetchImpl.mock.calls.some((call) =>
        String(call[0]).includes("sec_uid=MS4wLjABAAAA-from-num")
      )
    ).toBe(true);
  });

  it("keeps recovered num result when sec_uid recheck fails in fallback", async () => {
    const emptyBody = { status: 200, body: "" };
    const withSecUid = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-keep-first",
          is_ban: false
        }
      })
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      // primary fails
      .mockResolvedValueOnce(
        new Response(JSON.stringify(emptyBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      // fallback recovers sec_uid via num
      .mockResolvedValueOnce(
        new Response(JSON.stringify(withSecUid), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      // sec_uid recheck fails
      .mockResolvedValueOnce(new Response("upstream error", { status: 503 }));

    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-keep-first",
      accountStatus: "normal"
    });
  });

  it("retries one HTTP 5xx response on primary path", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream error", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(normalFixture), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      retryDelayMs: 0
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      accountStatus: "normal"
    });
    // primary succeeds after retry, so no sec_uid fallback
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("num=");
  });

  it("maps non-standard punishment title to violation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: 200,
          body: JSON.stringify({
            status_code: 0,
            user_info: {
              sec_uid: "MS4wLjABAAAA-unknown",
              is_ban: true,
              punish_remind_info: {
                is_punish: true,
                ban_type: 99,
                punish_title: "其他处罚"
              }
            }
          })
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      accountStatus: "violation"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
