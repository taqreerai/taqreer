import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, jobId } = await params;
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      projectId: id,
      project: { user: { supabaseUserId: user.id } },
    },
    select: {
      id: true,
      status: true,
      type: true,
      outputJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const output = job.outputJson as { signedUrl?: string; error?: string } | null;
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    type: job.type,
    signedUrl: output?.signedUrl ?? null,
    error: output?.error ?? null,
    updatedAt: job.updatedAt,
  });
}
