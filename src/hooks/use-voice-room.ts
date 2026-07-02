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
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const otherPeerIdsRef = useRef<Set<string>>(new Set());
  const everHadOtherPeerRef = useRef(false);

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

    const audioEl = audioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElsRef.current.delete(peerId);
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
          audioContainerRef.current?.appendChild(audioEl);
          audioElsRef.current.set(peerId, audioEl);
        }
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(() => {});
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [send, userId, closePeer],
  );

  useEffect(() => {
    audioContainerRef.current = document.createElement("div");
    audioContainerRef.current.style.display = "none";
    document.body.appendChild(audioContainerRef.current);

    let cancelled = false;
    const supabase = supabaseRef.current;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
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

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceState>();

        for (const [peerId, presences] of Object.entries(state)) {
          if (peerId === userId) continue;
          const presence = presences[0];
          if (!presence) continue;

          otherPeerIdsRef.current.add(peerId);
          everHadOtherPeerRef.current = true;

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
      });

      channel.subscribe(async (subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          await channel.track({ userId, nickname } satisfies PresenceState);
          const { error: participantError } = await supabase
            .from("room_participants")
            .insert({ room_id: roomId, user_id: userId });
          if (participantError) {
            console.error("room_participants insert failed:", participantError);
          }
          setStatus("connected");
        }
      });
    }

    setup();

    return () => {
      cancelled = true;
      channelRef.current?.unsubscribe();
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      audioElsRef.current.forEach((el) => el.remove());
      audioElsRef.current.clear();
      audioContainerRef.current?.remove();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());

      supabase
        .from("room_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .is("left_at", null)
        .then(() => {});

      // Only auto-close the room if other participants were here and have
      // now all left — not just because no one has joined yet (e.g. the
      // creator is still waiting for a friend, or this is React Strict
      // Mode's dev-only mount/cleanup/mount dry run).
      if (everHadOtherPeerRef.current && otherPeerIdsRef.current.size === 0) {
        supabase
          .from("rooms")
          .update({ status: "ended" })
          .eq("id", roomId)
          .then(() => {});
      }
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

  return { participants, muted, toggleMute, status };
}
