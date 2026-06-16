# K-공탐지수 — 배포 가이드

한국 코스피 공포탐욕지수 웹앱. 5분 만에 전 세계 공개 배포 가능.

---

## 1단계 — GitHub에 올리기 (3분)

1. [github.com](https://github.com) 회원가입 (무료)
2. 우상단 `+` → `New repository`
3. 이름: `k-gongtam` 입력 → `Create repository`
4. 이 폴더 전체를 드래그해서 업로드 (또는 git 명령어)

```bash
git init
git add .
git commit -m "K-공탐지수 첫 배포"
git remote add origin https://github.com/내아이디/k-gongtam.git
git push -u origin main
```

---

## 2단계 — Vercel 배포 (2분)

1. [vercel.com](https://vercel.com) 접속 → GitHub으로 로그인
2. `New Project` → `k-gongtam` 선택 → `Import`
3. **Environment Variables** 섹션에서 추가:
   - Key: `ANTHROPIC_API_KEY`
   - Value: Anthropic API 키 (console.anthropic.com에서 발급)
4. `Deploy` 클릭

→ 30초 후 `k-gongtam.vercel.app` URL 자동 생성!

---

## 3단계 — 도메인 연결 (선택, 월 2~5달러)

1. Vercel 프로젝트 → `Settings` → `Domains`
2. 원하는 도메인 입력 (예: `kgongtam.com`)
3. 도메인 구매 후 DNS 설정

---

## 4단계 — 광고 달기 (Google AdSense)

1. [adsense.google.com](https://adsense.google.com) 신청
2. `public/index.html` 상단 `<head>`에 AdSense 스크립트 추가
3. 승인 후 자동 광고 활성화

---

## 업데이트 주기

| 시간대 | 갱신 주기 |
|--------|----------|
| 장중 (09:00~15:30) | 5분마다 자동 |
| 장외 (15:30~09:00) | 30분마다 자동 |
| 미국 장 중 (22:30~05:00) | 30분마다 자동 |

---

## 폴더 구조

```
kgongtam/
├── public/
│   ├── index.html      ← 메인 앱 (게이지, 대화방, 범례)
│   └── manifest.json   ← PWA 설정 (홈 화면 앱 등록)
├── api/
│   ├── market.js       ← 시장 데이터 (네이버 금융, Yahoo Finance)
│   └── ai-analysis.js  ← AI 해석 (Claude Haiku)
├── vercel.json         ← Vercel 배포 설정
└── README.md
```

---

## 비용 (월간)

| 항목 | 비용 |
|------|------|
| Vercel 호스팅 | 무료 |
| Claude API (AI 해석) | 약 $1~5/월 (하루 1,000명 기준) |
| 도메인 | 약 $10~15/년 (선택) |
| 합계 | 거의 무료 |

---

## 수익화 (나중에)

- Google AdSense 자동광고
- 프리미엄 기능 구독 (푸시알림, 종목 신호)
- 카카오 채널 연동

투자 판단의 책임은 사용자 본인에게 있습니다.
