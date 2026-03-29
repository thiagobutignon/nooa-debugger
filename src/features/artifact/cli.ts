import type { Command } from "../../core/command";
import { jsonError, jsonSuccess } from "../../core/errors";
import { createArtifactStore } from "../../kernel/artifacts/store";

const command: Command = {
  name: "artifact",
  async execute({ args, cwd }) {
    const artifacts = createArtifactStore(cwd);
    const action = args[1];

    if (action === "list") {
      const investigationId = args[2];
      const items = await artifacts.list(
        investigationId ? { investigation_id: investigationId } : {},
      );
      return jsonSuccess({ items });
    }

    if (action === "get") {
      const artifactId = args[2];
      if (!artifactId) {
        return jsonError("artifact.not_found", "Missing artifact id", {
          recoverable: true,
        });
      }
      const artifact = await artifacts.get(artifactId);
      if (!artifact) {
        return jsonError("artifact.not_found", "Artifact not found", {
          recoverable: false,
        });
      }
      return jsonSuccess(artifact);
    }

    return jsonError("runtime.unsupported_operation", "Unsupported artifact action", {
      recoverable: false,
    });
  },
};

export default command;
