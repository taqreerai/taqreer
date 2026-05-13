#!/usr/bin/env node
// Boot wrapper for `next dev` that strips the PowerShell harness's empty
// ANTHROPIC_API_KEY export. Without this, the empty string in process.env
// wins over the real value in .env.local (Next.js gives shell env precedence
// at load time), and every server-side call to Anthropic throws.
//
// Strips only when the var is empty / whitespace — a real key in the parent
// environment is left intact.
const key = process.env.ANTHROPIC_API_KEY;
if (key === undefined || key.trim() === "") {
  delete process.env.ANTHROPIC_API_KEY;
}

import { spawn } from "node:child_process";

const child = spawn("next", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
