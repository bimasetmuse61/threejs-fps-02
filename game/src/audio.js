// All sound is synthesised with WebAudio: no audio files, no network. A tiny
// helper builds short envelopes of noise or tone; every effect is one call.
// The context is created on the first user gesture (the play click), as browsers
// require, and stays silent until then.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate * 1, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration + 0.05);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    shot(kind) {
      // kind: 'rifle' | 'smg' | 'pistol' | 'dmr' | 'enemy'
      if (kind === 'dmr') {
        noise(0.22, 900, 0.5);
        tone(140, 0.16, 0.35, 'sawtooth', 55);
      } else if (kind === 'pistol') {
        noise(0.09, 1800, 0.35);
        tone(220, 0.07, 0.2, 'square', 90);
      } else if (kind === 'smg') {
        noise(0.07, 2400, 0.3);
      } else if (kind === 'enemy') {
        noise(0.12, 1200, 0.16);
      } else {
        noise(0.11, 1500, 0.42);
        tone(180, 0.09, 0.25, 'sawtooth', 70);
      }
    },
    dryFire() {
      tone(1400, 0.03, 0.12, 'square');
    },
    reload() {
      tone(700, 0.04, 0.15, 'square');
      tone(500, 0.04, 0.15, 'square', null, 0.25);
      tone(900, 0.05, 0.18, 'square', null, 1.5);
    },
    hit(headshot) {
      tone(headshot ? 2200 : 1500, 0.06, 0.22, 'sine');
      if (headshot) tone(2900, 0.08, 0.18, 'sine', null, 0.05);
    },
    kill() {
      tone(880, 0.09, 0.2, 'sine');
      tone(1320, 0.12, 0.2, 'sine', null, 0.09);
    },
    hurt() {
      noise(0.12, 500, 0.3);
      tone(110, 0.14, 0.3, 'sawtooth', 60);
    },
    explosion() {
      noise(1.1, 320, 0.9);
      tone(70, 0.9, 0.6, 'sine', 28);
      noise(0.4, 2400, 0.25, 'highpass', 0.05);
    },
    plantBeep(final) {
      tone(final ? 1760 : 1180, 0.09, 0.2, 'sine');
    },
    plant() {
      tone(880, 0.1, 0.2, 'sine');
      tone(1174, 0.14, 0.2, 'sine', null, 0.12);
    },
    defuse() {
      tone(660, 0.1, 0.2, 'sine');
      tone(990, 0.16, 0.2, 'sine', null, 0.12);
    },
    roundWin() {
      tone(523, 0.14, 0.22, 'sine');
      tone(659, 0.14, 0.22, 'sine', null, 0.14);
      tone(784, 0.22, 0.24, 'sine', null, 0.28);
    },
    roundLose() {
      tone(392, 0.16, 0.22, 'sine');
      tone(330, 0.16, 0.22, 'sine', null, 0.16);
      tone(262, 0.26, 0.24, 'sine', null, 0.32);
    },
    buy() {
      tone(1046, 0.06, 0.18, 'sine');
      tone(1568, 0.08, 0.16, 'sine', null, 0.06);
    },
    denied() {
      tone(220, 0.1, 0.2, 'square', 160);
    },
    throwGrenade() {
      noise(0.15, 900, 0.18);
    },
    bounce() {
      tone(300, 0.05, 0.14, 'triangle', 180);
    },
    footstep() {
      noise(0.05, 400, 0.05);
    },
  };
}
