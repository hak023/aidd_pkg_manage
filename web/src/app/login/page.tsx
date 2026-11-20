"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";

export default function LoginPage() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: { id, password } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-panel border border-line rounded-xl p-7 shadow-sm">
        <div className="mb-6">
          <div className="text-xs font-semibold tracking-wider text-accent">AX_AIDD</div>
          <h1 className="text-xl font-bold mt-1">개발 산출물 작성 지원</h1>
          <p className="text-muted text-[13px] mt-1">설정된 계정으로 로그인하세요.</p>
        </div>
        <label className="block text-[13px] font-medium mb-1" htmlFor="id">
          아이디
        </label>
        <input
          id="id"
          autoComplete="username"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="w-full border border-line rounded-md px-3 py-2 mb-3 bg-white"
          required
        />
        <label className="block text-[13px] font-medium mb-1" htmlFor="pw">
          비밀번호
        </label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-line rounded-md px-3 py-2 mb-4 bg-white"
          required
        />
        {error && <p className="text-danger text-[13px] mb-3">{error}</p>}
        <button
          disabled={busy}
          className="w-full bg-accent text-white rounded-md py-2 font-semibold disabled:opacity-60"
        >
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
