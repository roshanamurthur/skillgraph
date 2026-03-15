import { randomUUID } from "crypto";
import type { Skill, SkillFile } from "@/lib/types";
import type { Hypothesis } from "./types";
import { callMasterLLM } from "./xai-client";
import { writeSkill, syncSkillFile } from "@/lib/store/fs-store";

const SYSTEM_PROMPT = `You are a skill editor. You receive an LLM skill (markdown instructions) and a hypothesis describing what needs to change.

Your job is to produce the COMPLETE MODIFIED skill content. You must:
1. Apply the proposed change from the hypothesis
2. Keep everything else in the skill exactly the same
3. Make the change precise and unambiguous so the agent following the skill will produce correct results

You MUST call the submit_variant tool with the complete modified skill text and a short summary of the change.`;

const VARIANT_TOOL = {
  type: "function" as const,
  name: "submit_variant",
  description: "Submit the modified skill content",
  parameters: {
    type: "object" as const,
    properties: {
      modified_skill: {
        type: "string",
        description: "The complete modified skill markdown content",
      },
      change_summary: {
        type: "string",
        description: "A short (1-2 sentence) summary of what was changed",
      },
    },
    required: ["modified_skill", "change_summary"],
  },
};

function buildVariantPrompt(
  skillContent: string,
  hypothesis: Hypothesis,
): string {
  return [
    "# Current Skill Content\n",
    skillContent,
    "\n\n# Hypothesis to Apply\n",
    `**Description:** ${hypothesis.description}`,
    `**Root Cause:** ${hypothesis.rootCause}`,
    `**Proposed Change:** ${hypothesis.proposedChange}`,
    "\n\nProduce the complete modified skill with this change applied. Call the submit_variant tool.",
  ].join("\n");
}

export async function generateVariant(
  parentSkill: Skill,
  hypothesis: Hypothesis,
): Promise<Skill> {
  // Extract current skill content from the .md file
  const mdFile = parentSkill.files.find(
    (f) => f.name.endsWith(".md") || f.name.endsWith(".skill"),
  );
  const skillContent = mdFile?.parsed?.body || mdFile?.content || parentSkill.prompt || "";

  const prompt = buildVariantPrompt(skillContent, hypothesis);

  const response = await callMasterLLM({
    instructions: SYSTEM_PROMPT,
    input: [{ role: "user", content: prompt }],
    tools: [VARIANT_TOOL],
    toolChoice: "required",
    maxOutputTokens: 16384,
  });

  if (!response.toolCalls || response.toolCalls.length === 0) {
    throw new Error("Master LLM did not return variant tool call");
  }

  const args = JSON.parse(response.toolCalls[0].arguments);
  const modifiedSkill = args.modified_skill as string;
  const changeSummary = args.change_summary as string;

  // Create new skill file with modified content
  const newFileId = randomUUID();
  const newFile: SkillFile = {
    id: newFileId,
    name: mdFile?.name || "skill.md",
    type: "skill",
    content: modifiedSkill,
    parsed: {
      frontmatter: mdFile?.parsed?.frontmatter || {},
      body: modifiedSkill,
    },
    addedAt: new Date().toISOString(),
  };

  const newSkill: Skill = {
    id: randomUUID(),
    name: `Hypothesis: ${hypothesis.description.slice(0, 40)}`,
    version: parentSkill.version + 1,
    parentId: parentSkill.id,
    prompt: parentSkill.prompt,
    model: parentSkill.model,
    score: null,
    files: [newFile],
    createdAt: new Date().toISOString(),
    status: "active",
    hypothesisId: hypothesis.id,
    targetCriteria: hypothesis.targetCategory,
    hypothesis: hypothesis.description,
    changeSummary,
  };

  // Persist the new skill
  await writeSkill(newSkill);

  // Sync the .md file to disk for the Python benchmark
  await syncSkillFile(newSkill);

  return newSkill;
}
