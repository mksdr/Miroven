import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, "..");

const DANGEROUS_PATTERNS = [
  {
    name: "Retired backend dependency or connection",
    regex: /@supabase\/|NEXT_PUBLIC_SUPABASE_|https?:\/\/[^\s"']*supabase\.(co|net)/i,
    paths: ["app", "public", ".env.example", ".next/static", "out", "package.json", "package-lock.json"],
  },
  {
    name: "Miroven server-only configuration in client code",
    regex: /MIROVEN_(SECRET_KEY|DATABASE_URL|SMTP_PASSWORD|S3_SECRET_KEY)/,
    paths: ["app", "public", ".env.example", ".next/static", "out"],
  },
  {
    name: "Supabase service_role key usage in app code",
    regex: /SUPABASE_SERVICE_ROLE_KEY|service_role/i,
    paths: ["app", "public"],
  },
  {
    name: "Hardcoded Supabase secret token pattern",
    regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.service_role/i,
    paths: ["app", "public", ".env.example", ".next/static"],
  },
  {
    name: "AWS Access Key ID pattern",
    regex: /AKIA[0-9A-Z]{16}/,
    paths: ["app", "public", "scripts", ".next/static"],
  },
  {
    name: "GitHub Personal Access Token pattern",
    regex: /ghp_[a-zA-Z0-9]{36}/,
    paths: ["app", "public", "scripts", ".next/static"],
  },
  {
    name: "Private Key block pattern",
    regex: /-----BEGIN (RSA |EC |PGP )?PRIVATE KEY-----/,
    paths: ["app", "public", "scripts", ".next/static"],
  },
];

let hasError = false;

function scanFile(filePath, regex, ruleName) {
  const fd = fs.openSync(filePath, "r");
  try {
    // Validate and read the same opened file, even if its path is replaced.
    if (!fs.fstatSync(fd).isFile()) {
      throw new Error(`Secret scan target is not a regular file: ${filePath}`);
    }
    const content = fs.readFileSync(fd, "utf-8");
    if (regex.test(content)) {
      console.error(`[SECRET SCAN ERROR] ${ruleName} found in: ${filePath}`);
      hasError = true;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function scanPath(target, regex, ruleName, optional = false) {
  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    // Build outputs may be absent; other I/O errors must fail the scan.
    if (optional && error.code === "ENOENT") return;
    if (error.code !== "ENOTDIR") throw error;
    scanFile(target, regex, ruleName);
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "cache") continue;
      scanPath(fullPath, regex, ruleName);
    } else if (entry.isFile()) {
      // Ignore map files and binary/large cache files
      if (entry.name.endsWith(".map") || entry.name.endsWith(".sst")) continue;
      scanFile(fullPath, regex, ruleName);
    }
  }
}

console.log("🔍 Scanning client bundle and app directory for leaked secrets...");

for (const rule of DANGEROUS_PATTERNS) {
  for (const relPath of rule.paths) {
    const target = path.join(webDir, relPath);
    scanPath(target, rule.regex, rule.name, true);
  }
}

if (hasError) {
  console.error("❌ Secret scan failed! Leaked secret patterns detected.");
  process.exit(1);
} else {
  console.log("✅ Secret scan passed! No client secret leaks detected.");
}
