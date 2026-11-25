import { describe, expect, it } from "vitest";
import { createDemoRunNonce, DEMO_LEAD_PRESETS } from "@/lib/presets";
import { InboundLeadSchema } from "@/lib/schemas";
import { scanForPromptInjection } from "@/lib/security";

describe("DEMO_LEAD_PRESETS", () => {
  it("contains 4 presets that all pass InboundLeadSchema with generated nonces", () => {
    expect(DEMO_LEAD_PRESETS).toHaveLength(4);

    for (const preset of DEMO_LEAD_PRESETS) {
      const parsed = InboundLeadSchema.safeParse({
        ...preset.values,
        source: "web_demo",
        idempotency_nonce: createDemoRunNonce(preset.id),
      });
      expect(parsed.success, `preset ${preset.id} failed schema validation`).toBe(
        true,
      );
    }
  });

  it("ensures only the prompt_injection preset triggers the prompt-injection tripwire", () => {
    for (const preset of DEMO_LEAD_PRESETS) {
      const scan = scanForPromptInjection(
        `${preset.values.name}\n${preset.values.message}`,
      );
      if (preset.id === "prompt_injection") {
        expect(scan.detected).toBe(true);
      } else {
        expect(scan.detected, `unexpected tripwire on ${preset.id}`).toBe(false);
      }
    }
  });
});
