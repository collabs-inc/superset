import type { VoiceToolResult } from "@superset/shared/voice";
import type { RealtimeFunctionCallDone, RealtimeServerEvent } from "../events";
import type { RealtimeTransport } from "../transport/RealtimeTransport";

export type SpeechStatus = "listening" | "thinking" | "speaking";

export interface ToolCallRequest {
	callId: string;
	name: string;
	/** Raw JSON from the model, parsed by the executor against the schema. */
	args: unknown;
}

export interface RealtimeClientCallbacks {
	onStatus(status: SpeechStatus): void;
	onUserTranscript(itemId: string, text: string, final: boolean): void;
	onAssistantTranscript(itemId: string, text: string, final: boolean): void;
	onToolCall(call: ToolCallRequest): Promise<VoiceToolResult>;
	onError(message: string): void;
}

/**
 * The conversation loop over a transport: turns events into status and
 * transcript, runs the model's function calls, and hands their outputs back
 * in one response so parallel calls do not spawn parallel replies.
 */
export class RealtimeClient {
	private readonly pendingCalls = new Map<string, Promise<void>[]>();
	private readonly userText = new Map<string, string>();
	private readonly assistantText = new Map<string, string>();
	private unsubscribe: (() => void) | null = null;
	private speaking = false;

	constructor(
		private readonly transport: RealtimeTransport,
		private readonly callbacks: RealtimeClientCallbacks,
	) {}

	start(): void {
		this.unsubscribe?.();
		this.unsubscribe = this.transport.onEvent((event) => this.handle(event));
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/** Something the phone tells the model between turns; never spoken back. */
	addContext(text: string, respond = false): void {
		this.transport.send({
			type: "conversation.item.create",
			item: {
				type: "message",
				role: "system",
				content: [{ type: "input_text", text }],
			},
		});
		if (respond) this.transport.send({ type: "response.create" });
	}

	/** Seeds a fresh session with what was said before the link dropped. */
	seedHistory(
		entries: Array<{ role: "user" | "assistant"; text: string }>,
	): void {
		for (const entry of entries) {
			this.transport.send({
				type: "conversation.item.create",
				item: {
					type: "message",
					role: entry.role,
					content: [{ type: "input_text", text: entry.text }],
				},
			});
		}
	}

	interrupt(): void {
		this.transport.send({ type: "response.cancel" });
		this.transport.send({ type: "output_audio_buffer.clear" });
	}

	handle(event: RealtimeServerEvent): void {
		switch (event.type) {
			case "error":
				this.callbacks.onError(event.error.message);
				return;
			case "input_audio_buffer.speech_started":
				this.speaking = false;
				this.callbacks.onStatus("listening");
				return;
			case "conversation.item.input_audio_transcription.delta": {
				const text = (this.userText.get(event.item_id) ?? "") + event.delta;
				this.userText.set(event.item_id, text);
				this.callbacks.onUserTranscript(event.item_id, text, false);
				return;
			}
			case "conversation.item.input_audio_transcription.completed":
				this.userText.delete(event.item_id);
				this.callbacks.onUserTranscript(event.item_id, event.transcript, true);
				return;
			case "response.created":
				this.pendingCalls.set(event.response.id, []);
				if (!this.speaking) this.callbacks.onStatus("thinking");
				return;
			case "response.output_audio_transcript.delta": {
				const text =
					(this.assistantText.get(event.item_id) ?? "") + event.delta;
				this.assistantText.set(event.item_id, text);
				this.callbacks.onAssistantTranscript(event.item_id, text, false);
				return;
			}
			case "response.output_audio_transcript.done":
				this.assistantText.delete(event.item_id);
				this.callbacks.onAssistantTranscript(
					event.item_id,
					event.transcript,
					true,
				);
				return;
			case "response.function_call_arguments.done":
				this.runToolCall(event);
				return;
			case "response.done":
				this.finishResponse(event.response.id);
				return;
			case "output_audio_buffer.started":
				this.speaking = true;
				this.callbacks.onStatus("speaking");
				return;
			case "output_audio_buffer.stopped":
			case "output_audio_buffer.cleared":
				this.speaking = false;
				this.callbacks.onStatus("listening");
				return;
			default:
				return;
		}
	}

	private runToolCall(event: RealtimeFunctionCallDone): void {
		let args: unknown;
		try {
			args = JSON.parse(event.arguments || "{}");
		} catch {
			args = {};
		}
		const run = this.callbacks
			.onToolCall({ callId: event.call_id, name: event.name, args })
			.catch(
				(error: unknown): VoiceToolResult => ({
					output: { error: error instanceof Error ? error.message : "failed" },
				}),
			)
			.then((result) => {
				this.transport.send({
					type: "conversation.item.create",
					item: {
						type: "function_call_output",
						call_id: event.call_id,
						output: JSON.stringify(result.output),
					},
				});
			});
		const calls = this.pendingCalls.get(event.response_id);
		if (calls) calls.push(run);
		else this.pendingCalls.set(event.response_id, [run]);
	}

	private finishResponse(responseId: string): void {
		const calls = this.pendingCalls.get(responseId);
		this.pendingCalls.delete(responseId);
		if (!calls || calls.length === 0) {
			if (!this.speaking) this.callbacks.onStatus("listening");
			return;
		}
		void Promise.all(calls).then(() => {
			this.transport.send({ type: "response.create" });
		});
	}
}
