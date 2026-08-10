import { NextResponse } from "next/server";
import { getAgentRuntimeStatuses } from "@/lib/agents/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    runtimes: await getAgentRuntimeStatuses(),
    executionPolicy: "human_approval_required",
  });
}
