import fs from "node:fs"; import path from "node:path";
export const applied = () => fs.readFileSync(path.join(import.meta.dirname, ".applied-migrations"), "utf8").split("\n").filter(Boolean);
export const hasMigration = (prefix) => applied().some((f) => f.startsWith(prefix));
