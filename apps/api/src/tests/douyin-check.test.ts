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

    expect(() => parseDouyinResponse(fixture)).toThrow("DOUYIN_STATUS_UNKNOWN");
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

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("num=94+946");
    expect(result.checkedAt.toISOString()).toBe("2026-07-27T00:00:00.000Z");
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
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
              punish_remind_info: { is_punish: true, ban_type: 99 }
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

    await expect(checkDouyinId("94946893573")).rejects.toBeInstanceOf(
      DouyinCheckError
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
