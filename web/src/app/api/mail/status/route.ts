import { connection } from "next/server";
import { respond } from "@/lib/api";
import { mailStatus } from "@/lib/repo/mail";

export async function GET() {
  await connection();
  return respond(async () => mailStatus());
}
