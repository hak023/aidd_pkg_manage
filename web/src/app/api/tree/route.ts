import { connection } from "next/server";
import { respond } from "@/lib/api";
import { listTree } from "@/lib/repo/tree";

export async function GET() {
  await connection();
  return respond(async () => ({ nodes: await listTree() }));
}
