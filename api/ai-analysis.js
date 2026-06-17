// api/ai-analysis.js — Claude AI로 시장 심리 해석

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { score, kospiChg, usdkrw } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ai-analysis: ANTHROPIC_API_KEY 환경변수가 설정되지 않음');
    return res.status(500).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 빠르고 저렴한 모델
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `오늘 한국 주식시장 상황입니다:
- K-공탐지수(공포탐욕지수): ${score}점
- KOSPI 등락률: ${kospiChg > 0 ? '+' : ''}${kospiChg}%
- 원달러 환율: ${usdkrw}원

이 데이터를 바탕으로 오늘 시장 투자 심리를 2문장으로 간결하게 한국어로 설명해주세요.
투자 권유 없이 중립적으로, 일반 투자자가 이해하기 쉽게 작성해주세요.`
        }]
      })
    });

    const d = await r.json();

    if (!r.ok) {
      // Anthropic API가 에러를 반환한 경우 (크레딧 부족, 키 오류, rate limit 등)
      // d.error.type 예: invalid_request_error, authentication_error, rate_limit_error, overloaded_error 등
      console.error(
        `ai-analysis: Anthropic API 오류 (status=${r.status})`,
        d.error?.type, d.error?.message
      );
      return res.status(502).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
    }

    const text = d.content?.[0]?.text;
    if (!text) {
      console.error('ai-analysis: 응답에 text 없음', JSON.stringify(d).slice(0, 300));
      return res.status(502).json({ text: '시장 분석 데이터를 불러올 수 없습니다.' });
    }

    res.status(200).json({ text });

  } catch (e) {
    console.error('ai-analysis: 요청 처리 중 예외 발생', e.message);
    res.status(500).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
  }
}
