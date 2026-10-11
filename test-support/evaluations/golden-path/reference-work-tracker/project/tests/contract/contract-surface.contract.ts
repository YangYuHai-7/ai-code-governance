import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The contract surface is approved evidence: adding, removing, or renaming an export changes what
// every consumer may depend on, so it is compared against the approved list instead of trusted.
function contractSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return contractSources(absolute);
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

describe("contract surface", () => {
  it("matches the approved export surface", () => {
    const root = process.cwd();
    const approved = JSON.parse(readFileSync(path.join(root, "..", "expected-contracts.json"), "utf8")).surface as string[];
    const extracted = new Set<string>();
    for (const file of contractSources(path.join(root, "packages/contracts/src"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/export\s+(?:interface|type|const|function|class|enum)\s+([A-Za-z0-9_]+)/g)) extracted.add(match[1]);
    }
    const actual = [...extracted].sort();
    expect(actual.filter((name) => !approved.includes(name))).toEqual([]);
    expect(approved.filter((name) => !actual.includes(name))).toEqual([]);
  });
});
