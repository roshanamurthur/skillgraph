import "dotenv/config";
import { runWithSkillAndTools } from "../src/runtime/skill-runner";

const DEFAULT_SKILL_DIR = "skills/think-step-by-step";
const DEFAULT_USER_MESSAGE =
  "I have 15% more revenue this quarter than last quarter. Last quarter was $240,000. What's this quarter's revenue, and what would next quarter need to be to maintain the same growth rate?";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY. Set it in .env or the environment.");
    process.exit(1);
  }

  const skillDir = process.argv[2] ?? DEFAULT_SKILL_DIR;
  const userMessage = process.argv[3] ?? process.env.SKILL_USER_MESSAGE ?? DEFAULT_USER_MESSAGE;

  console.log("Skill directory:", skillDir);
  console.log("User message:", userMessage.slice(0, 80) + (userMessage.length > 80 ? "..." : ""));

  const result = await runWithSkillAndTools(skillDir, userMessage, {
    apiKey,
    model: "o3",
    baseUrl: "https://api.openai.com/v1",
    maxOutputTokens: 4096,
    reasoning: { effort: "medium", summary: "auto" },
  });

  console.log("\n=== MODEL OUTPUT ===");
  console.log(result.content);

  console.log("\n=== TOKEN USAGE ===");
  console.log("Input:", result.tokenUsage.input);
  console.log("Output:", result.tokenUsage.output);
  if (typeof result.tokenUsage.reasoning === "number") {
    console.log("Reasoning:", result.tokenUsage.reasoning);
  }

  console.log("\n=== REASONING LOGS ===");
  if (typeof result.tokenUsage.reasoning === "number") {
    console.log("Reasoning tokens:", result.tokenUsage.reasoning);
  }
  if (result.reasoning) {
    console.log("Reasoning summary:");
    console.log(result.reasoning);
  }
  if (typeof result.tokenUsage.reasoning !== "number" && !result.reasoning) {
    console.log("(No reasoning tokens or summary returned by API)");
  }

  console.log("\n=== VALIDATION ===");
  const checks = [
    {
      name: "content is non-null and length > 0",
      pass: result.content != null && result.content.length > 0,
    },
    {
      name: "tokenUsage.input populated",
      pass: typeof result.tokenUsage.input === "number" && result.tokenUsage.input >= 0,
    },
    {
      name: "tokenUsage.output populated",
      pass: typeof result.tokenUsage.output === "number" && result.tokenUsage.output >= 0,
    },
    ...(typeof result.tokenUsage.reasoning === "number"
      ? [
          {
            name: "tokenUsage.reasoning populated (reasoning model)",
            pass: result.tokenUsage.reasoning >= 0,
          },
        ]
      : []),
  ];

  let allPass = true;
  for (const c of checks) {
    const status = c.pass ? "PASS" : "FAIL";
    if (!c.pass) allPass = false;
    console.log(`${status}: ${c.name}`);
  }
  console.log(allPass ? "\nAll validations passed." : "\nSome validations failed.");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
