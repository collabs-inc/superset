export function selectBrowserImage(): Promise<{
	canceled: boolean;
	dataUrl: string | null;
}> {
	return new Promise((resolve, reject) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".png,.jpg,.jpeg,.webp";
		input.hidden = true;
		const finish = (dataUrl: string | null) => {
			input.remove();
			resolve({ canceled: dataUrl === null, dataUrl });
		};
		input.addEventListener("cancel", () => finish(null), { once: true });
		input.addEventListener(
			"change",
			() => {
				const file = input.files?.[0];
				if (!file) {
					finish(null);
					return;
				}
				const reader = new FileReader();
				reader.onload = () => finish(String(reader.result));
				reader.onerror = () => {
					input.remove();
					reject(reader.error);
				};
				reader.readAsDataURL(file);
			},
			{ once: true },
		);
		document.body.append(input);
		input.click();
	});
}
