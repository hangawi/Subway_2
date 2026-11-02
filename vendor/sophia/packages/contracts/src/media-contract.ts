import type { AiExecutionLocation } from './ai-contract.ts';
import type { ProviderCode } from './provider-contract.ts';

// M05 말·사진·링크로 일정 입력 (F12, U1.3 B18). Speech fills the text box. Confirmed event fields go to the
// existing planners and permission/confirmation paths without a second AI interpretation. Nothing here
// executes anything, and the original audio, photo or page is never stored: it is read for this one request only.
// capture_id names one recording / photo / link: sending it again returns the same result without a second AI call.
export const MEDIA_CONTRACT_VERSION = 1;
// About a minute of compressed speech; a photo after the device made it small; a page as text.
export const AUDIO_MAX_BYTES = 2_000_000;
export const IMAGE_MAX_BYTES = 1_500_000;
export const PAGE_MAX_BYTES = 1_000_000;
export const PAGE_TEXT_MAX = 4000;
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] as const;
export type AudioType = (typeof AUDIO_TYPES)[number];

// OK: a result to confirm. EMPTY: nothing was heard / found. UNAVAILABLE: no speech or AI service now (type instead).
export type MediaStatus = 'OK' | 'EMPTY' | 'UNAVAILABLE';
export interface MediaProvenance {
  provider_id: string;
  execution_location: AiExecutionLocation;
  // A test fixture's answer is never shown as a real recognition.
  mock: boolean;
}
export interface TranscriptResult {
  contract_version: typeof MEDIA_CONTRACT_VERSION;
  capture_id: string;
  status: MediaStatus;
  text: string | null;
  ai: MediaProvenance | null;
}
// What a photo or a page says about an event. Each field is null when it is not there (never guessed).
export interface EventFields {
  title: string | null;
  date_text: string | null;
  start_text: string | null;
  end_text: string | null;
  place: string | null;
}
export type EventField = keyof EventFields;
// Why a link could not be read (M05.03): told apart so the screen can say what to do.
export type LinkFailure =
  | 'DYNAMIC_PAGE'
  | 'INVALID_URL'
  | 'BLOCKED_ADDRESS'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'NOT_TEXT'
  | 'UNREACHABLE';
export interface ExtractionResult {
  contract_version: typeof MEDIA_CONTRACT_VERSION;
  capture_id: string;
  source: 'IMAGE' | 'LINK';
  status: MediaStatus | 'LINK_FAILED';
  link_failure: LinkFailure | null;
  // LINK: the page actually read (after redirects) and its title.
  source_url: string | null;
  source_title: string | null;
  // 10/18 LINK to a search results page: the words searched instead of reading the page (source_url is then the
  // search result the event was read from). Added without a version change: an older app simply does not show it.
  searched_query: string | null;
  fields: EventFields | null;
  // Fields the event needs that were not found (shown as "없음", asked later, never filled in).
  missing: EventField[];
  // The fields as one sentence for the input box (the person edits it before anything happens).
  sentence: string | null;
  ai: MediaProvenance | null;
}
export interface ImageRequest {
  capture_id: string;
  media_type: 'image/jpeg' | 'image/png' | 'image/webp';
  data_base64: string;
}
export interface LinkRequest {
  capture_id: string;
  url: string;
}

// Speech to text (A100 whisper through an OpenAI-compatible server, or an external API). No audio is kept.
export interface SpeechResult {
  code: ProviderCode;
  provider_id: string;
  execution_location: AiExecutionLocation;
  model_version: string | null;
  text: string | null;
  message: string;
}
export interface SpeechProvider {
  provider_id: string;
  execution_location: AiExecutionLocation;
  configReady(): boolean;
  transcribe(audio: Uint8Array, mediaType: AudioType, language: 'ko', signal: AbortSignal): Promise<SpeechResult>;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCaptureId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function parseImageRequest(value: unknown): ImageRequest {
  if (!isObject(value) || !onlyKeys(value, ['capture_id', 'media_type', 'data_base64']))
    throw new Error('INVALID_MEDIA');
  if (!isCaptureId(value.capture_id)) throw new Error('INVALID_MEDIA');
  if (value.media_type !== 'image/jpeg' && value.media_type !== 'image/png' && value.media_type !== 'image/webp')
    throw new Error('MEDIA_TYPE_NOT_SUPPORTED');
  if (typeof value.data_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data_base64))
    throw new Error('INVALID_MEDIA');
  if ((value.data_base64.length * 3) / 4 > IMAGE_MAX_BYTES) throw new Error('MEDIA_TOO_LARGE');
  return { capture_id: value.capture_id.toLowerCase(), media_type: value.media_type, data_base64: value.data_base64 };
}
export function parseLinkRequest(value: unknown): LinkRequest {
  if (!isObject(value) || !onlyKeys(value, ['capture_id', 'url'])) throw new Error('INVALID_MEDIA');
  if (!isCaptureId(value.capture_id) || typeof value.url !== 'string' || value.url.length > 2000)
    throw new Error('INVALID_MEDIA');
  return { capture_id: value.capture_id.toLowerCase(), url: value.url.trim() };
}
export function audioType(header: string | undefined): AudioType | null {
  const base = (header ?? '').split(';')[0]!.trim().toLowerCase();
  return (AUDIO_TYPES as readonly string[]).includes(base) ? (base as AudioType) : null;
}

// The fields as one Korean sentence for the input box, in the order people say it ("10월 12일 오후 7시부터 9시까지
// 강남역에서 동창회"). Missing parts are simply left out; the person adds them or is asked.
export function fieldsSentence(f: EventFields): string | null {
  const start = f.start_text?.replace(/\s*부터$/, '').trim() || null;
  const end = f.end_text?.replace(/\s*까지$/, '').trim() || null;
  const when = [f.date_text, start && end ? `${start}부터 ${end}까지` : start].filter(Boolean).join(' ');
  const parts = [when, f.place ? `${f.place}에서` : null, f.title].filter((x): x is string => !!x && x.trim() !== '');
  return parts.length ? parts.join(' ') : null;
}
export const REQUIRED_FIELDS: readonly EventField[] = ['title', 'date_text', 'start_text'];
export function missingFields(f: EventFields): EventField[] {
  return REQUIRED_FIELDS.filter((k) => !f[k]);
}
