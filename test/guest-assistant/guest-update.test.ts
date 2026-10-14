import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL,
  fetchServerBuild,
  GuestUpdateChecker,
  RETRY_DELAY,
  TRIED_TIMEOUT,
} from "../../guest-assistant/src/data/guest-update";

// Guests only get a new frontend through this check: if it breaks, an
// installed app or a wall tablet stays on an old build for good, or reloads
// over and over.

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

describe("GuestUpdateChecker", () => {
  let now: number;
  let serverBuild: string | undefined;
  let fetchBuild: Mock<() => Promise<string | undefined>>;
  let reload: Mock<() => boolean>;
  let timers: { callback: () => void; ms: number }[];
  let storage: ReturnType<typeof memoryStorage>;

  const checker = () =>
    new GuestUpdateChecker({
      currentBuild: "A",
      fetchBuild,
      reload,
      now: () => now,
      storage,
      setTimer: (callback, ms) => timers.push({ callback, ms }),
    });

  beforeEach(() => {
    now = 1_000_000;
    serverBuild = "A";
    fetchBuild = vi.fn<() => Promise<string | undefined>>(
      async () => serverBuild
    );
    reload = vi.fn<() => boolean>(() => true);
    timers = [];
    storage = memoryStorage();
  });

  it("does nothing while the proxy serves the same build", async () => {
    await checker().check(true);
    expect(fetchBuild).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once when the proxy serves another build", async () => {
    serverBuild = "B";
    const updates = checker();
    await updates.check();
    expect(reload).toHaveBeenCalledOnce();
    // The page is on its way out; later triggers leave it alone.
    await updates.check(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when the proxy cannot tell its build", async () => {
    serverBuild = undefined;
    await checker().check(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("skips checks close to the last answer unless forced", async () => {
    const updates = checker();
    await updates.check();
    now += CHECK_INTERVAL - 1;
    await updates.check();
    expect(fetchBuild).toHaveBeenCalledOnce();
    // A (re)connect is when an update arrives, so it always asks.
    await updates.check(true);
    expect(fetchBuild).toHaveBeenCalledTimes(2);
    now += CHECK_INTERVAL;
    await updates.check();
    expect(fetchBuild).toHaveBeenCalledTimes(3);
  });

  // E.g. the app came to the foreground while the proxy was still restarting.
  it("does not count checks without an answer", async () => {
    const updates = checker();
    serverBuild = undefined;
    await updates.check();
    serverBuild = "B";
    await updates.check();
    expect(fetchBuild).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload again for a build that the last reload did not bring", async () => {
    serverBuild = "B";
    await checker().check();
    expect(reload).toHaveBeenCalledOnce();

    // The reloaded page is still build A, e.g. a cache in between kept it.
    await checker().check(true);
    expect(reload).toHaveBeenCalledOnce();

    // A newer build is worth another try,
    serverBuild = "C";
    await checker().check(true);
    expect(reload).toHaveBeenCalledTimes(2);

    // and so is the same one after a while.
    now += TRIED_TIMEOUT;
    await checker().check(true);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("asks once more when the reload was refused", async () => {
    serverBuild = "B";
    reload.mockReturnValue(false);
    const updates = checker();
    await updates.check(true);
    await updates.check(true);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(RETRY_DELAY);

    reload.mockReturnValue(true);
    timers[0].callback();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(3));
  });

  it("works without storage", async () => {
    serverBuild = "B";
    await new GuestUpdateChecker({
      currentBuild: "A",
      fetchBuild,
      reload,
      setTimer: () => undefined,
    }).check();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("fetchServerBuild", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: string) =>
    fetchMock.mockResolvedValue(new Response(body, { status }));

  it("reads the build id, past every cache", async () => {
    answer(200, '{"build":"2026.10.14-abcdef123"}');
    expect(await fetchServerBuild()).toBe("2026.10.14-abcdef123");
    expect(fetchMock).toHaveBeenCalledWith("/build.json", {
      cache: "no-store",
      credentials: "same-origin",
    });
  });

  it.each([
    ["a missing file", 404, "Not Found"],
    ["no JSON", 200, "<html>"],
    ["no build", 200, "{}"],
    ["an empty build", 200, '{"build":""}'],
    ["a build that is no string", 200, '{"build":1}'],
    ["null", 200, "null"],
  ])("cannot tell from %s", async (_name, status, body) => {
    answer(status, body);
    expect(await fetchServerBuild()).toBeUndefined();
  });

  it("cannot tell when the proxy is out of reach", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await fetchServerBuild()).toBeUndefined();
  });
});
