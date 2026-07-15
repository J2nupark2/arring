"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatAion2InviteName } from "@/lib/aion2-invite";

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

type PresenceState = { userId: string; nickname: string; inviteName?: string };

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

export type Participant = {
  id: string;
  nickname: string;
  inviteName: string;
  isSelf: boolean;
  muted: boolean;
  characterRowId: string | null;
  isFriend: boolean;
};

export type RoomChatMessage = {
  id: string;
  userId: string;
  nickname: string;
  body: string;
  createdAt: number;
};

type ChatPayload = RoomChatMessage;

function legacyInviteName(displayName: string) {
  const match = displayName.match(/^(.*?)\s*\(([^()]+)\)$/);
  return match
    ? formatAion2InviteName(match[1], match[2])
    : displayName.replace(/\s+/g, "");
}

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
  inviteName,
  initialHostId,
  onKicked,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  inviteName: string;
  initialHostId: string;
  onKicked?: () => void;
}) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted, setMuted] = useState(false);
  const [micGain, setMicGainState] = useState(1);
  const [audioInputs, setAudioInputs] = useState<AudioInputDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("");
  const [switchingMic, setSwitchingMic] = useState(false);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [hostId, setHostId] = useState(initialHostId);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);

  const supabaseRef = useRef(createClient());
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const selectedMicIdRef = useRef("");
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

  useEffect(() => {
    onKickedRef.current = onKicked;
  }, [onKicked]);

  const upsertParticipant = useCallback((p: Participant) => {
    setParticipants((prev) => {
      const existing = prev.find((x) => x.id === p.id);
      const others = prev.filter((x) => x.id !== p.id);
      const next = {
        ...p,
        characterRowId: p.characterRowId ?? existing?.characterRowId ?? null,
        isFriend: p.isFriend || existing?.isFriend || false,
      };
      return [...others, next].sort((a, b) =>
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
  // Listeners have no mic-owned AudioContext, so create one lazily here.
  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    if (analysersRef.current.has(id)) return;
    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AudioContext();
        audioCtxRef.current.resume().catch(() => {});
      } catch {
        return;
      }
    }
    const ctx = audioCtxRef.current;
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

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    setAudioInputs(
      devices.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `마이크 ${index + 1}`,
      })),
    );
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

  const captureMic = useCallback(async () => {
    if (localStreamRef.current) return true;
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicIdRef.current
          ? { deviceId: { exact: selectedMicIdRef.current } }
          : true,
      });
      // Route the mic through a GainNode so its level can be adjusted
      // live; peers receive the gain-processed stream.
      const audioCtx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(rawStream);
      const gainNode = audioCtx.createGain();
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(gainNode);
      gainNode.connect(destination);
      audioCtx.resume().catch(() => {});

      rawStreamRef.current = rawStream;
      micSourceRef.current = source;
      gainNodeRef.current = gainNode;
      localStreamRef.current = destination.stream;
      const capturedDeviceId = rawStream.getAudioTracks()[0]?.getSettings().deviceId;
      if (capturedDeviceId) {
        selectedMicIdRef.current = capturedDeviceId;
        setSelectedMicId(capturedDeviceId);
      }
      void refreshAudioInputs();
      attachAnalyser(userId, destination.stream);
      return true;
    } catch {
      return false;
    }
  }, [userId, attachAnalyser, refreshAudioInputs]);

  const releaseMic = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    micSourceRef.current?.disconnect();
    localStreamRef.current = null;
    rawStreamRef.current = null;
    micSourceRef.current = null;
    gainNodeRef.current = null;
    analysersRef.current.delete(userId);
  }, [userId]);

  const switchMicDevice = useCallback(
    async (deviceId: string) => {
      if (
        hostIdRef.current !== userId ||
        !deviceId ||
        deviceId === selectedMicIdRef.current
      ) {
        return true;
      }

      setSwitchingMic(true);
      try {
        const audioContext = audioCtxRef.current;
        const gainNode = gainNodeRef.current;
        if (!audioContext || !gainNode) return false;

        const nextRawStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } },
        });
        const nextSource = audioContext.createMediaStreamSource(nextRawStream);
        nextSource.connect(gainNode);

        micSourceRef.current?.disconnect();
        rawStreamRef.current?.getTracks().forEach((track) => track.stop());
        micSourceRef.current = nextSource;
        rawStreamRef.current = nextRawStream;
        selectedMicIdRef.current = deviceId;
        setSelectedMicId(deviceId);
        void refreshAudioInputs();
        return true;
      } catch {
        return false;
      } finally {
        setSwitchingMic(false);
      }
    },
    [userId, refreshAudioInputs],
  );

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refreshAudioInputs();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshAudioInputs]);

  const initiateOfferTo = useCallback(
    (peerId: string) => {
      const pc = ensurePeer(peerId);
      pc.createOffer()
        .then(async (offer) => {
          await pc.setLocalDescription(offer);
          send({ kind: "offer", from: userId, to: peerId, sdp: offer });
        })
        .catch(() => {});
    },
    [ensurePeer, send, userId],
  );

  // Audio is a star centered on the host (only the host speaks; everyone
  // else listens), so a host change tears down every connection and the
  // new host re-offers to all present listeners with a fresh mic track —
  // simpler and more robust than renegotiating existing connections.
  const applyHostChange = useCallback(
    (newHostId: string) => {
      const becameHost = newHostId === userId;
      hostIdRef.current = newHostId;
      setHostId(newHostId);

      peersRef.current.forEach((_, peerId) => closePeer(peerId));

      if (becameHost) {
        setMuted(false);
        captureMic().then((ok) => {
          if (!ok) {
            setStatus("error");
            return;
          }
          otherPeerIdsRef.current.forEach((peerId) => initiateOfferTo(peerId));
        });
      } else if (localStreamRef.current) {
        releaseMic();
      }
    },
    [userId, closePeer, captureMic, releaseMic, initiateOfferTo],
  );

  useEffect(() => {
    audioContainerRef.current = document.createElement("div");
    audioContainerRef.current.style.display = "none";
    document.body.appendChild(audioContainerRef.current);

    let cancelled = false;
    const supabase = supabaseRef.current;

    async function setup() {
      // Only the host publishes audio — listeners join without ever being
      // asked for mic permission and simply receive the host's stream.
      if (hostIdRef.current === userId) {
        const ok = await captureMic();
        if (cancelled) {
          releaseMic();
          return;
        }
        if (!ok) {
          setStatus("error");
          return;
        }
      }

      upsertParticipant({
        id: userId,
        nickname,
        inviteName,
        isSelf: true,
        muted: false,
        characterRowId: null,
        isFriend: false,
      });

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

      // Room text chat rides the same per-room channel used for signaling —
      // broadcast-only, no persistence, matching how the call itself works
      // (nothing to replay once you've left).
      channel.on(
        "broadcast",
        { event: "chat-message" },
        ({ payload }: { payload: ChatPayload }) => {
          if (payload.userId === userId) return;
          setChatMessages((prev) => [...prev, payload]);
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
            inviteName: presence.inviteName ?? legacyInviteName(presence.nickname),
            isSelf: false,
            muted: false,
            characterRowId: null,
            isFriend: false,
          });

          // Star topology: only the host holds WebRTC connections, so the
          // host initiates an offer to every newly-present listener.
          // Listeners never connect to each other — which also means
          // strangers matched into the same party can't see each other's
          // IP addresses.
          if (hostIdRef.current === userId && !peersRef.current.has(peerId)) {
            initiateOfferTo(peerId);
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
          await channel.track({ userId, nickname, inviteName } satisfies PresenceState);
          const { data: activeParticipant } = await supabase
            .from("room_participants")
            .select("id")
            .eq("room_id", roomId)
            .eq("user_id", userId)
            .is("left_at", null)
            .limit(1)
            .maybeSingle();

          if (!activeParticipant) {
            const { error: participantError } = await supabase
              .from("room_participants")
              .insert({ room_id: roomId, user_id: userId });
            if (participantError) {
              console.error("room_participants insert failed:", participantError);
            }
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
      micSourceRef.current?.disconnect();
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
  }, [roomCode, roomId, userId, nickname, inviteName]);

  const participantIds = participants.map((p) => p.id).sort().join("|");

  useEffect(() => {
    if (!participantIds) return;

    let cancelled = false;
    const ids = participantIds.split("|").filter(Boolean);
    const supabase = supabaseRef.current;

    async function loadParticipantProfiles() {
      const [characterResult, friendResult] = await Promise.all([
        supabase
          .from("aion2_characters")
          .select("id, user_id")
          .in("user_id", ids)
          .order("is_primary", { ascending: false })
          .order("synced_at", { ascending: false }),
        supabase.rpc("list_friends"),
      ]);

      if (cancelled) return;

      const characterByUser = new Map<string, string>();
      for (const character of (characterResult.data ?? []) as {
        id: string;
        user_id: string;
      }[]) {
        if (!characterByUser.has(character.user_id)) {
          characterByUser.set(character.user_id, character.id);
        }
      }

      const friendIds = new Set(
        ((friendResult.data ?? []) as { user_id: string }[]).map(
          (friend) => friend.user_id,
        ),
      );

      setParticipants((prev) =>
        prev.map((participant) => ({
          ...participant,
          characterRowId: characterByUser.get(participant.id) ?? null,
          isFriend: friendIds.has(participant.id),
        })),
      );
    }

    void loadParticipantProfiles();

    return () => {
      cancelled = true;
    };
  }, [participantIds, userId]);

  const toggleMute = useCallback(() => {
    if (hostIdRef.current !== userId || !localStreamRef.current) return;
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

  const sendChatMessage = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const message: RoomChatMessage = {
        id: crypto.randomUUID(),
        userId,
        nickname,
        body: trimmed,
        createdAt: Date.now(),
      };
      // Broadcast doesn't echo back to the sender, so append locally too.
      setChatMessages((prev) => [...prev, message]);
      channelRef.current?.send({
        type: "broadcast",
        event: "chat-message",
        payload: message satisfies ChatPayload,
      });
    },
    [userId, nickname],
  );

  return {
    participants,
    muted,
    toggleMute,
    micGain,
    setMicGain,
    audioInputs,
    selectedMicId,
    switchingMic,
    switchMicDevice,
    volumes,
    setParticipantVolume,
    speaking,
    hostId,
    isHost: hostId === userId,
    transferHost,
    kickParticipant,
    chatMessages,
    sendChatMessage,
    status,
  };
}
