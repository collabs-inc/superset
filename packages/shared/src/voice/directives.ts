/**
 * What a tool result asks the phone to show. Applied by the device after the
 * tool's output is handed back to the model, and only honoured for ambient
 * navigation when follow mode is on; `show` always navigates.
 */
export type VoiceNavigateTarget =
	| { screen: "home" }
	| { screen: "workspace"; workspaceId: string; terminalId?: string }
	| { screen: "sessions"; workspaceId: string }
	| { screen: "pull_requests"; workspaceId: string }
	| { screen: "page"; slug: string };

export interface VoiceUiDirective {
	navigate?: VoiceNavigateTarget;
	/** Rows the model is talking about; the screen may highlight them briefly. */
	highlightWorkspaceIds?: string[];
}
