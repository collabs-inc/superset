import { expect, test } from "bun:test";
import { asOpenNewResult } from "./project-result";

test("browser folder selection preserves openNew's success and git-init contracts", () => {
	type OpenedProject = Extract<
		Parameters<typeof asOpenNewResult>[0],
		{ project: unknown }
	>["project"];
	const project = { id: "project" } as OpenedProject;
	expect(asOpenNewResult({ canceled: false, project })).toEqual({
		canceled: false,
		multi: true,
		results: [{ status: "success", project }],
	});
	expect(
		asOpenNewResult({
			canceled: false,
			needsGitInit: true,
			selectedPath: "/workspace/new folder",
		}),
	).toEqual({
		canceled: false,
		multi: true,
		results: [
			{ status: "needsGitInit", selectedPath: "/workspace/new folder" },
		],
	});
	expect(asOpenNewResult({ canceled: true })).toEqual({ canceled: true });
	expect(asOpenNewResult({ canceled: false, error: "gone" })).toEqual({
		canceled: false,
		error: "gone",
	});
});
