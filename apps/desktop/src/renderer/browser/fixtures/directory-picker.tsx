import * as Dialog from "@radix-ui/react-dialog";
import { initI18n } from "@superset/i18n";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { selectCloudDirectory } from "../select-directory";

initI18n("en");

function DirectoryPickerFixture() {
	const [result, setResult] = useState("Pending");
	const pickDirectory = async () => {
		setResult("Pending");
		setResult((await selectCloudDirectory()) ?? "Canceled");
	};
	return (
		<>
			<button type="button" onClick={pickDirectory}>
				Standalone picker
			</button>
			<output aria-label="Picker result">{result}</output>
			<Dialog.Root modal>
				<Dialog.Trigger>New project</Dialog.Trigger>
				<Dialog.Portal>
					<Dialog.Overlay
						style={{ position: "fixed", inset: 0, background: "#0008" }}
					/>
					<Dialog.Content
						style={{
							position: "fixed",
							top: 60,
							left: 60,
							padding: 30,
							background: "white",
						}}
					>
						<Dialog.Title>Create project</Dialog.Title>
						<Dialog.Description>
							Choose a directory for this project.
						</Dialog.Description>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								setResult("Outer form submitted");
							}}
						>
							<button type="button" onClick={pickDirectory}>
								Choose folder
							</button>
							<input aria-label="Project name" />
						</form>
						<Dialog.Close>Close project</Dialog.Close>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}

const root = document.getElementById("fixture");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<DirectoryPickerFixture />);
