import { NextResponse } from "next/server";
import { createRecoveryCodeForUser, getCurrentServerUser } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentServerUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.password) {
    return NextResponse.json({ error: "Enter your password to create a recovery code." }, { status: 400 });
  }

  const result = await createRecoveryCodeForUser(user.id, body.password);
  if (!result.ok || !result.recoveryCode) {
    return NextResponse.json({ error: result.error ?? "Something went wrong." }, { status: 400 });
  }
  return NextResponse.json({ recoveryCode: result.recoveryCode });
}
