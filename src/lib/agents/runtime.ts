import "server-only";

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AgentProvider = "codex" | "claude";
export type AgentRunMode = "plan" | "execute";

export interface AgentRuntimeStatus {
  provider: AgentProvider;
  label: string;
  executable: string;
  installed: boolean;
  version?: string;
}

export interface AgentTaskRequest {
  provider: AgentProvider;
  prompt: string;
  workspace: string;
  mode: AgentRunMode;
  approvedForExecution: boolean;
}

const runtimes = {
  codex: {
    label: "Codex CLI",
    executable: "/Users/BR/.local/bin/codex",
  },
  claude: {
    label: "Claude Code",
    executable: "/Users/BR/.local/bin/claude",
  },
} as const;

export async function getAgentRuntimeStatuses(): Promise<AgentRuntimeStatus[]> {
  return Promise.all(
    (Object.keys(runtimes) as AgentProvider[]).map(async (provider) => {
      const runtime = runtimes[provider];
      try {
        await access(runtime.executable);
        const { stdout } = await execFileAsync(runtime.executable, ["--version"], {
          timeout: 5_000,
          maxBuffer: 64 * 1024,
        });
        return {
          provider,
          label: runtime.label,
          executable: runtime.executable,
          installed: true,
          version: stdout.trim(),
        };
      } catch {
        return {
          provider,
          label: runtime.label,
          executable: runtime.executable,
          installed: false,
        };
      }
    }),
  );
}

export async function runAgentTask(request: AgentTaskRequest) {
  if (request.mode === "execute" && !request.approvedForExecution) {
    throw new Error("An execute-mode task requires explicit human approval.");
  }

  const runtime = runtimes[request.provider];
  await access(runtime.executable);

  const args =
    request.provider === "codex"
      ? [
          "exec",
          "--json",
          "--ephemeral",
          "--sandbox",
          request.mode === "execute" ? "workspace-write" : "read-only",
          "-C",
          request.workspace,
          request.prompt,
        ]
      : [
          "-p",
          "--output-format",
          "stream-json",
          "--no-session-persistence",
          "--permission-mode",
          request.mode === "execute" ? "acceptEdits" : "plan",
          request.prompt,
        ];

  const { stdout, stderr } = await execFileAsync(runtime.executable, args, {
    cwd: request.workspace,
    timeout: 15 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });

  return { stdout, stderr };
}
