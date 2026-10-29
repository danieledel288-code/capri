"""Audio for Capri: synthesized holocall ringtone, Kokoro TTS, faster-whisper STT."""
import queue
import re
import threading
import wave
import winsound
from pathlib import Path

import numpy as np
import sounddevice as sd

ROOT = Path(__file__).parent
ASSETS = ROOT / "assets"
MODELS = ROOT / "models"


# ---------- ringtone ----------

def _write_wav(path, samples, sr):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def _tone(freq, dur, sr, fm=0.0, fm_depth=0.0):
    t = np.arange(int(sr * dur)) / sr
    phase = 2 * np.pi * freq * t + fm_depth * np.sin(2 * np.pi * fm * t)
    env = np.minimum(1, t / 0.004) * np.exp(-t * 9)
    return np.sin(phase) * env


def build_ringtone(sr=44100):
    """Original holocall-style ring: a fast digital trill, twice, then a gap.
    Not a rip of the game's sound; drop your own assets/ringtone.wav to override."""
    burst = []
    for i, f in enumerate([1318, 1760, 1318, 1760, 2093, 1760]):
        burst.append(_tone(f, 0.07, sr, fm=f * 1.5, fm_depth=1.2) * (0.9 if i % 2 else 0.7))
    burst = np.concatenate(burst)
    sub = _tone(110, len(burst) / sr, sr) * 0.25          # low thump under the trill
    burst = burst + sub[: len(burst)]
    gap = np.zeros(int(sr * 0.18))
    long_gap = np.zeros(int(sr * 0.75))
    one_ring = np.concatenate([burst, gap, burst, long_gap])
    ring = np.tile(one_ring, 2)
    return ring * 0.6, sr


def build_pickup(sr=44100):
    chirp = np.concatenate([_tone(880, 0.05, sr), _tone(1760, 0.09, sr)])
    noise = np.random.default_rng(2077).normal(0, 0.08, int(sr * 0.06))
    noise *= np.linspace(1, 0, len(noise))
    return np.concatenate([noise, chirp]) * 0.5, sr


def ensure_sounds():
    ASSETS.mkdir(exist_ok=True)
    gen_ring = ASSETS / "ring_generated.wav"
    pickup = ASSETS / "pickup.wav"
    if not gen_ring.exists():
        _write_wav(gen_ring, *build_ringtone())
    if not pickup.exists():
        _write_wav(pickup, *build_pickup())
    custom = ASSETS / "ringtone.wav"
    return (custom if custom.exists() else gen_ring), pickup


def wav_seconds(path):
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def play_wav(path, block=False):
    flags = winsound.SND_FILENAME | (0 if block else winsound.SND_ASYNC)
    winsound.PlaySound(str(path), flags)


def stop_wav():
    winsound.PlaySound(None, 0)


# ---------- TTS ----------

def _comms_filter(x, sr):
    """Light 'over the holo' treatment: band-limit + soft saturation. Keeps up to ~7 kHz so she stays bright."""
    a = np.exp(-2 * np.pi * 7000 / sr)      # one-pole low-pass
    y = np.empty_like(x)
    acc = 0.0
    for i, s in enumerate(x):              # fine for a few seconds of audio
        acc = (1 - a) * s + a * acc
        y[i] = acc
    y = y - np.convolve(y, np.ones(48) / 48, mode="same")   # crude high-pass
    return np.tanh(y * 1.25) * 0.85


def _pitch_up(x, p):
    """Resample by 1/p: pitch up by factor p (the synth ran 1/p slower, so the pace comes out right)."""
    n = int(len(x) / p)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


class Speaker:
    def __init__(self, voice="af_bella:0.6+af_nova:0.4", speed=1.18, pitch=1.5, comms_fx=True):
        """voice: a Kokoro voice name, or a blend like "af_bella:0.6+af_nova:0.4". pitch: semitones up."""
        self.voice, self.speed, self.comms_fx = voice, speed, comms_fx
        self.pitch = 2 ** (pitch / 12)
        self._tts = None
        self._stopped = False
        self._ready = threading.Event()
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            from kokoro_onnx import Kokoro
            self._tts = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
            if ":" in self.voice:   # a blend: weighted sum of the voices' style vectors
                parts = [p.split(":") for p in self.voice.split("+")]
                self.voice = sum(float(w) * self._tts.get_voice_style(v) for v, w in parts)
        except Exception as e:  # missing model files etc. -> text-only mode
            print(f"[capri] TTS unavailable: {e}")
        self._ready.set()

    def say(self, text, on_sentence=None):
        """Blocking speak, sentence by sentence: the next sentence synthesizes
        while the current one plays. on_sentence(s) fires as each one starts (subtitles).
        Returns False if TTS isn't available."""
        self._ready.wait()
        if not self._tts or not text.strip():
            return False
        self._stopped = False
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
        q = queue.Queue(maxsize=2)

        def produce():
            for s in sentences:
                if self._stopped:
                    break
                samples, sr = self._tts.create(s, voice=self.voice, speed=self.speed / self.pitch, lang="en-us")
                samples = samples.astype(np.float32)
                if self.pitch != 1:
                    samples = _pitch_up(samples, self.pitch)
                if self.comms_fx:
                    samples = _comms_filter(samples, sr)
                q.put((samples, sr, s))
            q.put(None)

        threading.Thread(target=produce, daemon=True).start()
        while (item := q.get()) is not None:
            if self._stopped:
                continue
            if on_sentence:
                on_sentence(item[2])
            sd.play(item[0], item[1])
            sd.wait()
        return True

    def stop(self):
        self._stopped = True
        sd.stop()


# ---------- STT ----------

class Listener:
    """Push-to-talk recorder: start() on mic-down, stop() on mic-up returns text."""
    SR = 16000

    def __init__(self, model="base.en"):
        self.model_name = model
        self._model = None
        self._chunks = []
        self._stream = None
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        try:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(self.model_name, device="cpu", compute_type="int8")
        except Exception as e:
            print(f"[capri] STT unavailable: {e}")

    def start(self):
        self._chunks = []
        self._stream = sd.InputStream(samplerate=self.SR, channels=1, dtype="float32",
                                      callback=lambda d, *_: self._chunks.append(d.copy()))
        self._stream.start()

    def stop(self):
        if not self._stream:
            return ""
        self._stream.stop()
        self._stream.close()
        self._stream = None
        if not self._chunks or not self._model:
            return ""
        audio = np.concatenate(self._chunks).flatten()
        if len(audio) < self.SR * 0.3:
            return ""
        segments, _ = self._model.transcribe(audio, language="en", vad_filter=True, beam_size=1)
        return " ".join(s.text.strip() for s in segments).strip()
