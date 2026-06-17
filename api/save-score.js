// api/save-score.js — 오늘의 K-공탐지수 점수를 Firebase에 저장 (7일 히스토리용)

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

    const r = await fetch(`${FIREBASE_URL}/scoreHistory/${today}.json`, {
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
