/**
 * Dictation's microphone tap (an AudioWorklet, loaded by src/lib/dictation/service-dictation.ts): turns the mic's
 * samples into 16-bit PCM and hands them over a tenth of a second at a time, the size the speech service wants.
 */
class DictationTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buffer = new Int16Array(this.size);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.size) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("dictation-tap", DictationTap);
