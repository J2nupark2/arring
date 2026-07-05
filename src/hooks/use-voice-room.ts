"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type SignalPayload = {
  from: string;
  to: string;
} & (
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit }
);

type MuteStatePayload = { userId: string; muted: boolean };

type KickPayload = { targetId: string; from: string };

type HostChangePayload = { newHostId: string; from: string };

type PresenceState = { userId: string; nickname: string };

export type Participant = {
  id: string;
  nickname: string;
  isSelf: boolean;
  muted: boolean;
};

// Google's public STUN server plus Open Relay Project's free demo TURN
// server. Fine for a personal-project MVP; swap for a paid/self-hosted TURN
// if usage grows (see plan's Phase 1 risk notes).
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export function useVoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
  initialHostId,
  onKicked,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  initialHostId: string;
  onKicked?: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [micGain, setMicGainState] = useState(1);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [hostId, setHostId] = useState(initialHostId);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const otherPeerIdsRef = useRef<Set<string>>(new Set());
  const volumesRef = useRef<Record<string, number>>({});
  const analysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const hostIdRef = useRef(initialHostId);
  const joinedRef = useRef(false);
  const onKickedRef = useRef(onKicked);
  onKickedRef.current = onKicked;

  const applyHostChange = useCallback((newHostId: string) => {
    hostIdRef.current = newHostId;
    setHostId(newHostId);
  }, []);

  const upsertParticipant = useCallback((p: Participant) => {
    setParticipants((prev) => {
      const others = prev.filter((x) => x.id !== p.id);
      return [...others, p].sort((a, b) =>
        a.nickname.localeCompare(b.nickname),
      );
    });
  }, []);

  const removeParticipant = useCallback((id: string) => {
    setParticipants((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const closePeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
    analysersRef.current.delete(peerId);

    const audioEl = audioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElsRef.current.delete(peerId);
    }
  }, []);

  // Feed a stream into an AnalyserNode so the UI can highlight who is
  // actually talking. Muted tracks output silence, so mute is reflected.
  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    const ctx = audioCtxRef.current;
    if (!ctx || analysersRef.current.has(id)) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analysersRef.current.set(id, analyser);
    } catch {
      // Analyser is a nice-to-have; ignore failures.
    }
  }, []);

  const send = useCallback((payload: SignalPayload) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  const ensurePeer = useCallback(
    (peerId: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, pc);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            kind: "ice-candidate",
            from: userId,
            to: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        let audioEl = audioElsRef.current.get(peerId);
        if (!audioEl) {
          audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          audioEl.volume = volumesRef.current[peerId] ?? 1;
          audioContainerRef.current?.appendChild(audioEl);
          audioElsRef.current.set(peerId, audioEl);
        }
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(() => {});
        attachAnalyser(peerId, event.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [send, userId, closePeer, attachAnalyser],
  );

  useEffect(() => {
    audioContainerRef.current = document.createElement("div");
    audioContainerRef.current.style.display = "none";
    document.body.appendChild(audioContainerRef.current);

    let cancelled = false;
    const supabase = supabaseRef.current;

    async function setup() {
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cancelled) {
          rawStream.getTracks().forEach((t) => t.stop());
          return;
        }

        // Route the mic through a GainNode so its level can be adjusted
        // live; peers receive the gain-processed stream.
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(rawStream);
        const gainNode = audioCtx.createGain();
        const destination = audioCtx.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(destination);
        audioCtx.resume().catch(() => {});

        rawStreamRef.current = rawStream;
        audioCtxRef.current = audioCtx;
        gainNodeRef.current = gainNode;
        localStreamRef.current = destination.stream;
        attachAnalyser(userId, destination.stream);
      } catch {
        setStatus("error");
        return;
      }

      upsertParticipant({ id: userId, nickname, isSelf: true, muted: false });

      const channel = supabase.channel(`room:${roomCode}`, {
        config: { presence: { key: userId } },
      });
      channelRef.current = channel;

      channel.on(
        "broadcast",
        { event: "signal" },
        async ({ payload }: { payload: SignalPayload }) => {
          if (payload.to !== userId) return;

          if (payload.kind === "offer") {
            const pc = ensurePeer(payload.from);
            await pc.setRemoteDescription(payload.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ kind: "answer", from: userId, to: payload.from, sdp: answer });
          } else if (payload.kind === "answer") {
            await peersRef.current.get(payload.from)?.setRemoteDescription(payload.sdp);
          } else if (payload.kind === "ice-candidate") {
            try {
              await peersRef.current.get(payload.from)?.addIceCandidate(payload.candidate);
            } catch {
              // Candidate arrived after the connection closed — safe to ignore.
            }
          }
        },
      );

      channel.on(
        "broadcast",
        { event: "mute-state" },
        ({ payload }: { payload: MuteStatePayload }) => {
          setParticipants((prev) =>
            prev.map((p) =>
              p.id === payload.userId ? { ...p, muted: payload.muted } : p,
            ),
          );
        },
      );

      channel.on(
        "broadcast",
        { event: "host-change" },
        ({ payload }: { payload: HostChangePayload }) => {
          if (payload.from !== hostIdRef.current) return;
          applyHostChange(payload.newHostId);
        },
      );

      channel.on(
        "broadcast",
        { event: "kick" },
        ({ payload }: { payload: KickPayload }) => {
          if (payload.from !== hostIdRef.current) return;
          if (payload.targetId === userId) {
            onKickedRef.current?.();
          }
        },
      );

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();

        for (const [peerId, presences] of Object.entries(state)) {
          if (peerId === userId) continue;
          const presence = presences[0];
          if (!presence) continue;

          otherPeerIdsRef.current.add(peerId);

          upsertParticipant({
            id: peerId,
            nickname: presence.nickname,
            isSelf: false,
            muted: false,
          });

          // Deterministic glare avoidance: only the "greater" id initiates.
          if (peerId > userId && !peersRef.current.has(peerId)) {
            const pc = ensurePeer(peerId);
            pc.createOffer()
              .then(async (offer) => {
                await pc.setLocalDescription(offer);
                send({ kind: "offer", from: userId, to: peerId, sdp: offer });
              })
              .catch(() => {});
          }
        }
      });

      channel.on("presence", { event: "leave" }, ({ key }: { key: string }) => {
        otherPeerIdsRef.current.delete(key);
        closePeer(key);
        removeParticipant(key);

        // The host left (gracefully or by closing the tab). Every remaining
        // client deterministically picks the same successor — the smallest
        // user id — and only the successor writes it to the DB, so no
        // coordination is needed.
        if (key === hostIdRef.current) {
          const candidates = [userId, ...otherPeerIdsRef.current].sort();
          const newHost = candidates[0];
          applyHostChange(newHost);
          if (newHost === userId) {
            supabase
              .from("rooms")
              .update({ host_id: userId })
              .eq("id", roomId)
              .then(() => {});
          }
        }
      });

      channel.subscribe(async (subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          joinedRef.current = true;
          await channel.track({ userId, nickname } satisfies PresenceState);
          const { error: participantError } = await supabase
            .from("room_participants")
            .insert({ room_id: roomId, user_id: userId });
          if (participantError) {
            console.error("room_participants insert failed:", participantError);
          }
          supabase.rpc("set_current_room", { p_room_code: roomCode }).then(() => {});
          setStatus("connected");
        }
      });
    }

    setup();

    // Poll analysers for voice activity (RMS over the time-domain signal).
    const levelBuffer = new Uint8Array(512);
    const speakingInterval = setInterval(() => {
      const next: Record<string, boolean> = {};
      analysersRef.current.forEach((analyser, id) => {
        analyser.getByteTimeDomainData(levelBuffer);
        let sum = 0;
        for (let i = 0; i < levelBuffer.length; i++) {
          const v = (levelBuffer[i] - 128) / 128;
          sum += v * v;
        }
        next[id] = Math.sqrt(sum / levelBuffer.length) > 0.04;
      });
      setSpeaking((prev) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        const changed =
          prevKeys.length !== nextKeys.length ||
          nextKeys.some((k) => prev[k] !== next[k]);
        return changed ? next : prev;
      });
    }, 180);

    return () => {
      cancelled = true;
      clearInterval(speakingInterval);
      analysersRef.current.clear();
      channelRef.current?.unsubscribe();
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      audioElsRef.current.forEach((el) => el.remove());
      audioElsRef.current.clear();
      audioContainerRef.current?.remove();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});

      supabase
        .from("room_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .is("left_at", null)
        .then(() => {});
      supabase.rpc("set_current_room", { p_room_code: null }).then(() => {});

      // Leaving an empty room closes it. joinedRef guards against React
      // Strict Mode's dev-only mount/cleanup/mount dry run, where cleanup
      // fires before the channel ever subscribed.
      if (joinedRef.current && otherPeerIdsRef.current.size === 0) {
        supabase
          .from("rooms")
          .update({ status: "ended" })
          .eq("id", roomId)
          .then(() => {});
      }
      joinedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, roomId, userId, nickname]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStreamRef.current
        ?.getAudioTracks()
        .forEach((t) => (t.enabled = !next));
      channelRef.current?.send({
        type: "broadcast",
        event: "mute-state",
        payload: { userId, muted: next } satisfies MuteStatePayload,
      });
      setParticipants((participantsPrev) =>
        participantsPrev.map((p) =>
          p.id === userId ? { ...p, muted: next } : p,
        ),
      );
      return next;
    });
  }, [userId]);

  const setMicGain = useCallback((value: number) => {
    setMicGainState(value);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = value;
    }
  }, []);

  const setParticipantVolume = useCallback((peerId: string, value: number) => {
    volumesRef.current[peerId] = value;
    setVolumes((prev) => ({ ...prev, [peerId]: value }));
    const audioEl = audioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.volume = value;
    }
  }, []);

  const transferHost = useCallback(
    (peerId: string) => {
      if (hostIdRef.current !== userId) return;
      supabaseRef.current
        .from("rooms")
        .update({ host_id: peerId })
        .eq("id", roomId)
        .then(() => {});
      channelRef.current?.send({
        type: "broadcast",
        event: "host-change",
        payload: { newHostId: peerId, from: userId } satisfies HostChangePayload,
      });
      applyHostChange(peerId);
    },
    [roomId, userId, applyHostChange],
  );

  const kickParticipant = useCallback(
    (peerId: string) => {
      if (hostIdRef.current !== userId) return;
      channelRef.current?.send({
        type: "broadcast",
        event: "kick",
        payload: { targetId: peerId, from: userId } satisfies KickPayload,
      });
    },
    [userId],
  );

  return {
    participants,
    muted,
    toggleMute,
    micGain,
    setMicGain,
    volumes,
    setParticipantVolume,
    speaking,
    hostId,
    isHost: hostId === userId,
    transferHost,
    kickParticipant,
    status,
  };
}
