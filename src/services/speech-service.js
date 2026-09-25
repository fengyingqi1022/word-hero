import { normalizeWordKey } from '../core/normalize.js';
import { TEST_AUDIO } from './sample-audio.js';

let audioElement;

export const nativeSpeechAvailable = () => Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance);
export const speechAvailable = (text = '') => Boolean(TEST_AUDIO[normalizeWordKey(text)]) || listEnglishVoices().length > 0;

export function listEnglishVoices() {
  if (!nativeSpeechAvailable()) return [];
  return speechSynthesis.getVoices().filter((voice) => /^en(?:-|_)/i.test(voice.lang));
}

export function loadEnglishVoices(timeoutMs = 1500) {
  const existing = listEnglishVoices();
  if (existing.length || !nativeSpeechAvailable()) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener?.('voiceschanged', finish);
      resolve(listEnglishVoices());
    };
    speechSynthesis.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

function selectVoice(voiceURI = '') {
  const voices = listEnglishVoices();
  return voices.find((voice) => voice.voiceURI === voiceURI)
    || voices.find((voice) => /^en-US$/i.test(voice.lang))
    || voices[0]
    || null;
}

export function speak(text, rate = 0.85, voiceURI = '') {
  const source = TEST_AUDIO[normalizeWordKey(text)];
  if (source) {
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = 'word-audio';
      audioElement.hidden = true;
      audioElement.preload = 'auto';
      document.body.append(audioElement);
    }
    audioElement.pause();
    audioElement.src = source;
    audioElement.playbackRate = Math.min(1.15, Math.max(0.75, rate));
    audioElement.currentTime = 0;
    audioElement.play().catch(() => {});
    return true;
  }

  if (!nativeSpeechAvailable()) return false;
  const voice = selectVoice(voiceURI);
  if (!voice) return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.voice = voice;
  speechSynthesis.speak(utterance);
  return true;
}

export function testSystemSpeech(rate = 0.85, voiceURI = '') {
  if (!nativeSpeechAvailable()) return Promise.resolve(false);
  const voice = selectVoice(voiceURI);
  if (!voice) return Promise.resolve(false);
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Welcome to Word Hero. Your English voice is ready.');
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.voice = voice;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (success) => { if (!settled) { settled = true; resolve(success); } };
    utterance.onstart = () => finish(true);
    utterance.onerror = () => finish(false);
    speechSynthesis.speak(utterance);
    setTimeout(() => finish(speechSynthesis.speaking), 2500);
  });
}

export function stopSpeech() {
  if (nativeSpeechAvailable()) speechSynthesis.cancel();
  if (audioElement) { audioElement.pause(); audioElement.currentTime = 0; }
}
