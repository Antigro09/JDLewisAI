import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/db/schema";
import {
  appendMessage,
  buildActivePath,
  deepestLeaf,
  getSiblings,
} from "@/lib/chat/branches";

const state = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  conversations: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async () => {
  const { createMockDb } = await import("@/tests/mock-db");
  return { db: createMockDb(state) };
});

const CONV = "conv-1";

/** Message fixture; `minute` orders createdAt deterministically. */
function msg(
  id: string,
  parentId: string | null,
  minute: number,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId: CONV,
    parentId,
    role: "user",
    blocks: [{ type: "text", text: id }],
    rawContent: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    ...overrides,
  };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
  state.messages.length = 0;
  state.conversations.length = 0;
});

describe("buildActivePath", () => {
  it("returns [] for an empty conversation with no leaf", async () => {
    expect(await buildActivePath(CONV, null)).toEqual([]);
  });

  it("falls back to chronological order for the conversation when there is no leaf", async () => {
    state.messages.push(
      msg("m2", "m1", 2),
      msg("m1", null, 1),
      msg("other", null, 0, { conversationId: "conv-2" }),
    );
    expect(ids(await buildActivePath(CONV, null))).toEqual(["m1", "m2"]);
  });

  it("walks a linear thread from leaf to root", async () => {
    state.messages.push(msg("m1", null, 1), msg("m2", "m1", 2), msg("m3", "m2", 3));
    expect(ids(await buildActivePath(CONV, "m3"))).toEqual(["m1", "m2", "m3"]);
  });

  it("follows only the active branch past same-parent siblings", async () => {
    // Editing m2a created sibling m2b (same parentId); the active leaf hangs
    // off m2b, so m2a and its subtree are excluded.
    state.messages.push(
      msg("m1", null, 1),
      msg("m2a", "m1", 2),
      msg("m3a", "m2a", 3),
      msg("m2b", "m1", 4),
      msg("m3b", "m2b", 5),
    );
    expect(ids(await buildActivePath(CONV, "m3b"))).toEqual(["m1", "m2b", "m3b"]);
  });

  it("returns [] when the leaf id does not exist", async () => {
    state.messages.push(msg("m1", null, 1));
    expect(await buildActivePath(CONV, "ghost")).toEqual([]);
  });

  it("stops safely at an orphan whose parent row is missing", async () => {
    state.messages.push(msg("m2", "ghost-parent", 2), msg("m3", "m2", 3));
    expect(ids(await buildActivePath(CONV, "m3"))).toEqual(["m2", "m3"]);
  });
});

describe("getSiblings", () => {
  beforeEach(() => {
    state.messages.push(
      msg("root-b", null, 2),
      msg("root-a", null, 1),
      msg("child-b", "root-a", 4),
      msg("child-a", "root-a", 3),
      msg("grandchild", "child-a", 5),
      msg("other-root", null, 0, { conversationId: "conv-2" }),
    );
  });

  it("returns root messages (null parent) of the conversation, oldest first", async () => {
    expect(ids(await getSiblings(CONV, null))).toEqual(["root-a", "root-b"]);
  });

  it("returns same-parent siblings, oldest first, excluding other parents", async () => {
    expect(ids(await getSiblings(CONV, "root-a"))).toEqual(["child-a", "child-b"]);
  });

  it("returns [] for a parent with no children", async () => {
    expect(await getSiblings(CONV, "grandchild")).toEqual([]);
  });
});

describe("deepestLeaf", () => {
  it("returns the message itself when it has no children", async () => {
    state.messages.push(msg("m1", null, 1));
    expect(await deepestLeaf("m1")).toBe("m1");
  });

  it("walks a linear chain to the leaf", async () => {
    state.messages.push(msg("m1", null, 1), msg("m2", "m1", 2), msg("m3", "m2", 3));
    expect(await deepestLeaf("m1")).toBe("m3");
  });

  it("follows the most-recently-created child at each fork, even if another branch is deeper", async () => {
    state.messages.push(
      msg("m1", null, 1),
      msg("m2a", "m1", 2),
      msg("m3a", "m2a", 3),
      msg("m4a", "m3a", 4), // older branch, deeper
      msg("m2b", "m1", 5), // newer branch wins the walk
      msg("m3b", "m2b", 6),
    );
    expect(await deepestLeaf("m1")).toBe("m3b");
  });
});

describe("appendMessage", () => {
  it("parents onto the conversation's active leaf and advances it", async () => {
    state.messages.push(msg("m1", null, 1));
    state.conversations.push({ id: CONV, activeLeafId: "m1" });

    const { id } = await appendMessage({
      conversationId: CONV,
      role: "assistant",
      blocks: [{ type: "text", text: "hi" }],
      model: "test-model",
      inputTokens: 5,
      outputTokens: 7,
    });

    const inserted = state.messages.find((m) => m.id === id);
    expect(inserted).toMatchObject({
      conversationId: CONV,
      parentId: "m1",
      role: "assistant",
      model: "test-model",
      inputTokens: 5,
      outputTokens: 7,
    });
    expect(state.conversations[0].activeLeafId).toBe(id);
  });

  it("inserts a root message when the conversation has no active leaf", async () => {
    state.conversations.push({ id: CONV, activeLeafId: null });

    const { id } = await appendMessage({
      conversationId: CONV,
      role: "user",
      blocks: [{ type: "text", text: "first" }],
    });

    const inserted = state.messages.find((m) => m.id === id);
    expect(inserted?.parentId).toBeNull();
    expect(inserted).toMatchObject({ inputTokens: 0, outputTokens: 0, rawContent: null });
    expect(state.conversations[0].activeLeafId).toBe(id);
  });

  it("honors an explicit parentId override (edit → same-parent sibling)", async () => {
    state.messages.push(msg("m1", null, 1), msg("m2", "m1", 2));
    state.conversations.push({ id: CONV, activeLeafId: "m2" });

    // Editing m2: the replacement is a sibling of m2, i.e. a child of m1.
    const { id } = await appendMessage({
      conversationId: CONV,
      role: "user",
      blocks: [{ type: "text", text: "edited" }],
      parentId: "m1",
    });

    expect(state.messages.find((m) => m.id === id)?.parentId).toBe("m1");
    expect(state.conversations[0].activeLeafId).toBe(id);
  });
});
