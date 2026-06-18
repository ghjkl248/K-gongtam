// api/send-message.js — 대화방 메시지 저장 + 최근 100개만 유지(그 이전은 자동 삭제)
//
// 기존 방식(클라이언트가 Firebase에 직접 POST)은 "오래된 메시지 정리"를 클라이언트에서
// 처리해야 해서, 여러 사람이 동시에 채팅할 때 경쟁 상태(race condition)로 메시지가
// 꼬이거나 중복 삭제될 위험이 있음. 이 서버리스 함수가 정리를 전담하도록 분리함.
//
// 동작:
// 1) 새 메시지를 messages 노드에 추가
// 2) 전체 메시지 개수를 조회해서 100개를 초과하면, 오래된 것부터 초과분만큼 삭제
//    (ts 기준 오름차순 정렬 후 앞에서부터 제거)

const FIREBASE_URL = 'https://k-gongtam-default-rtdb.firebaseio.com';
const MAX_MESSAGES = 100;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  try {
    const { nick, text, time } = req.body || {};
    const safeNick = typeof nick === 'string' ? nick.trim().slice(0, 20) : '';
    const safeText = typeof text === 'string' ? text.trim().slice(0, 300) : '';

    if (!safeNick || !safeText) {
      return res.status(400).json({ ok: false, error: 'nick과 text는 필수입니다' });
    }

    const msg = { nick: safeNick, text: safeText, time: time || '', ts: Date.now() };

    // 1) 새 메시지 추가
    const postRes = await fetch(`${FIREBASE_URL}/messages.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!postRes.ok) {
      console.error('send-message: 메시지 저장 실패', postRes.status);
      return res.status(502).json({ ok: false, error: '메시지 저장 실패' });
    }
    const { name: newKey } = await postRes.json(); // Firebase가 생성한 push key

    // 2) 100개 초과 시 오래된 것부터 정리 (실패해도 메시지 저장 자체는 이미 성공했으므로 무시 가능)
    try {
      await pruneOldMessages();
    } catch (pruneErr) {
      console.error('send-message: 오래된 메시지 정리 실패(무시함):', pruneErr.message);
    }

    res.status(200).json({ ok: true, key: newKey, msg });
  } catch (e) {
    console.error('send-message 핸들러 예외:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}

async function pruneOldMessages() {
  // ts 기준 오름차순으로 가장 오래된 것부터 가져옴. orderBy="ts"는 Firebase 색인 규칙이
  // 없어도 동작하지만 데이터가 매우 많아지면 느려질 수 있어 limitToFirst로 필요한 만큼만 조회.
  const countRes = await fetch(`${FIREBASE_URL}/messages.json?shallow=true`);
  if (!countRes.ok) throw new Error('shallow count fetch failed: ' + countRes.status);
  const shallow = await countRes.json();
  const total = shallow ? Object.keys(shallow).length : 0;

  if (total <= MAX_MESSAGES) return; // 정리할 필요 없음

  const overflow = total - MAX_MESSAGES;
  const oldestRes = await fetch(
    `${FIREBASE_URL}/messages.json?orderBy="ts"&limitToFirst=${overflow}`
  );
  if (!oldestRes.ok) throw new Error('oldest fetch failed: ' + oldestRes.status);
  const oldest = await oldestRes.json();
  if (!oldest) return;

  const keysToDelete = Object.keys(oldest);
  // Firebase REST API는 멀티-경로 PATCH로 여러 키를 한 번에 null 처리(=삭제) 가능
  const patchBody = {};
  for (const k of keysToDelete) patchBody[k] = null;

  const delRes = await fetch(`${FIREBASE_URL}/messages.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  if (!delRes.ok) throw new Error('prune patch failed: ' + delRes.status);
}
