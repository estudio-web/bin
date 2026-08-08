let enabled = false;
let lastSpokenKey = "";

function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang?.toLowerCase().startsWith("es")) || voices[0] || null;
}

export function isAnnouncerSupported() {
  return canSpeak();
}

export function isAnnouncerEnabled() {
  return enabled;
}

export function setAnnouncerEnabled(value) {
  enabled = Boolean(value) && canSpeak();
  if (!enabled) {
    window.speechSynthesis?.cancel();
  }
  return enabled;
}

export function speak(text, key = text) {
  if (!enabled || !canSpeak() || !text) return;
  if (key && key === lastSpokenKey) return;
  lastSpokenKey = key;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-AR";
  utterance.rate = 0.92;
  utterance.pitch = 1;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function speakBall(ball) {
  if (!ball) return;
  speak(`Bolilla número ${ball}`, `ball:${ball}`);
}
