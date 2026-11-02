// 맨 위 설치 안내 (10/16 예형님 요청): 안드로이드는 [앱 설치], 아이폰은 "홈 화면에 추가하기".
// 막지는 않는다 — 브라우저에서도 다 쓸 수 있고, 안내만 한다.
//  - 설치한 앱(홈 화면 아이콘)으로 열면 안 보임
//  - 안드로이드: 브라우저가 설치를 허락할 때(beforeinstallprompt)만 버튼. 설치가 끝나면(appinstalled) 버튼이 사라짐.
//    이미 설치돼 있으면 브라우저가 허락하지 않으므로 버튼도 안 보임
//  - 아이폰: 브라우저는 홈 화면에 추가했는지 알려 주지 않는다 → 안내 + [닫기] (닫으면 이 브라우저에서는 다시 안 띄움)
//  - 카카오톡 안 브라우저에서는 Chrome으로 옮기는 안내(kakao-handoff.ts)가 먼저라 이 띠는 안 보임
// SOPHIA apps/client-pwa/src/install-ui.ts의 문구·순서를 따랐다 (막는 화면·"웹에서 계속"은 써브웨이에선 안 씀).

export type InstallView =
  | { show: false }
  | { show: true; kind: 'android'; text: string; button: true; close: false }
  | { show: true; kind: 'installed'; text: string; button: false; close: true }
  | { show: true; kind: 'ios'; text: string; button: false; close: true };

export interface InstallFacts {
  userAgent: string;
  /** 홈 화면 아이콘으로 열었는지 */
  standalone: boolean;
  kakao: boolean;
  /** 브라우저가 설치 창을 띄울 수 있다고 알려 줌 (beforeinstallprompt) */
  canPrompt: boolean;
  /** 방금 설치가 끝남 (appinstalled) */
  justInstalled: boolean;
  /** 아이폰 안내를 닫았음 */
  closed: boolean;
}

export const isIos = (ua: string) => /iPhone|iPad|iPod/i.test(ua);

export function isStandalone(win: Window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return win.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
}

export function installView(f: InstallFacts): InstallView {
  if (f.standalone || f.kakao) return { show: false };
  if (f.justInstalled) return { show: true, kind: 'installed', text: '설치됐어요. 홈 화면의 "써브웨이" 아이콘으로 열어 주세요', button: false, close: true };
  if (f.canPrompt) return { show: true, kind: 'android', text: '앱으로 설치하면 홈 화면에서 바로 열 수 있어요', button: true, close: false };
  if (isIos(f.userAgent) && !f.closed)
    return { show: true, kind: 'ios', text: '홈 화면에 추가하기: 공유 버튼(□↑) → "홈 화면에 추가" → "추가"를 눌러 주세요', button: false, close: true };
  return { show: false };
}
