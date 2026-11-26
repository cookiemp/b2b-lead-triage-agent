import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_HUBSPOT_TIMEOUT_MS,
  HUBSPOT_API_BASE_URL,
  HUBSPOT_CUSTOM_PROPERTIES,
} from "../src/lib/hubspot";

function loadEnvFile(filename: string): void {
  const filePath = path.resolve(process.cwd(), filename);
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");

  const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("HUBSPOT_ACCESS_TOKEN is not set in environment or .env.local.");
    process.exit(1);
  }

  for (const prop of HUBSPOT_CUSTOM_PROPERTIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_HUBSPOT_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${HUBSPOT_API_BASE_URL}/crm/v3/properties/contacts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(prop),
          signal: controller.signal,
        },
      );

      if (response.status === 201 || response.status === 200) {
        console.log(`[created] contact property '${prop.name}' (${prop.type})`);
      } else if (response.status === 409) {
        console.log(`[exists]  contact property '${prop.name}' already exists`);
      } else {
        const body = await response.text();
        console.error(
          `[error]   contact property '${prop.name}' failed with HTTP ${response.status}: ${body}`,
        );
        process.exit(1);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  console.log("HubSpot custom contact properties are ready.");
}

main().catch((err: unknown) => {
  console.error("setup-hubspot-properties failed:", err);
  process.exit(1);
});
