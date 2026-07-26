import { describe, expect, it } from "vitest";
import { isSupportedPlatform, resolveStateHome } from "../src/platform/paths.js";

describe("resolveStateHome", () => {
  it("uses the Linux XDG state convention", () => {
    expect(
      resolveStateHome({
        platform: "linux",
        env: { XDG_STATE_HOME: "/var/state/alice" },
        homeDirectory: "/home/alice",
      })
    ).toBe("/var/state/alice/bones");
  });

  it("uses the macOS application support convention", () => {
    expect(
      resolveStateHome({
        platform: "darwin",
        env: {},
        homeDirectory: "/Users/alice",
      })
    ).toBe("/Users/alice/Library/Application Support/Bones");
  });

  it("uses the Windows local application data convention", () => {
    expect(
      resolveStateHome({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
        homeDirectory: "C:\\Users\\alice",
      })
    ).toBe("C:\\Users\\alice\\AppData\\Local\\Bones");
  });

  it("honors the explicit override with native path semantics", () => {
    expect(
      resolveStateHome({
        platform: "win32",
        env: { BONES_STATE_HOME: "D:\\bones-state" },
        homeDirectory: "C:\\Users\\alice",
      })
    ).toBe("D:\\bones-state");
  });
});

describe("isSupportedPlatform", () => {
  it("accepts only the operating systems in the support contract", () => {
    const supported: NodeJS.Platform[] = ["linux", "darwin", "win32"];
    expect(supported.every(isSupportedPlatform)).toBe(true);
    expect(isSupportedPlatform("freebsd")).toBe(false);
  });
});
