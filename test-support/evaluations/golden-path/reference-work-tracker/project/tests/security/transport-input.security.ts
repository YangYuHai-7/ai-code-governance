import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The transport must never read an unvalidated request field directly: each route casts the body to
// a declared DTO first. Reading request.body.<field> is how an attacker-supplied actor or tenant id
// reaches the domain unchecked, which no runtime assertion in the domain can undo.
function transportSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return transportSources(absolute);
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

describe("transport input handling", () => {
  it("never reads an unvalidated request field directly", () => {
    const files = transportSources(
      path.resolve(process.cwd(), "apps/api/src/transport"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/request\.body\./);
      expect(text, file).not.toMatch(/req\.body\./);
    }
  });
});
