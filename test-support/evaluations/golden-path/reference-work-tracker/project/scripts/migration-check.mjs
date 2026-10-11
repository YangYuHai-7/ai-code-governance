import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), "migrations");
const files = readdirSync(directory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error("no migrations");
  process.exit(1);
}
for (const file of files) {
  const content = readFileSync(path.join(directory, file), "utf8");
  if (
    !/create table/i.test(content) ||
    !/begin/i.test(content) ||
    !/commit/i.test(content)
  ) {
    console.error(`migration ${file} must create a table inside a transaction`);
    process.exit(1);
  }
}
console.log(`migrations ok: ${files.join(", ")}`);
