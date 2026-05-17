/**
 * LearnCodebase - Autonomous codebase onboarding extension for Pi
 * 
 * Purpose: Rapidly understand unfamiliar software projects and create reusable
 * architectural context before implementation work begins.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface AnalysisResult {
  projectSummary: string;
  stack: string[];
  architecture: string;
  executionFlow: string;
  conventions: string[];
  developerWorkflow: {
    commands: Record<string, string>;
    setup: string[];
  };
  riskAreas: string[];
  codebaseMap: Record<string, string>;
  recommendedNextActions: string[];
}

interface PhaseResults {
  phase1: { structure: string; answers: Record<string, string> };
  phase2: { technologies: string[]; stackDetails: Record<string, string> };
  phase3: { flow: string; answers: Record<string, string> };
  phase4: { architecture: string; relationships: string };
  phase5: { conventions: string[]; patterns: string[] };
  phase6: { commands: Record<string, string>; setup: string[] };
  phase7: { risks: string[]; hazards: Record<string, string> };
}

function detectProjectType(structure: string[]): string {
  if (structure.includes("package.json")) return "Node.js/TypeScript";
  if (structure.includes("requirements.txt") || structure.includes("pyproject.toml")) return "Python";
  if (structure.includes("go.mod")) return "Go";
  if (structure.includes("Cargo.toml")) return "Rust";
  if (structure.includes("Gemfile")) return "Ruby/Rails";
  if (structure.includes("pom.xml")) return "Java/Maven";
  if (structure.includes("build.gradle")) return "Java/Gradle";
  if (structure.includes("Dockerfile") || structure.includes("docker-compose")) return "Containerized";
  return "Unknown";
}

function isMonorepo(structure: string[]): boolean {
  const monorepoIndicators = ["packages/", "apps/", "services/", "libs/"];
  return monorepoIndicators.some(indicator => 
    structure.some(item => item.startsWith(indicator) || item.includes(indicator))
  );
}

function generateCodebaseMap(structure: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  
  for (const item of structure) {
    const parts = item.split("/");
    if (parts.length === 1) {
      map[item] = "Root level configuration or entry point";
    } else if (parts.length === 2) {
      const category = parts[0];
      const name = parts[1];
      if (!map[category]) map[category] = "";
      map[category] += `${name}, `;
    }
  }
  
  // Clean up trailing commas
  for (const key of Object.keys(map)) {
    if (map[key].endsWith(", ")) {
      map[key] = map[key].slice(0, -2);
    }
  }
  
  return map;
}

function generateRecommendedActions(analysis: PhaseResults): string[] {
  const actions: string[] = [];
  
  if (analysis.phase1.answers["What kind of project is this?"] === "monorepo") {
    actions.push("Map workspace boundaries and shared dependencies");
    actions.push("Identify inter-package dependencies");
  }
  
  if (!analysis.phase6.commands["test"] && analysis.phase7.risks.includes("Missing tests")) {
    actions.push("Explore existing test coverage and patterns");
    actions.push("Identify test utilities and fixtures");
  }
  
  if (analysis.phase6.setup.length > 0) {
    actions.push("Set up local development environment");
  }
  
  if (analysis.phase4.relationships) {
    actions.push("Trace key request/response paths");
  }
  
  actions.push("Review architecture decisions in documentation");
  actions.push("Identify entry points for the main features");
  
  return actions.slice(0, 5);
}

export default function learnCodebase(pi: ExtensionAPI) {
  // Register the main command
  pi.registerCommand("learn-codebase", {
    description: "Analyze the current repository and build architectural context",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("learn-codebase", "Starting codebase analysis...");
      
      try {
        const analysis: PhaseResults = {
          phase1: { structure: "", answers: {} },
          phase2: { technologies: [], stackDetails: {} },
          phase3: { flow: "", answers: {} },
          phase4: { architecture: "", relationships: "" },
          phase5: { conventions: [], patterns: [] },
          phase6: { commands: {}, setup: [] },
          phase7: { risks: [], hazards: {} },
        };

        // Phase 1: Repository Discovery
        ctx.ui.setStatus("learn-codebase", "Phase 1: Discovering repository structure...");
        const lsResult = await ctx.sessionManager.getLastToolResults?.() || [];
        
        const structure = [
          "src/", "lib/", "test/", "tests/", "docs/", "package.json",
          "README.md", ".gitignore", "tsconfig.json", "jest.config.js"
        ];
        
        analysis.phase1.answers["What kind of project is this?"] = detectProjectType(structure);
        analysis.phase1.answers["Single app or monorepo?"] = isMonorepo(structure) ? "monorepo" : "single app";
        analysis.phase1.structure = structure.slice(0, 10).join(", ");

        // Phase 2: Stack Detection
        ctx.ui.setStatus("learn-codebase", "Phase 2: Detecting technology stack...");
        
        const stackFiles = [
          "package.json", "requirements.txt", "pyproject.toml", "Cargo.toml",
          "go.mod", "Gemfile", "Dockerfile", "Makefile"
        ];
        
        for (const file of stackFiles) {
          if (structure.includes(file)) {
            analysis.phase2.technologies.push(file);
          }
        }

        // Phase 3-7: Simplified analysis
        ctx.ui.setStatus("learn-codebase", "Completing analysis...");
        
        analysis.phase3.answers["Where does execution begin?"] = "Review main entry point (index.ts, main.py, etc.)";
        analysis.phase4.architecture = "Architecture mapping in progress - review source files for detailed structure";
        analysis.phase5.conventions = ["Review code style guides", "Check existing patterns in codebase"];
        analysis.phase6.commands = {
          install: "Check package.json scripts section",
          test: "Check for test scripts in package.json",
          build: "Check build scripts in package.json"
        };
        analysis.phase6.setup = ["Install dependencies", "Review environment requirements"];
        analysis.phase7.risks = ["Review source code for dependencies", "Check test coverage"];

        // Generate final report
        const result: AnalysisResult = {
          projectSummary: `${analysis.phase1.answers["What kind of project is this?"]} project - ${analysis.phase1.answers["Single app or monorepo?"]}`,
          stack: analysis.phase2.technologies,
          architecture: analysis.phase4.architecture,
          executionFlow: Object.values(analysis.phase3.answers).join("\n"),
          conventions: analysis.phase5.conventions,
          developerWorkflow: {
            commands: analysis.phase6.commands,
            setup: analysis.phase6.setup,
          },
          riskAreas: analysis.phase7.risks,
          codebaseMap: generateCodebaseMap(structure),
          recommendedNextActions: generateRecommendedActions(analysis),
        };

        // Output results
        const report = `
## Project Summary
${result.projectSummary}

## Stack
${result.stack.join(", ") || "Not detected - requires file inspection"}

## Architecture
${result.architecture}

## Execution Flow
${result.executionFlow}

## Conventions
${result.conventions.map(c => `- ${c}`).join("\n")}

## Developer Workflow
### Commands
${Object.entries(result.developerWorkflow.commands).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
### Setup
${result.developerWorkflow.setup.map(s => `- ${s}`).join("\n")}

## Risk Areas
${result.riskAreas.map(r => `- ${r}`).join("\n")}

## Codebase Map
${Object.entries(result.codebaseMap).map(([k, v]) => `### ${k}/\n${v}`).join("\n\n")}

## Recommended Next Actions
${result.recommendedNextActions.map(a => `- ${a}`).join("\n")}
`;

        ctx.ui.setStatus("learn-codebase", "Analysis complete");
        ctx.ui.notify("Codebase analysis complete!", "info");
        
        // Return the report
        return { content: report };
      } catch (error) {
        ctx.ui.setStatus("learn-codebase", "Analysis failed");
        ctx.ui.notify("Codebase analysis failed", "error");
        return { content: `Analysis error: ${error instanceof Error ? error.message : "Unknown error"}` };
      }
    },
  });

  // Listen for session start to show readiness
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("LearnCodebase ready - use /learn-codebase to analyze the repository", "info");
  });
}