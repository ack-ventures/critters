import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  formatFailure,
  formatPlanningComplete,
  formatReviewFailure,
  formatReviewMerged,
  formatReviewNeedsChanges,
  formatReviewStarted,
  formatSuccess,
  formatTaskPickedUp,
  formatTimeoutWarning,
  SlackNotifier,
} from "../slack.js";

describe("formatSuccess", () => {
  test("includes identifier, title, and PR URL", () => {
    const msg = formatSuccess("ACK-1", "Add feature", "https://github.com/org/repo/pull/1");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
  });

  test("includes duration when provided", () => {
    const msg = formatSuccess("ACK-1", "Add feature", "https://github.com/org/repo/pull/1", "5m 30s");
    expect(msg).toContain("5m 30s");
  });
});

describe("formatFailure", () => {
  test("includes identifier, title, and error", () => {
    const msg = formatFailure("ACK-1", "Add feature", "timeout");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("timeout");
  });
});

describe("formatReviewMerged", () => {
  test("includes identifier, title, PR URL, and duration", () => {
    const msg = formatReviewMerged("ACK-1", "Add feature", "https://github.com/org/repo/pull/1", "2m 15s");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
    expect(msg).toContain("2m 15s");
    expect(msg).toContain("merged");
  });
});

describe("formatReviewNeedsChanges", () => {
  test("includes identifier, title, and reason", () => {
    const msg = formatReviewNeedsChanges("ACK-1", "Add feature", "Missing tests", "3m");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Missing tests");
    expect(msg).toContain("Needs changes");
  });
});

describe("formatReviewFailure", () => {
  test("includes identifier, title, and error", () => {
    const msg = formatReviewFailure("ACK-1", "Add feature", "Claude crashed", "1m");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Claude crashed");
    expect(msg).toContain("Review failed");
  });
});

describe("formatTaskPickedUp", () => {
  test("includes identifier, title, and repo URL", () => {
    const msg = formatTaskPickedUp("ACK-1", "Add feature", "git@github.com:org/repo.git");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("git@github.com:org/repo.git");
    expect(msg).toContain("Picked up");
  });
});

describe("formatPlanningComplete", () => {
  test("includes identifier and title", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("Planning complete");
    expect(msg).toContain("executing");
  });

  test("includes stats when provided", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature", 12, 1.5);
    expect(msg).toContain("12 turns");
    expect(msg).toContain("$1.50");
  });

  test("omits stats when not provided", () => {
    const msg = formatPlanningComplete("ACK-1", "Add feature");
    expect(msg).not.toContain("turns");
    expect(msg).not.toContain("$");
  });
});

describe("formatReviewStarted", () => {
  test("includes identifier, title, and PR URL", () => {
    const msg = formatReviewStarted("ACK-1", "Add feature", "https://github.com/org/repo/pull/1");
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("https://github.com/org/repo/pull/1");
    expect(msg).toContain("Review started");
  });
});

describe("formatTimeoutWarning", () => {
  test("includes identifier, title, elapsed and timeout minutes", () => {
    const msg = formatTimeoutWarning("ACK-1", "Add feature", 24, 30);
    expect(msg).toContain("ACK-1");
    expect(msg).toContain("Add feature");
    expect(msg).toContain("24/30 minutes");
  });
});

describe("SlackNotifier", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("isConfigured", () => {
    test("returns true when botToken and channel are set", () => {
      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      expect(notifier.isConfigured).toBe(true);
    });

    test("returns true when webhookUrl is set", () => {
      const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/test" });
      expect(notifier.isConfigured).toBe(true);
    });

    test("returns false when nothing is set", () => {
      const notifier = new SlackNotifier({});
      expect(notifier.isConfigured).toBe(false);
    });
  });

  describe("Web API (bot token)", () => {
    test("first call sends without thread_ts and captures ts", async () => {
      const calls: { url: string; body: Record<string, string> }[] = [];
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        calls.push({ url: url as string, body });
        return new Response(JSON.stringify({ ok: true, ts: "1234.5678" }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      await notifier.notify("issue-1", "Hello");

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage");
      expect(calls[0].body.channel).toBe("C123");
      expect(calls[0].body.text).toBe("Hello");
      expect(calls[0].body.thread_ts).toBeUndefined();
    });

    test("subsequent calls include thread_ts", async () => {
      const calls: { body: Record<string, string> }[] = [];
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ body: JSON.parse(init?.body as string) });
        return new Response(JSON.stringify({ ok: true, ts: "1234.5678" }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      await notifier.notify("issue-1", "First");
      await notifier.notify("issue-1", "Second");

      expect(calls).toHaveLength(2);
      expect(calls[0].body.thread_ts).toBeUndefined();
      expect(calls[1].body.thread_ts).toBe("1234.5678");
    });

    test("different issues get separate threads", async () => {
      const calls: { body: Record<string, string> }[] = [];
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        calls.push({ body });
        const ts = body.text === "A1" ? "111.111" : "222.222";
        return new Response(JSON.stringify({ ok: true, ts }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      await notifier.notify("issue-a", "A1");
      await notifier.notify("issue-b", "B1");
      await notifier.notify("issue-a", "A2");
      await notifier.notify("issue-b", "B2");

      expect(calls[0].body.thread_ts).toBeUndefined();
      expect(calls[1].body.thread_ts).toBeUndefined();
      expect(calls[2].body.thread_ts).toBe("111.111");
      expect(calls[3].body.thread_ts).toBe("222.222");
    });

    test("clearThread removes entry so next call creates new top-level message", async () => {
      const calls: { body: Record<string, string> }[] = [];
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ body: JSON.parse(init?.body as string) });
        return new Response(JSON.stringify({ ok: true, ts: "999.999" }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      await notifier.notify("issue-1", "First");
      notifier.clearThread("issue-1");
      await notifier.notify("issue-1", "After clear");

      expect(calls[0].body.thread_ts).toBeUndefined();
      expect(calls[1].body.thread_ts).toBeUndefined();
    });

    test("does not throw when Slack API returns ok: false", async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ ok: false, error: "channel_not_found" }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      // Should not throw
      await notifier.notify("issue-1", "Hello");
    });

    test("does not throw when fetch rejects", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("network error");
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-test", channel: "C123" });
      // Should not throw
      await notifier.notify("issue-1", "Hello");
    });

    test("sends Authorization header with bot token", async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          Object.entries(init?.headers as Record<string, string>),
        );
        return new Response(JSON.stringify({ ok: true, ts: "1234.5678" }));
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ botToken: "xoxb-my-token", channel: "C123" });
      await notifier.notify("issue-1", "Hello");

      expect(capturedHeaders.Authorization).toBe("Bearer xoxb-my-token");
    });
  });

  describe("Webhook fallback", () => {
    test("sends to webhook without thread_ts", async () => {
      const calls: { url: string; body: Record<string, string> }[] = [];
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: url as string, body: JSON.parse(init?.body as string) });
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({ webhookUrl: "https://hooks.slack.com/test" });
      await notifier.notify("issue-1", "Hello");
      await notifier.notify("issue-1", "World");

      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe("https://hooks.slack.com/test");
      expect(calls[0].body).toEqual({ text: "Hello" });
      expect(calls[1].body).toEqual({ text: "World" });
    });
  });

  describe("no config", () => {
    test("notify does nothing when not configured", async () => {
      let fetchCalled = false;
      globalThis.fetch = mock(async () => {
        fetchCalled = true;
        return new Response("ok");
      }) as unknown as typeof fetch;

      const notifier = new SlackNotifier({});
      await notifier.notify("issue-1", "Hello");

      expect(fetchCalled).toBe(false);
    });
  });
});
