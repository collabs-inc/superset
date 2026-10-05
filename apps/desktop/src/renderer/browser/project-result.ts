import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "lib/trpc/routers";

type Projects = inferRouterOutputs<AppRouter>["projects"];

export function asOpenNewResult(
	result: Projects["openFromPath"],
): Projects["openNew"] {
	if (result.canceled || "error" in result) return result;
	if ("needsGitInit" in result)
		return {
			canceled: false,
			multi: true,
			results: [{ status: "needsGitInit", selectedPath: result.selectedPath }],
		};
	return {
		canceled: false,
		multi: true,
		results: [{ status: "success", project: result.project }],
	};
}
