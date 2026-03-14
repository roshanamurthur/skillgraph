import { spawn } from "child_process";
import { resolve } from "path";

const ALLOWED_SCRIPT_DIR = "scripts";
const ALLOWED_EXTENSIONS = new Set([".py", ".sh", ".bash", ".js", ".ts"]);
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run a script from the skill's scripts directory.
 * Only paths under scripts/ are allowed; rejects .. and absolute paths.
 */
export async function runScript(
  skillRoot: string,
  scriptPath: string,
  args?: string,
  options: { timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const normalized = scriptPath.replace(/\\/g, "/").trim();
  if (!normalized.startsWith(ALLOWED_SCRIPT_DIR + "/") || normalized.includes("..")) {
    throw new Error(`Script path must be under ${ALLOWED_SCRIPT_DIR}/ and not contain ..; got: ${scriptPath}`);
  }

  const absPath = resolve(skillRoot, normalized);
  const skillRootResolved = resolve(skillRoot);
  if (!absPath.startsWith(skillRootResolved)) {
    throw new Error(`Resolved script path is outside skill root: ${absPath}`);
  }

  const ext = normalized.includes(".") ? "." + normalized.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported script extension: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let command: string;
  let argv: string[];
  switch (ext) {
    case ".py":
      command = "python3";
      argv = [absPath, ...(args ? args.trim().split(/\s+/) : [])];
      break;
    case ".sh":
    case ".bash":
      command = "bash";
      argv = [absPath, ...(args ? args.trim().split(/\s+/) : [])];
      break;
    case ".js":
      command = "node";
      argv = [absPath, ...(args ? args.trim().split(/\s+/) : [])];
      break;
    case ".ts":
      command = "npx";
      argv = ["tsx", absPath, ...(args ? args.trim().split(/\s+/) : [])];
      break;
    default:
      throw new Error(`No runner for extension: ${ext}`);
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argv, {
      cwd: skillRootResolved,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr,
        exitCode: code != null ? code : signal === "SIGTERM" ? 124 : 1,
      });
    });
  });
}

/**
 * Format run result as a string for the LLM tool result.
 */
export function formatRunResult(result: { stdout: string; stderr: string; exitCode: number }): string {
  const parts = [`exitCode: ${result.exitCode}`];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  return parts.join("\n");
}
