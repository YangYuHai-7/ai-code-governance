const required = ["DATABASE_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`missing environment: ${missing.join(", ")}`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3000);
console.log(`reference work tracker listening on http://127.0.0.1:${port}`);
