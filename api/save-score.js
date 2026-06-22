// api/save-score.js — 오늘의 K-공탐지수 점수를 Firebase에 저장 (7일 히스토리용)
//
// 보안 강화: Firebase 규칙에서 scoreHistory 쓰기를 "FIREBASE_WRITE_SECRET 환경변수와 일치하는
// auth 파라미터가 있을 때만 허용"으로 좁혀둠. 이 시크릿은 Vercel 서버에만 있고 브라우저에는
// 절대 노출되지 않으므로, 클라이언트가 직접 Firebase에 쓰는 것은 불가능해짐(읽기는 계속 공개).
// Firebase 콘솔의 보안 경고("messages"/"presence"는 기능 제거로 더 이상 안 씀, scoreHistory도
// 이제 비밀키 없이는 쓰기 불가)에 대응하기 위함.

const FIREBASE_URL = 'https://k-gongtam-default-rtdb.firebaseio.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { score } = req.body || {};
    if (typeof score !== 'number' || Number.isNaN(score)) {
      return res.status(400).json({ ok: false, error: 'invalid score' });
    }

    // KST 기준 오늘 날짜
    const kstNow = new Date(Date.now() + 9 * 3600000);
    const today = kstNow.toISOString().slice(0, 10); // YYYY-MM-DD

    const secret = process.env.FIREBASE_WRITE_SECRET;
    const authParam = secret ? `?auth=${encodeURIComponent(secret)}` : '';

    const r = await fetch(`${FIREBASE_URL}/scoreHistory/${today}.json${authParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Math.round(score)),
    });

    if (!r.ok) {
      console.error('save-score: Firebase 저장 실패', r.status);
      return res.status(502).json({ ok: false });
    }

    res.status(200).json({ ok: true, date: today, score: Math.round(score) });
  } catch (e) {
    console.error('save-score 에러:', e.message);
    res.status(500).json({ ok: false });
  }
}
