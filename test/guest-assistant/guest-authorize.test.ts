import { describe, expect, it } from "vitest";
import {
  callbackUrl,
  parseAuthorizeParams,
} from "../../guest-assistant/src/data/guest-authorize";

// The authorize page is reachable from any browser and hands out a sign-in
// code: it must only send it to the official companion apps' callback, or a
// crafted link could carry a guest's code to another site.

const query = (params: Record<string, string>) =>
  `?${new URLSearchParams(params).toString()}`;

describe("parseAuthorizeParams", () => {
  it("accepts the official apps and their callback", () => {
    expect(
      parseAuthorizeParams(
        query({
          response_type: "code",
          client_id: "https://home-assistant.io/android",
          redirect_uri: "homeassistant://auth-callback",
        })
      )
    ).toEqual({
      clientId: "https://home-assistant.io/android",
      redirectUri: "homeassistant://auth-callback",
      state: undefined,
    });
    expect(
      parseAuthorizeParams(
        query({
          client_id: "https://home-assistant.io/iOS",
          redirect_uri: "homeassistant://auth-callback",
          state: "abc",
        })
      )?.state
    ).toBe("abc");
  });

  it("refuses other clients, other redirect targets and missing values", () => {
    const cases: Record<string, string>[] = [
      {
        client_id: "https://evil.example",
        redirect_uri: "homeassistant://auth-callback",
      },
      {
        client_id: "https://home-assistant.io/android",
        redirect_uri: "https://evil.example/callback",
      },
      {
        client_id: "https://home-assistant.io/android",
        redirect_uri: "data:text/html,<script>alert(1)</script>",
      },
      { client_id: "https://home-assistant.io/android" },
      {},
      {
        client_id: "https://home-assistant.io/android",
        redirect_uri: "homeassistant://auth-callback",
        state: "x".repeat(513),
      },
    ];
    for (const params of cases) {
      expect(parseAuthorizeParams(query(params))).toBeNull();
    }
  });
});

describe("callbackUrl", () => {
  it("adds the code and, when given, the state, encoded", () => {
    expect(callbackUrl("homeassistant://auth-callback", "c0de")).toBe(
      "homeassistant://auth-callback?code=c0de"
    );
    expect(
      callbackUrl("homeassistant://auth-callback", "c0de", "a b&c=d")
    ).toBe("homeassistant://auth-callback?code=c0de&state=a+b%26c%3Dd");
  });
});
