// TESTING AUTO GAIN AND STUFF
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;

const frequencyData = new Float32Array(analyser.frequencyBinCount);

const kWeightingFilter = audioContext.createBiquadFilter();
kWeightingFilter.type = "peaking";
kWeightingFilter.frequency.value = 2000;
kWeightingFilter.gain.value = 4;
kWeightingFilter.Q.value = 1.0;

// hack to get the stream started. need to .play() an audio object with the stream as source, audio object can be removed afterwars
const audio = new Audio();
audio.srcObject = new MediaStream([consumerStream]);
audio.muted = true;
audio.play();
audio.remove();
const source = audioContext.createMediaStreamSource(consumerStream);
source.connect(kWeightingFilter);
kWeightingFilter.connect(analyser);

const volumeHistory = [];
const historyDuration = 400;
const historySize = Math.ceil((historyDuration / 1000) * 50);

let avgLUFS = 0;
function computeLUFS() {
  analyser.getFloatFrequencyData(frequencyData);

  let sumSquares = 0;
  for (let i = 0; i < frequencyData.length; i++) {
    sumSquares += Math.pow(10, frequencyData[i] / 10);
  }

  const rms = Math.sqrt(sumSquares / frequencyData.length);
  const lufs = -0.691 + 10 * Math.log10(rms);

  volumeHistory.push(lufs);
  if (volumeHistory.length > historySize) {
    volumeHistory.shift();
  }

  avgLUFS = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;

  setTimeout(computeLUFS, 1000 / 50);
}
computeLUFS();

const TARGET_LUFS = -18;
function calculateGain() {
  let gainDb = TARGET_LUFS - avgLUFS;
  return Math.pow(10, gainDb / 20);
}

const autoGainNode = audioContext.createGain();

const MIN_GAIN = 0.5;
const MAX_GAIN = 40.0; // Math.pow(10, ((-TARGET_LUFS) - (-CURRENT_LUFS)) / 20);
function applyAutoGain() {
  let gain = calculateGain();
  gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain));
  autoGainNode.gain.setTargetAtTime(gain, audioContext.currentTime, 0.1);

  // console.log(`Setting gain to ${gain} at ${avgLUFS} LUFS`);

  setTimeout(applyAutoGain, 1000 / 100);
}
setTimeout(applyAutoGain, 1000 / 100);

source.connect(autoGainNode);
// autoGainNode.connect(audioContext.destination);
audioContext.resume();
