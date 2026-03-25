import { useState, useEffect, useRef, useCallback } from "react";

const FREQUENCIES = [
  { hz: 370.5, label: "Sub Oct", note: "370.5", color: "#ff3366", type: "octave" },
  { hz: 396, label: "Lib", note: "396", color: "#ff6633", type: "solfeggio" },
  { hz: 528, label: "Love", note: "528", color: "#33ff66", type: "solfeggio" },
  { hz: 741, label: "ROOT", note: "741", color: "#33ccff", type: "root" },
  { hz: 926.25, label: "Terz", note: "926", color: "#9966ff", type: "interval" },
  { hz: 988, label: "Quarte", note: "988", color: "#ff66cc", type: "interval" },
  { hz: 1111.5, label: "Quinte", note: "1112", color: "#ffcc33", type: "interval" },
  { hz: 1482, label: "Oktave", note: "1482", color: "#66ffcc", type: "octave" },
];

// nanoKONTROL2 CC mapping
const CC_FADERS = [0, 1, 2, 3, 4, 5, 6, 7];
const CC_KNOBS = [16, 17, 18, 19, 20, 21, 22, 23];
const CC_SOLO = [32, 33, 34, 35, 36, 37, 38, 39];
const CC_MUTE = [48, 49, 50, 51, 52, 53, 54, 55];
const CC_PLAY = 41;
const CC_STOP = 42;

export default function HarmonySynth() {
  const [volumes, setVolumes] = useState<number[]>(() => FREQUENCIES.map((f) => (f.type === "root" ? 0.6 : 0)));
  const [detune, setDetune] = useState<number[]>(() => FREQUENCIES.map(() => 0));
  const [active, setActive] = useState<boolean[]>(() => FREQUENCIES.map(() => true));
  const [waveform, setWaveform] = useState<string>("sine");
  const [masterVol, setMasterVol] = useState<number>(0.5);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [midiConnected, setMidiConnected] = useState<boolean>(false);
  const [midiDevice, setMidiDevice] = useState(null);
  const [analyserData, setAnalyserData] = useState<Uint8Array>(new Uint8Array(128));

  const audioCtxRef = useRef<any>(null);
  const oscillatorsRef = useRef<any[]>([]);
  const gainsRef = useRef<any[]>([]);
  const masterGainRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);

  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;

    const ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = masterVol;
    masterGainRef.current = master;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    FREQUENCIES.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveform;
      osc.frequency.value = freq.hz;
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      oscillatorsRef.current[i] = osc;
      gainsRef.current[i] = gain;
    });

    return ctx;
  }, []);

  const startVisualizer = useCallback(() => {
    const draw = () => {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(data);
      setAnalyserData(new Uint8Array(data));
      animFrameRef.current = requestAnimationFrame(draw);
    };
    draw();
  }, []);

  const togglePlay = useCallback(() => {
    if (!isPlaying) {
      const ctx = initAudio();
      if (ctx.state === "suspended") ctx.resume();
      gainsRef.current.forEach((g, i) => {
        g.gain.setTargetAtTime(active[i] ? volumes[i] : 0, ctx.currentTime, 0.05);
      });
      startVisualizer();
      setIsPlaying(true);
    } else {
      gainsRef.current.forEach((g) => {
        g.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
      });
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setIsPlaying(false);
    }
  }, [isPlaying, volumes, active, initAudio, startVisualizer]);

  // Sync volumes
  useEffect(() => {
    if (!isPlaying) return;
    gainsRef.current.forEach((g, i) => {
      if (g) {
        const val = active[i] ? volumes[i] : 0;
        g.gain.setTargetAtTime(val, audioCtxRef.current.currentTime, 0.03);
      }
    });
  }, [volumes, active, isPlaying]);

  // Sync detune
  useEffect(() => {
    oscillatorsRef.current.forEach((osc, i) => {
      if (osc) osc.detune.value = detune[i];
    });
  }, [detune]);

  // Sync master volume
  useEffect(() => {
    if (masterGainRef.current && audioCtxRef.current) {
      masterGainRef.current.gain.setTargetAtTime(masterVol, audioCtxRef.current.currentTime, 0.03);
    }
  }, [masterVol]);

  // Sync waveform
  useEffect(() => {
    oscillatorsRef.current.forEach((osc) => {
      if (osc) osc.type = waveform;
    });
  }, [waveform]);

  // Web MIDI
  useEffect(() => {
    if (!(navigator as any).requestMIDIAccess) return;

    (navigator as any)
      .requestMIDIAccess({ sysex: false })
      .then((access: any) => {
        const connectInputs = () => {
          for (const input of access.inputs.values()) {
            if ((input as any).name?.includes("nanoKONTROL")) {
              setMidiConnected(true);
              setMidiDevice((input as any).name);
            }

            input.onmidimessage = (msg: any) => {
              const [status, cc, val] = msg.data;
              if ((status & 0xf0) === 0xb0) {
                const norm = val / 127;
                const faderIdx = CC_FADERS.indexOf(cc);
                const knobIdx = CC_KNOBS.indexOf(cc);
                const soloIdx = CC_SOLO.indexOf(cc);
                const muteIdx = CC_MUTE.indexOf(cc);

                if (faderIdx !== -1) {
                  setVolumes((prev) => {
                    const n = [...prev];
                    n[faderIdx] = norm;
                    return n;
                  });
                } else if (knobIdx !== -1) {
                  setDetune((prev) => {
                    const n = [...prev];
                    n[knobIdx] = (norm - 0.5) * 100;
                    return n;
                  });
                } else if (soloIdx !== -1 && val === 127) {
                  setActive((prev) => {
                    const n = [...prev];
                    n[soloIdx] = !n[soloIdx];
                    return n;
                  });
                } else if (muteIdx !== -1 && val === 127) {
                  setVolumes((prev) => {
                    const n = [...prev];
                    n[muteIdx] = 0;
                    return n;
                  });
                } else if (cc === CC_PLAY && val === 127) {
                  setIsPlaying((prev) => {
                    if (!prev) {
                      const ctx = initAudio();
                      if (ctx.state === "suspended") ctx.resume();
                      startVisualizer();
                    }
                    return true;
                  });
                } else if (cc === CC_STOP && val === 127) {
                  setIsPlaying(false);
                }
              }
            };
          }
        };

        connectInputs();
        access.onstatechange = connectInputs;
      });
  }, [initAudio, startVisualizer]);

  // Play state from MIDI
  useEffect(() => {
    if (isPlaying && audioCtxRef.current) {
      gainsRef.current.forEach((g, i) => {
        if (g) g.gain.setTargetAtTime(active[i] ? volumes[i] : 0, audioCtxRef.current.currentTime, 0.03);
      });
    } else if (!isPlaying && gainsRef.current.length) {
      gainsRef.current.forEach((g) => {
        if (g && audioCtxRef.current) g.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
      });
    }
  }, [isPlaying]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      oscillatorsRef.current.forEach((o) => {
        try {
          o.stop();
        } catch (e) {}
      });
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  const Waveform = () => {
    const bars = 64;
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 80, padding: "0 8px" }}>
        {Array.from({ length: bars }).map((_, i) => {
          const val = analyserData[i * 2] || 0;
          const h = Math.max(2, (val / 255) * 80);
          const hue = (i / bars) * 360;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: h,
                background: isPlaying ? `hsl(${hue}, 80%, ${40 + (val / 255) * 30}%)` : "rgba(255,255,255,0.08)",
                borderRadius: 1,
                transition: "height 0.05s ease",
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
        background: "#0a0a0f",
        color: "#e0e0e0",
        minHeight: "100vh",
        padding: "24px 16px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 8,
            margin: 0,
            background: "linear-gradient(135deg, #33ccff, #9966ff, #ff3366)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          741 HARMONY
        </h1>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 4, marginTop: 4 }}>SOLFEGGIO SYNTHESIZER</div>
      </div>

      {/* MIDI Status */}
      <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 16, fontSize: 11 }}>
        <div
          style={{
            padding: "4px 12px",
            borderRadius: 20,
            background: midiConnected ? "rgba(51,255,102,0.12)" : "rgba(255,51,51,0.12)",
            color: midiConnected ? "#33ff66" : "#ff5555",
            border: `1px solid ${midiConnected ? "rgba(51,255,102,0.3)" : "rgba(255,51,51,0.3)"}`,
          }}
        >
          MIDI: {midiConnected ? midiDevice : "nicht verbunden"}
        </div>
        <div
          style={{
            padding: "4px 12px",
            borderRadius: 20,
            background: isPlaying ? "rgba(51,204,255,0.12)" : "rgba(255,255,255,0.05)",
            color: isPlaying ? "#33ccff" : "#666",
            border: `1px solid ${isPlaying ? "rgba(51,204,255,0.3)" : "rgba(255,255,255,0.1)"}`,
          }}
        >
          {isPlaying ? "▶ PLAYING" : "■ STOPPED"}
        </div>
      </div>

      {/* Visualizer */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          borderRadius: 8,
          padding: "12px 0",
          marginBottom: 20,
          border: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <Waveform />
      </div>

      {/* Channel Strips */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
        {FREQUENCIES.map((freq, i) => (
          <div
            key={i}
            style={{
              width: 72,
              background: active[i] ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
              borderRadius: 8,
              padding: "12px 6px",
              border: `1px solid ${active[i] ? freq.color + "40" : "rgba(255,255,255,0.05)"}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              opacity: active[i] ? 1 : 0.4,
              transition: "all 0.2s ease",
            }}
          >
            {/* Label */}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: freq.color,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {freq.label}
            </div>

            {/* Hz */}
            <div style={{ fontSize: 11, color: "#888" }}>{freq.note}</div>

            {/* Fader */}
            <div
              style={{
                position: "relative",
                width: 6,
                height: 120,
                background: "rgba(255,255,255,0.08)",
                borderRadius: 3,
                cursor: "pointer",
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const val = 1 - (e.clientY - rect.top) / rect.height;
                setVolumes((prev) => {
                  const n = [...prev];
                  n[i] = Math.max(0, Math.min(1, val));
                  return n;
                });
              }}
            >
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  width: "100%",
                  height: `${volumes[i] * 100}%`,
                  background: `linear-gradient(to top, ${freq.color}80, ${freq.color})`,
                  borderRadius: 3,
                  transition: "height 0.05s ease",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: `calc(${volumes[i] * 100}% - 7px)`,
                  left: -5,
                  width: 16,
                  height: 14,
                  background: "#222",
                  border: `2px solid ${freq.color}`,
                  borderRadius: 3,
                  boxShadow: `0 0 8px ${freq.color}40`,
                }}
              />
            </div>

            {/* Volume % */}
            <div style={{ fontSize: 10, color: "#666" }}>{Math.round(volumes[i] * 100)}%</div>

            {/* Detune knob display */}
            <div style={{ fontSize: 9, color: "#555" }}>
              {detune[i] > 0 ? "+" : ""}
              {Math.round(detune[i])}¢
            </div>

            {/* Active toggle */}
            <button
              onClick={() =>
                setActive((prev) => {
                  const n = [...prev];
                  n[i] = !n[i];
                  return n;
                })
              }
              style={{
                width: 28,
                height: 16,
                borderRadius: 8,
                border: "none",
                background: active[i] ? freq.color : "#333",
                cursor: "pointer",
                position: "relative",
                transition: "background 0.2s",
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  background: "#fff",
                  position: "absolute",
                  top: 2,
                  left: active[i] ? 14 : 2,
                  transition: "left 0.2s",
                }}
              />
            </button>

            {/* MIDI CC label */}
            <div style={{ fontSize: 8, color: "#444" }}>
              F{CC_FADERS[i]} K{CC_KNOBS[i]}
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ marginTop: 20, display: "flex", justifyContent: "center", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Play button */}
        <button
          onClick={togglePlay}
          style={{
            padding: "10px 32px",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 3,
            background: isPlaying ? "rgba(255,51,51,0.15)" : "rgba(51,204,255,0.15)",
            color: isPlaying ? "#ff5555" : "#33ccff",
            border: `1px solid ${isPlaying ? "#ff555550" : "#33ccff50"}`,
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.2s",
          }}
        >
          {isPlaying ? "■ STOP" : "▶ PLAY"}
        </button>

        {/* Waveform selector */}
        <div style={{ display: "flex", gap: 4 }}>
          {["sine", "triangle", "sawtooth", "square"].map((w) => (
            <button
              key={w}
              onClick={() => setWaveform(w)}
              style={{
                padding: "6px 10px",
                fontSize: 10,
                fontFamily: "inherit",
                background: waveform === w ? "rgba(153,102,255,0.2)" : "rgba(255,255,255,0.03)",
                color: waveform === w ? "#9966ff" : "#666",
                border: `1px solid ${waveform === w ? "#9966ff50" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 4,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {w === "sine" ? "∿" : w === "triangle" ? "△" : w === "sawtooth" ? "⩘" : "□"} {w.slice(0, 3)}
            </button>
          ))}
        </div>

        {/* Master volume */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>MASTER</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={masterVol}
            onChange={(e) => setMasterVol(parseFloat(e.target.value))}
            style={{
              width: 80,
              accentColor: "#33ccff",
            }}
          />
          <span style={{ fontSize: 10, color: "#888", width: 30 }}>{Math.round(masterVol * 100)}%</span>
        </div>
      </div>

      {/* MIDI Mapping Info */}
      <div
        style={{
          marginTop: 24,
          padding: 12,
          background: "rgba(255,255,255,0.02)",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.05)",
          fontSize: 10,
          color: "#555",
          lineHeight: 1.8,
          textAlign: "center",
        }}
      >
        <span style={{ color: "#888", fontWeight: 600 }}>nanoKONTROL2 MAPPING</span>
        <br />
        Fader 1–8 → Volume · Knob 1–8 → Detune (±50¢) · Solo → Toggle · Mute → Zero · Play/Stop → Transport
      </div>
    </div>
  );
}

