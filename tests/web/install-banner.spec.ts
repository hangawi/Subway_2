import { describe, expect, it } from 'vitest';
import { installView, type InstallFacts } from '../../src/web/install-banner.ts';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const base: InstallFacts = { userAgent: ANDROID_CHROME, standalone: false, kakao: false, canPrompt: false, justInstalled: false, closed: false };
const v = (over: Partial<InstallFacts>) => installView({ ...base, ...over });

describe('맨 위 설치 안내 (10/16)', () => {
  it('안드로이드: 브라우저가 설치를 허락하면 [앱 설치] 버튼', () => {
    expect(v({ canPrompt: true })).toMatchObject({ show: true, kind: 'android', button: true });
  });
  it('안드로이드: 설치가 끝나면 버튼이 사라지고 "설치됐어요"', () => {
    expect(v({ justInstalled: true })).toMatchObject({ show: true, kind: 'installed', button: false });
  });
  it('안드로이드: 이미 설치돼서 브라우저가 허락하지 않으면 아무것도 안 보임', () => {
    expect(v({})).toEqual({ show: false });
  });
  it('아이폰: "홈 화면에 추가하기" 안내 + 닫기, 닫으면 안 보임', () => {
    expect(v({ userAgent: IPHONE_SAFARI })).toMatchObject({ show: true, kind: 'ios', button: false, close: true });
    expect(v({ userAgent: IPHONE_SAFARI }).show && (v({ userAgent: IPHONE_SAFARI }) as { text: string }).text).toContain('홈 화면에 추가');
    expect(v({ userAgent: IPHONE_SAFARI, closed: true })).toEqual({ show: false });
  });
  it('홈 화면 아이콘(설치한 앱)으로 열면 안드로이드·아이폰 모두 안 보임', () => {
    expect(v({ standalone: true, canPrompt: true })).toEqual({ show: false });
    expect(v({ standalone: true, userAgent: IPHONE_SAFARI })).toEqual({ show: false });
  });
  it('카카오톡 안에서는 Chrome 안내가 먼저라 안 보임', () => {
    expect(v({ kakao: true, canPrompt: true })).toEqual({ show: false });
    expect(v({ kakao: true, userAgent: IPHONE_SAFARI })).toEqual({ show: false });
  });
});
