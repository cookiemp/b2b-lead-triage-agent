import { createTriagePostHandler } from "@/lib/triage-handler";

export const maxDuration = 30;

// Phase 1 placeholder: Phase 2 wires live Gemini, Supabase, and Langfuse dependencies here.
export const POST = createTriagePostHandler({
  resolveDeps: () => null,
});
