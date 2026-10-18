import fs from "node:fs";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../Miroven-API/contracts/api.d.ts", import.meta.url));
const destination = fileURLToPath(new URL("../app/lib/remote/api.types.ts", import.meta.url));
if (!fs.existsSync(source)) throw new Error("Place Miroven-API beside Miroven and generate its contracts first.");
const contract = fs.readFileSync(source, "utf8");
if (process.argv.includes("--check")) {
  if (fs.readFileSync(destination, "utf8") !== contract) throw new Error("API types are stale. Run npm run api:generate.");
  console.log("API types match Miroven-API.");
} else {
  fs.writeFileSync(destination, contract);
  console.log("Updated API types from Miroven-API.");
}
