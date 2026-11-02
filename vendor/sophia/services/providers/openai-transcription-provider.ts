import type { AiExecutionLocation } from '../../packages/contracts/src/ai-contract.ts';
import type { AudioType, SpeechProvider, SpeechResult } from '../../packages/contracts/src/media-contract.ts';
import { httpStatusCode, type FetchLike } from './openai-responses-provider.ts';

// M05.01 Adapter for an OpenAI-compatible speech-to-text endpoint (POST {base_url}/audio/transcriptions,
// multipart). The same shape serves the A100 whisper model behind vLLM and the external API. The audio is sent
// once for this request and not kept; the key is sent only in the Authorization header.
export interface TranscriptionOptions {
  provider_id: string;
  execution_location: AiExecutionLocation;
  api_key: string | null;
  model: string;
  base_url: string;
  fetch?: FetchLike;
}
const EXTENSION: Record<AudioType, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export function createTranscriptionProvider(options: TranscriptionOptions): SpeechProvider {
  const fetcher: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const endpoint = options.base_url.replace(/\/+$/, '') + '/audio/transcriptions';
  const result = (code: SpeechResult['code'], message: string, extra: Partial<SpeechResult> = {}): SpeechResult => ({
    code,
    provider_id: options.provider_id,
    execution_location: options.execution_location,
    model_version: null,
    text: null,
    message,
    ...extra,
  });
  return {
    provider_id: options.provider_id,
    execution_location: options.execution_location,
    configReady: () => Boolean(options.api_key),
    async transcribe(audio, mediaType, language, signal) {
      if (!options.api_key) return result('CONFIG_NOT_READY', 'API_KEY_MISSING');
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: mediaType }), `capture.${EXTENSION[mediaType]}`);
      form.append('model', options.model);
      form.append('language', language);
      form.append('response_format', 'json');
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${options.api_key}` },
          body: form,
          signal,
        });
      } catch (error) {
        const aborted = signal.aborted || (error instanceof Error && error.name === 'AbortError');
        return result(aborted ? 'TIMEOUT' : 'PROVIDER_DOWN', aborted ? 'ABORTED' : 'NETWORK_ERROR');
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return result(response.ok ? 'INVALID_RESPONSE' : httpStatusCode(response.status, null), 'BODY_NOT_JSON');
      }
      const object = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      if (!response.ok) {
        const error = object.error && typeof object.error === 'object' ? (object.error as Record<string, unknown>) : {};
        return result(
          httpStatusCode(response.status, typeof error.code === 'string' ? error.code : null),
          `HTTP_${response.status}`,
        );
      }
      if (typeof object.text !== 'string') return result('INVALID_RESPONSE', 'TEXT_MISSING');
      return result('SUCCESS', 'OK', { text: object.text, model_version: options.model });
    },
  };
}

// Test and local-development stand-in: a fixed sentence, marked as a mock (never shown as a real recognition).
export function createScriptedSpeechProvider(text: string): SpeechProvider {
  return {
    provider_id: 'mock',
    execution_location: 'external',
    configReady: () => true,
    async transcribe(audio) {
      return {
        code: 'SUCCESS',
        provider_id: 'mock',
        execution_location: 'external',
        model_version: 'mock',
        // A recording with no sound in it is heard as nothing.
        text: audio.length < 200 ? '' : text,
        message: 'MOCK',
      };
    },
  };
}
