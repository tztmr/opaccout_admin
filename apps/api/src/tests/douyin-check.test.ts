import { describe, expect, it, vi } from "vitest";
import bannedFixture from "./fixtures/douyin-banned.json";
import normalFixture from "./fixtures/douyin-normal.json";
import violationFixture from "./fixtures/douyin-violation.json";
import {
  createDouyinChecker,
  parseDouyinProfileOtherResponse,
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

  it("maps ban_type=1 to banned before generic punishment signals", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4w-ban-type-1",
          is_ban: true,
          punish_remind_info: { is_punish: true, ban_type: 1 }
        }
      })
    };

    expect(parseDouyinResponse(fixture).accountStatus).toBe("banned");
  });

  it("maps ban_type=2 to violation", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4w-ban-type-2",
          is_ban: true,
          punish_remind_info: { ban_type: 2 }
        }
      })
    };

    expect(parseDouyinResponse(fixture).accountStatus).toBe("violation");
  });

  it("keeps an undiscriminated is_ban=true response unknown", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: { sec_uid: "MS4w-ambiguous", is_ban: true }
      })
    };

    expect(parseDouyinResponse(fixture).accountStatus).toBe("unknown");
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

  it("maps profile/other 违规处罚说明 + 禁止关注 to violation", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA_0f7F2EYnRaDNHPuWJTWFgv4iMO_C2mG6Xi6R4_f8LPv2mw2_-W_7jz-YnZcuOJW",
          is_ban: false,
          punish_remind_info: {
            is_punish: true,
            ban_type: 2,
            punish_title: "违规处罚说明",
            prompt_bar: {
              content: "该用户被禁止关注"
            },
            punish_content: {
              content: "该用户因违反《抖音社区自律公约》的相关规定被禁止关注"
            }
          }
        }
      })
    };

    expect(parseDouyinResponse(fixture)).toMatchObject({
      secUid: "MS4wLjABAAAA_0f7F2EYnRaDNHPuWJTWFgv4iMO_C2mG6Xi6R4_f8LPv2mw2_-W_7jz-YnZcuOJW",
      accountStatus: "violation"
    });
  });

  it("maps 禁止关注 content alone to violation", () => {
    const fixture = {
      status: 200,
      body: JSON.stringify({
        status_code: 0,
        user_info: {
          sec_uid: "MS4wLjABAAAA-follow-ban-only",
          punish_remind_info: {
            is_punish: true,
            prompt_bar: {
              content: "该用户被禁止关注"
            }
          }
        }
      })
    };

    expect(parseDouyinResponse(fixture).accountStatus).toBe("violation");
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
  it("parses imdesktop profile/other payload with user root", () => {
    const fixture = {
      status_code: 0,
      user: {
        sec_uid: "MS4wLjABAAAA-profile-other",
        is_ban: false,
        punish_remind_info: {
          is_punish: true,
          punish_title: "违规处罚说明",
          prompt_bar: {
            content: "该用户被禁止关注"
          }
        }
      }
    };

    expect(parseDouyinProfileOtherResponse(fixture)).toMatchObject({
      secUid: "MS4wLjABAAAA-profile-other",
      accountStatus: "violation"
    });
    expect(parseDouyinResponse(fixture).accountStatus).toBe("violation");
  });

  it("maps profile/other normal payload without punishment to normal", () => {
    const fixture = {
      status_code: 0,
      user: {
        sec_uid: "MS4wLjABAAAAZ-uVtcuXz-9MSs1WIluzMswY9mrfrgW2P9Fk6MVrUbxMXgzJtEweoBD9fRl0eTRy",
        is_ban: false
      }
    };

    expect(parseDouyinResponse(fixture)).toMatchObject({
      secUid: "MS4wLjABAAAAZ-uVtcuXz-9MSs1WIluzMswY9mrfrgW2P9Fk6MVrUbxMXgzJtEweoBD9fRl0eTRy",
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
      status_code: 0,
      user: {
        sec_uid: "MS4wLjABAAAA-from-num",
        is_ban: true,
        punish_remind_info: {
          is_punish: true,
          punish_title: "账号已被封禁"
        }
      }
    };

    const fetchImpl = vi
      .fn<typeof fetch>()
      // primary path fails with empty body
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
      // fallback: recheck via profile/other
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rechecked), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(checkDouyinId("94946893573")).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-from-num",
      accountStatus: "banned"
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94946893573");
    expect(
      fetchImpl.mock.calls.some((call) =>
        String(call[0]).includes("sec_user_id=MS4wLjABAAAA-from-num")
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

  it("uses imdesktop profile/other when secUid is provided", async () => {
    const profilePayload = {
      status_code: 0,
      user: {
        sec_uid: "MS4wLjABAAAA-existing",
        is_ban: false,
        punish_remind_info: {
          is_punish: true,
          punish_title: "违规处罚说明",
          prompt_bar: { content: "该用户被禁止关注" }
        }
      }
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(profilePayload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const checkDouyinId = createDouyinChecker({
      baseUrl: new URL("https://unid.tztright.top/check"),
      profileUrl: new URL(
        "https://imdesktop.douyin.com/aweme/v1/web/user/profile/other/"
      ),
      fetchImpl,
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(
      checkDouyinId("94946893573", { secUid: "MS4wLjABAAAA-existing" })
    ).resolves.toMatchObject({
      secUid: "MS4wLjABAAAA-existing",
      accountStatus: "violation"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requested = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requested).toContain(
      "https://imdesktop.douyin.com/aweme/v1/web/user/profile/other/"
    );
    expect(requested).toContain("sec_user_id=MS4wLjABAAAA-existing");
    expect(requested).toContain("aid=339757");
    expect(requested).not.toContain("unid.tztright.top/check");
  });

  it("falls back to num check when profile/other fails for existing secUid", async () => {
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
      maxAttempts: 1,
      retryDelayMs: 0
    });

    await expect(
      checkDouyinId("94946893573", { secUid: "MS4wLjABAAAA-existing" })
    ).resolves.toMatchObject({
      accountStatus: "normal",
      secUid: "MS4wLjABAAAA-normal-fixture"
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "sec_user_id=MS4wLjABAAAA-existing"
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("num=94946893573");
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
