/**
 * In-memory representation of a loaded Agent Skills–format skill
 * (https://agentskills.io/specification). Used by the skill loader and serializer.
 */
export interface LoadedAgentSkill {
  name: string;
  description: string;
  body: string;
  resources?: Array<{ relativePath: string; content: string }>;
}

export interface LoadOptions {
  includeResources?: boolean;
  includeScripts?: boolean;
  includeReferences?: boolean;
  includeAssets?: boolean;
  maxFileSizeBytes?: number;
  maxTotalResourceBytes?: number;
}

export interface SerializeOptions {
  includeHeader?: boolean;
  includeResources?: boolean;
}
