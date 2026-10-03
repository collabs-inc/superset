import { VoiceAudio } from "@superset/voice";
import {
	type MediaStream,
	type MediaStreamTrack,
	mediaDevices,
	RTCPeerConnection,
	RTCSessionDescription,
} from "react-native-webrtc";
import {
	parseServerEvent,
	type RealtimeClientEvent,
	type RealtimeServerEvent,
} from "../events";
import type {
	AudioLevels,
	RealtimeTransport,
	TransportState,
} from "./RealtimeTransport";

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DATA_CHANNEL = "oai-events";
/** OpenAI answers a complete offer; trickle is not an option, so wait for candidates. */
const ICE_GATHERING_TIMEOUT_MS = 1_500;

type Listener<Value> = (value: Value) => void;

/**
 * WebRTC straight to OpenAI: the mic track goes up, the model's voice comes
 * down and plays through the device, and the protocol rides a data channel.
 */
export class WebRtcTransport implements RealtimeTransport {
	private pc: RTCPeerConnection | null = null;
	private channel: ReturnType<RTCPeerConnection["createDataChannel"]> | null =
		null;
	private localStream: MediaStream | null = null;
	private state: TransportState = "idle";
	private readonly eventListeners = new Set<Listener<RealtimeServerEvent>>();
	private readonly stateListeners = new Set<Listener<TransportState>>();
	private readonly queued: RealtimeClientEvent[] = [];

	async connect({ clientSecret }: { clientSecret: string }): Promise<void> {
		if (this.pc) throw new Error("Transport already connected");
		this.setState("connecting");
		try {
			const pc = new RTCPeerConnection({});
			this.pc = pc;

			pc.onconnectionstatechange = () => {
				switch (pc.connectionState) {
					case "failed":
						this.setState("failed");
						break;
					case "closed":
					case "disconnected":
						if (this.state === "open") this.setState("closed");
						break;
					default:
						break;
				}
			};

			await VoiceAudio.configure();
			const stream = await mediaDevices.getUserMedia({
				audio: true,
				video: false,
			});
			this.localStream = stream;
			for (const track of stream.getTracks()) pc.addTrack(track, stream);

			const channel = pc.createDataChannel(DATA_CHANNEL, { ordered: true });
			this.channel = channel;
			channel.onmessage = (message: unknown) => {
				const event = parseServerEvent(
					String((message as { data?: unknown }).data ?? ""),
				);
				if (!event) return;
				for (const listener of this.eventListeners) listener(event);
			};
			channel.onopen = () => {
				this.setState("open");
				for (const event of this.queued.splice(0)) this.send(event);
			};
			channel.onclose = () => {
				if (this.state !== "failed") this.setState("closed");
			};

			const offer = await pc.createOffer({});
			await pc.setLocalDescription(offer);
			await this.waitForIceGathering(pc);
			const sdp = pc.localDescription?.sdp ?? offer.sdp;

			const response = await fetch(CALLS_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${clientSecret}`,
					"Content-Type": "application/sdp",
				},
				body: sdp,
			});
			if (!response.ok) {
				throw new Error(
					`OpenAI calls ${response.status}: ${(await response.text()).slice(0, 200)}`,
				);
			}
			await pc.setRemoteDescription(
				new RTCSessionDescription({
					type: "answer",
					sdp: await response.text(),
				}),
			);
			// WebRTC's audio unit starts with the answer and moves the route to
			// the receiver; put the call back on the speaker.
			await VoiceAudio.preferSpeaker(true);
		} catch (error) {
			this.teardown();
			this.setState("failed");
			throw error;
		}
	}

	send(event: RealtimeClientEvent): void {
		if (!this.channel || this.channel.readyState !== "open") {
			this.queued.push(event);
			return;
		}
		this.channel.send(JSON.stringify(event));
	}

	onEvent(listener: Listener<RealtimeServerEvent>): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onStateChange(listener: Listener<TransportState>): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	setMuted(muted: boolean): void {
		for (const track of this.audioTracks()) track.enabled = !muted;
	}

	async getLevels(): Promise<AudioLevels> {
		const pc = this.pc;
		if (!pc) return { input: 0, output: 0 };
		const report: unknown = await pc.getStats();
		let input = 0;
		let output = 0;
		const entries =
			report instanceof Map
				? [...report.values()]
				: Object.values((report ?? {}) as Record<string, unknown>);
		for (const stat of entries as Array<Record<string, unknown>>) {
			if (typeof stat.audioLevel !== "number") continue;
			if (stat.type === "media-source" && stat.kind === "audio") {
				input = Math.max(input, stat.audioLevel);
			} else if (stat.type === "inbound-rtp" && stat.kind === "audio") {
				output = Math.max(output, stat.audioLevel);
			}
		}
		return { input: clamp(input), output: clamp(output) };
	}

	close(): void {
		this.teardown();
		if (this.state !== "failed") this.setState("closed");
	}

	private audioTracks(): MediaStreamTrack[] {
		return this.localStream?.getAudioTracks() ?? [];
	}

	private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
		if (pc.iceGatheringState === "complete") return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				pc.onicegatheringstatechange = null;
				resolve();
			};
			const timer = setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
			pc.onicegatheringstatechange = () => {
				if (pc.iceGatheringState === "complete") done();
			};
		});
	}

	private teardown(): void {
		for (const track of this.audioTracks()) track.stop();
		this.localStream = null;
		this.channel?.close();
		this.channel = null;
		this.pc?.close();
		this.pc = null;
		this.queued.length = 0;
		void VoiceAudio.release();
	}

	private setState(state: TransportState): void {
		if (this.state === state) return;
		this.state = state;
		for (const listener of this.stateListeners) listener(state);
	}
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}
