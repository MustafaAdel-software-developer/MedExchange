import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  console.log(`connected`);
  const files = await readdir("migrations", {
    withFileTypes: true,
  }).then((res) => {
    let sorted_names: string[] = [];
    res.map((item) => {
      sorted_names.push(item.name.toString());
    });
    sorted_names.sort();
    return sorted_names;
  });
  const schema_migrations_sql = await readFile(
    `migrations/${files[0]}`,
    "utf8",
  );
  await client.query(schema_migrations_sql);
  for (const file of files) {
    if (file.toString().endsWith(".sql")) {
      await client
        .query("select version from schema_migrations")
        .then(async (res) => {
          if (res.rows.every((row) => row.version !== file)) {
            const sql = await readFile("migrations/" + file, "utf8");
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(
              `INSERT INTO schema_migrations (version,applied_at) VALUES('${file}','${new Date().toISOString()}')`,
            );
            await client.query("COMMIT");
            console.log(`applied script: ${file}`);
          }
        });
    }
  }
} catch (err) {
  if (err instanceof Error) console.log(`An error occured: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
