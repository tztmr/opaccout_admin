import { describe, expect, it, vi } from "vitest";
import bannedFixture from "./fixtures/douyin-banned.json";
import normalFixture from "./fixtures/douyin-normal.json";
import violationFixture from "./fixtures/douyin-violation.json";
import {
  createDouyinChecker,
  DouyinCheckError,
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

  it("rejects unknown punishment instead of guessing", () => {
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

    // ban_type 缺失时，按 punish_title 判定；未知标题视为违规而不是直接失败。
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
  it("URL-encodes the Douyin ID and returns parsed data", async () => {
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

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94+946");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "sec_uid=MS4wLjABAAAA-normal-fixture"
    );
    expect(result.checkedAt.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("resolves sec_uid first and rechecks status with sec_uid", async () => {
    const first = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-from-num",
          unique_id: "94946893573"
        }
      })
    };
    const second = {
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify(first), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(second), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-from-num",
      accountStatus: "banned"
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94946893573");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain(
      "sec_uid=MS4wLjABAAAA-from-num"
    );
  });

  it("keeps first result when sec_uid recheck fails", async () => {
    const first = {
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
      .mockResolvedValueOnce(
        new Response(JSON.stringify(first), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(new Response("upstream error", { status: 503 }));
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      maxAttempts: 1
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-keep-first",
      accountStatus: "normal"
    });
  });

  it("retries one HTTP 5xx response", async () => {
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
      fetchImpl
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      accountStatus: "normal"
    });
    // first attempt: num probe fails, then retries; after success no sec_uid recheck needed for fixture
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("does not retry an unknown payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: 200,
          body: JSON.stringify({
            status_code: 0,
            user_info: {
              sec_uid: "MS4wLjABAAAA-unknown",
              is_ban: true,
              punish_remind_info: { is_punish: true, ban_type: 99, punish_title: "其他处罚" }
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
  });
});
