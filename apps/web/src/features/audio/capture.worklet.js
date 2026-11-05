// AudioWorklet runs on the audio thread. Outputs stay silent to avoid feedback.
class TabRecordCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.buffer = new Float32Array(4096);
    this.used = 0;
    this.total = 0;
    this.limit = Math.floor(options.processorOptions.maxSeconds * sampleRate);
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') this.finish();
    };
  }
  flush() {
    if (!this.used) return;
    const samples = this.buffer.slice(0, this.used);
    this.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    this.used = 0;
  }
  finish() {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    this.port.postMessage({ type: 'stopped' });
  }
  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] / channels.length;
      this.buffer[this.used++] = value;
      this.total++;
      if (this.used === this.buffer.length) this.flush();
      if (this.total >= this.limit) {
        this.finish();
        return false;
      }
    }
    return true;
  }
}
registerProcessor('tabrecord-capture', TabRecordCapture);
