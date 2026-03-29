import type { Command } from "../../core/command";
import { jsonError, jsonSuccess } from "../../core/errors";
import { createInvestigationStore } from "../../kernel/investigations/store";

const command: Command = {
  name: "investigation",
  async execute({ args, cwd }) {
    const investigations = createInvestigationStore(cwd);
    const action = args[1];

    if (action === "create") {
      const record = await investigations.create({});
      return jsonSuccess({ record });
    }

    if (action === "show") {
      const investigationId = args[2];
      if (!investigationId) {
        return jsonError("investigation.not_found", "Missing investigation id", {
          recoverable: true,
        });
      }
      const record = await investigations.get(investigationId);
      if (!record) {
        return jsonError(
          "investigation.not_found",
          "Investigation not found",
          { recoverable: false, investigation_id: investigationId },
        );
      }
      const events = await investigations.listEvents(investigationId);
      return jsonSuccess({ record, events });
    }

    return jsonError(
      "runtime.unsupported_operation",
      "Unsupported investigation action",
      { recoverable: false },
    );
  },
};

export default command;
