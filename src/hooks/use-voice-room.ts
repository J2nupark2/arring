"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { formatAion2InviteName } from "@/lib/aion2-invite";
import { getAion2ProfileImage } from "@/lib/aion2-profile-image";

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

type PresenceState = {
  userId: string;
  nickname: string;
  inviteName?: string;
  characterRowId?: string | null;
  className?: string | null;
  profileImageUrl?: string | null;
};

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
  className: string | null;
  profileImageUrl: string | null;
  isFriend: boolean;
};

export type RoomChatMessage = {
  id: string;
  userId: string;
  nickname: string;
  body: string;
  imagePath: string | null;
  createdAt: number;
};

type ChatPayload = RoomChatMessage;

function legacyInviteName(displayName: string) {
  const match = displayName.match(/^(.*?)\s*\(([^()]+)\)$/);
  return match
    ? formatAion2InviteName(match[1], match[2])
    : displayName.replace(/\s+/g, "");
}

// Voice calls intentionally use STUN only. Some restrictive NAT environments
// may not connect without TURN, but the service does not relay voice traffic.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function useVoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
  inviteName,
  initialHostId,
  initialCharacterRowId,
  initialClassName,
  initialProfileImageUrl,
  onKicked,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  inviteName: string;
  initialHostId: string;
  initialCharacterRowId: string | null;
  initialClassName: string | null;
  initialProfileImageUrl: string | null;
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
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
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
        className: p.className ?? existing?.className ?? null,
        profileImageUrl: p.profileImageUrl ?? existing?.profileImageUrl ?? null,
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

  // Dummy friends are persisted room members but have no browser presence.
  // Hydrate the database roster too so the host can inspect and remove them.
  useEffect(() => {
    const supabase = supabaseRef.current;
    let active = true;

    async function refreshPersistedRoster() {
      const { data: rows } = await supabase
        .from("room_participants")
        .select("user_id")
        .eq("room_id", roomId)
        .is("left_at", null);
      const ids = [...new Set((rows ?? []).map((row) => row.user_id))];
      if (!active) return;

      setParticipants((prev) => prev.filter((participant) => ids.includes(participant.id)));
      if (ids.length === 0) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nickname, server, char_class")
        .in("id", ids);
      if (!active) return;

      for (const profile of profiles ?? []) {
        const displayName = profile.server
          ? `${profile.nickname} (${profile.server})`
          : profile.nickname;
        upsertParticipant({
          id: profile.id,
          nickname: displayName,
          inviteName: formatAion2InviteName(profile.nickname, profile.server),
          isSelf: profile.id === userId,
          muted: true,
          characterRowId: null,
          className: profile.char_class ?? null,
          profileImageUrl: null,
          isFriend: false,
        });
      }
    }

    void refreshPersistedRoster();
    const rosterRefreshId = window.setInterval(() => {
      void refreshPersistedRoster();
    }, 2000);
    const rosterChannel = supabase
      .channel(`room-roster:${roomId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_participants",
          filter: `room_id=eq.${roomId}`,
        },
        () => void refreshPersistedRoster(),
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(rosterRefreshId);
      void supabase.removeChannel(rosterChannel);
    };
  }, [roomId, userId, upsertParticipant]);

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
        audioEl.play().catch((error) => {
          console.warn("[voice-room] remote audio autoplay blocked", {
            roomCode,
            peerId,
            error: String(error),
          });
        });
        attachAnalyser(peerId, event.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          console.warn("[voice-room] peer connection failed", { roomCode, peerId });
          if (hostIdRef.current === userId) {
            pc.createOffer({ iceRestart: true })
              .then(async (offer) => {
                await pc.setLocalDescription(offer);
                send({ kind: "offer", from: userId, to: peerId, sdp: offer });
              })
              .catch((error) => {
                console.warn("[voice-room] ICE restart failed", {
                  roomCode,
                  peerId,
                  error: String(error),
                });
                closePeer(peerId);
              });
          } else {
            closePeer(peerId);
          }
        } else if (pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      return pc;
    },
    [send, userId, roomCode, closePeer, attachAnalyser],
  );

  const captureMic = useCallback(async () => {
    if (localStreamRef.current) return true;
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicIdRef.current
          ? {
              deviceId: { exact: selectedMicIdRef.current },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
      });
      // Route the mic through a GainNode so its level can be adjusted
      // live; peers receive the gain-processed stream.
      const audioCtx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = audioCtx;
      await audioCtx.resume().catch(() => undefined);

      if (audioCtx.state !== "running") {
        console.warn("[voice-room] AudioContext suspended; using raw microphone", {
          roomCode,
          userId,
          state: audioCtx.state,
        });
        rawStreamRef.current = rawStream;
        localStreamRef.current = rawStream;
        const capturedDeviceId = rawStream.getAudioTracks()[0]?.getSettings().deviceId;
        if (capturedDeviceId) {
          selectedMicIdRef.current = capturedDeviceId;
          setSelectedMicId(capturedDeviceId);
        }
        void refreshAudioInputs();
        attachAnalyser(userId, rawStream);
        return true;
      }

      const source = audioCtx.createMediaStreamSource(rawStream);
      const gainNode = audioCtx.createGain();
      const destination = audioCtx.createMediaStreamDestination();
      source.connect(gainNode);
      gainNode.connect(destination);

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
    } catch (error) {
      console.error("[voice-room] microphone capture failed", {
        roomCode,
        userId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      return false;
    }
  }, [roomCode, userId, attachAnalyser, refreshAudioInputs]);

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
        characterRowId: initialCharacterRowId,
        className: initialClassName,
        profileImageUrl: initialProfileImageUrl,
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
            const queuedCandidates = pendingIceRef.current.get(payload.from) ?? [];
            pendingIceRef.current.delete(payload.from);
            await Promise.all(queuedCandidates.map((candidate) => pc.addIceCandidate(candidate)));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ kind: "answer", from: userId, to: payload.from, sdp: answer });
          } else if (payload.kind === "answer") {
            const pc = ensurePeer(payload.from);
            await pc.setRemoteDescription(payload.sdp);
            const queuedCandidates = pendingIceRef.current.get(payload.from) ?? [];
            pendingIceRef.current.delete(payload.from);
            await Promise.all(queuedCandidates.map((candidate) => pc.addIceCandidate(candidate)));
          } else if (payload.kind === "ice-candidate") {
            try {
              const pc = ensurePeer(payload.from);
              if (!pc.remoteDescription) {
                const queued = pendingIceRef.current.get(payload.from) ?? [];
                queued.push(payload.candidate);
                pendingIceRef.current.set(payload.from, queued);
              } else {
                await pc.addIceCandidate(payload.candidate);
              }
            } catch (error) {
              console.warn("[voice-room] ICE candidate rejected", {
                roomCode,
                peerId: payload.from,
                error: String(error),
              });
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
            characterRowId: presence.characterRowId ?? null,
            className: presence.className ?? null,
            profileImageUrl: presence.profileImageUrl ?? null,
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

        // The host left from this client's presence view. Keep the local UI
        // usable, but do not write host_id from presence: the server-side
        // leave/delegate/kick flows are the authority for room ownership.
        // Presence order can differ from the server's selected successor and
        // would otherwise clobber refill ownership.
        if (key === hostIdRef.current) {
          const candidates = [userId, ...otherPeerIdsRef.current].sort();
          applyHostChange(candidates[0]);
        }
      });

      channel.subscribe(async (subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          joinedRef.current = true;
          await channel.track({
            userId,
            nickname,
            inviteName,
            characterRowId: initialCharacterRowId,
            className: initialClassName,
            profileImageUrl: initialProfileImageUrl,
          } satisfies PresenceState);
          const { data: activeParticipant } = await supabase
            .from("room_participants")
            .select("id")
            .eq("room_id", roomId)
            .eq("user_id", userId)
            .is("left_at", null)
            .limit(1)
            .maybeSingle();

          if (!activeParticipant) {
            const { data: latestParticipant } = await supabase
              .from("room_participants")
              .select("left_at")
              .eq("room_id", roomId)
              .eq("user_id", userId)
              .order("joined_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (latestParticipant?.left_at) {
              await supabase.rpc("set_current_room", { p_room_code: null });
              if (window.location.pathname === `/room/${roomCode}`) {
                window.location.assign("/party");
              }
              return;
            }

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

    const analysers = analysersRef.current;
    const peers = peersRef.current;
    const audioElements = audioElsRef.current;
    return () => {
      cancelled = true;
      clearInterval(speakingInterval);
      analysers.clear();
      channelRef.current?.unsubscribe();
      peers.forEach((pc) => pc.close());
      peers.clear();
      audioElements.forEach((el) => el.remove());
      audioElements.clear();
      audioContainerRef.current?.remove();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      micSourceRef.current?.disconnect();
      audioCtxRef.current?.close().catch(() => {});

      // A route change inside the app (for example opening "내 프로필") also
      // unmounts this hook. Persisted room membership is therefore cleared only
      // by explicit leave/kick flows, not by component cleanup.
      joinedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roomCode,
    roomId,
    userId,
    nickname,
    inviteName,
    initialCharacterRowId,
    initialClassName,
    initialProfileImageUrl,
  ]);

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
          .select("id, user_id, class_name, detail_data")
          .in("user_id", ids)
          .order("is_primary", { ascending: false })
          .order("synced_at", { ascending: false }),
        supabase.rpc("list_friends"),
      ]);

      if (cancelled) return;

      const characterByUser = new Map<
        string,
        { id: string; className: string | null; profileImageUrl: string | null }
      >();
      for (const character of (characterResult.data ?? []) as {
        id: string;
        user_id: string;
        class_name: string | null;
        detail_data: unknown;
      }[]) {
        if (!characterByUser.has(character.user_id)) {
          characterByUser.set(character.user_id, {
            id: character.id,
            className: character.class_name ?? null,
            profileImageUrl: getAion2ProfileImage(character.detail_data),
          });
        }
      }

      const friendIds = new Set(
        ((friendResult.data ?? []) as { user_id: string }[]).map(
          (friend) => friend.user_id,
        ),
      );

      setParticipants((prev) =>
        prev.map((participant) => {
          const fallbackCharacter = characterByUser.get(participant.id);
          return {
            ...participant,
            characterRowId:
              participant.characterRowId ?? fallbackCharacter?.id ?? null,
            className: participant.className ?? fallbackCharacter?.className ?? null,
            profileImageUrl:
              participant.profileImageUrl ??
              fallbackCharacter?.profileImageUrl ??
              null,
            isFriend: friendIds.has(participant.id),
          };
        }),
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
    async (peerId: string) => {
      if (hostIdRef.current !== userId) {
        throw new Error("방장만 파티원을 추방할 수 있습니다.");
      }
      const response = await fetch("/api/rooms/refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, targetUserId: peerId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error ?? "추방 및 재매칭을 시작하지 못했습니다.");
      }
      channelRef.current?.send({
        type: "broadcast",
        event: "kick",
        payload: { targetId: peerId, from: userId } satisfies KickPayload,
      });
      closePeer(peerId);
      removeParticipant(peerId);
      return result as { refillRequestId: string; state: string };
    },
    [roomId, userId, closePeer, removeParticipant],
  );

  const sendChatMessage = useCallback(
    (body: string, imagePath: string | null = null) => {
      const trimmed = body.trim();
      if (!trimmed && !imagePath) return;
      const message: RoomChatMessage = {
        id: crypto.randomUUID(),
        userId,
        nickname,
        body: trimmed,
        imagePath,
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
