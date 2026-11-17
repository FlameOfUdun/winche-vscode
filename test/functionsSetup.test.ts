import { describe, expect, test } from "vitest";
import { denoCovers, functionsFolder, relativeTo, withFolder } from "../src/functionsSetup";

describe("functions in the editor", () => {
  test("the functions folder comes from winche.json", () => {
    expect(functionsFolder('{ "rules": {}, "functions": "functions" }')).toBe("functions");
    expect(functionsFolder('{ "functions": "backend/functions/" }')).toBe("backend/functions");
    expect(functionsFolder('{ "rules": {} }')).toBeNull();
    expect(functionsFolder("not json")).toBeNull();
  });

  test("paths are relative to the workspace folder", () => {
    expect(relativeTo("/repo", "/repo/functions")).toBe("functions");
    expect(relativeTo("/repo/", "/repo/api/functions")).toBe("api/functions");
    expect(relativeTo("/repo", "/repo")).toBe(".");
    expect(relativeTo("/repo", "/other/functions")).toBeNull();
  });

  test("Deno covers the folder when it's on everywhere, or the folder or one above it is enabled", () => {
    expect(denoCovers("functions", undefined, undefined)).toBe(false);
    expect(denoCovers("functions", true, undefined)).toBe(true);
    expect(denoCovers("functions", true, ["web"])).toBe(false);   // enablePaths narrows deno.enable
    expect(denoCovers("functions", undefined, ["functions"])).toBe(true);
    expect(denoCovers("api/functions", undefined, ["api"])).toBe(true);
    expect(denoCovers("functions", undefined, ["./functions/"])).toBe(true);
    expect(withFolder(["web"], "functions")).toEqual(["web", "functions"]);
    expect(withFolder(["functions"], "functions")).toEqual(["functions"]);
  });
});
