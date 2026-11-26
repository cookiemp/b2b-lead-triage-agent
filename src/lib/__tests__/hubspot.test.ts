import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID,
  syncLeadToHubSpot,
} from "@/lib/hubspot";
import type { LeadRecord, LeadStatus } from "@/lib/schemas";

function makeLead(
  overrides: Partial<LeadRecord> & { status?: LeadStatus } = {},
): LeadRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    idempotency_key: "b".repeat(64),
    name: "Elena Rostova",
    email: "elena.rostova@linear.app",
    company_url: "https://linear.app",
    message: "Looking for an enterprise demo for 85 AEs.",
    enriched_summary: "Linear builds issue tracking software for product teams.",
    enrichment_ok: true,
    prompt_injection_detected: false,
    triage_json: {
      intent: "Enterprise demo request",
      urgency: "high",
      company_size_estimate: "100-250",
      icp_score: 94,
      suggested_route: "sales_enterprise",
      confidence_score: 0.95,
      reasoning: "Strong ICP fit.",
      draft_reply: "Hi Elena, happy to schedule a walkthrough this week.",
    },
    icp_score: 94,
    confidence_score: 0.95,
    draft_reply: "Hi Elena, happy to schedule a walkthrough this week.",
    status: "auto_routed",
    source: "web_demo",
    langfuse_trace_id: "0123456789abcdef0123456789abcdef",
    hubspot_contact_id: null,
    hubspot_sync_status: null,
    hubspot_synced_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("syncLeadToHubSpot", () => {
  it("skips cleanly with structured warning when HUBSPOT_ACCESS_TOKEN is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn<typeof fetch>();

    const outcome = await syncLeadToHubSpot(makeLead(), {
      accessToken: null,
      fetchFn,
    });

    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.reason).toBe("token_missing");
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("skips spam/rejected/review leads and already-synced leads", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    const spamOutcome = await syncLeadToHubSpot(
      makeLead({ status: "auto_rejected" }),
      { accessToken: "pat-test-token", fetchFn },
    );
    expect(spamOutcome.status).toBe("skipped");
    if (spamOutcome.status === "skipped") {
      expect(spamOutcome.reason).toBe("ineligible_status");
    }

    const alreadySynced = await syncLeadToHubSpot(
      makeLead({ status: "approved", hubspot_sync_status: "synced" }),
      { accessToken: "pat-test-token", fetchFn },
    );
    expect(alreadySynced.status).toBe("skipped");
    if (alreadySynced.status === "skipped") {
      expect(alreadySynced.reason).toBe("already_synced");
    }

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("upserts contact idempotently by email and attaches associated HTML Note (type 202)", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: "9012345" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "note_7788" }), { status: 201 }),
      );

    const lead = makeLead({ status: "approved" });
    const outcome = await syncLeadToHubSpot(lead, {
      accessToken: "pat-secret-key",
      fetchFn,
    });

    expect(outcome.status).toBe("synced");
    if (outcome.status === "synced") {
      expect(outcome.contactId).toBe("9012345");
      expect(outcome.noteId).toBe("note_7788");
    }

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [upsertUrl, upsertInit] = fetchFn.mock.calls[0] ?? [];
    expect(upsertUrl).toBe(
      "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert",
    );
    expect((upsertInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer pat-secret-key",
    );
    const upsertBody = JSON.parse(String(upsertInit?.body)) as {
      inputs: Array<{
        idProperty: string;
        id: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(upsertBody.inputs[0]?.idProperty).toBe("email");
    expect(upsertBody.inputs[0]?.id).toBe("elena.rostova@linear.app");
    expect(upsertBody.inputs[0]?.properties.firstname).toBe("Elena");
    expect(upsertBody.inputs[0]?.properties.lastname).toBe("Rostova");
    expect(upsertBody.inputs[0]?.properties.icp_score).toBe(94);
    expect(upsertBody.inputs[0]?.properties.triage_route).toBe(
      "sales_enterprise",
    );

    const [noteUrl, noteInit] = fetchFn.mock.calls[1] ?? [];
    expect(noteUrl).toBe("https://api.hubapi.com/crm/v3/objects/notes");
    const noteBody = JSON.parse(String(noteInit?.body)) as {
      properties: { hs_timestamp: string; hs_note_body: string };
      associations: Array<{
        to: { id: string };
        types: Array<{ associationCategory: string; associationTypeId: number }>;
      }>;
    };
    expect(noteBody.properties.hs_note_body).toContain("94/100");
    expect(noteBody.properties.hs_note_body).toContain("happy to schedule");
    expect(noteBody.associations[0]?.to.id).toBe("9012345");
    expect(noteBody.associations[0]?.types[0]).toEqual({
      associationCategory: "HUBSPOT_DEFINED",
      associationTypeId: HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID,
    });
  });

  it("handles HubSpot 429 and 500 errors gracefully without throwing", async () => {
    const rateLimitedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Rate limit exceeded", { status: 429 }));

    const rateLimitedOutcome = await syncLeadToHubSpot(makeLead(), {
      accessToken: "pat-secret-key",
      fetchFn: rateLimitedFetch,
    });
    expect(rateLimitedOutcome.status).toBe("failed");
    if (rateLimitedOutcome.status === "failed") {
      expect(rateLimitedOutcome.reason).toBe("http_error");
      expect(rateLimitedOutcome.httpStatus).toBe(429);
    }

    const noteErrorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [{ id: "9012345" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response("Server error", { status: 500 }));

    const noteErrorOutcome = await syncLeadToHubSpot(makeLead(), {
      accessToken: "pat-secret-key",
      fetchFn: noteErrorFetch,
    });
    expect(noteErrorOutcome.status).toBe("failed");
    if (noteErrorOutcome.status === "failed") {
      expect(noteErrorOutcome.reason).toBe("http_error");
      expect(noteErrorOutcome.httpStatus).toBe(500);
      expect(noteErrorOutcome.contactId).toBe("9012345");
    }
  });
});
