// api/ai-analysis.js — Claude AI로 시장 심리 해석 (실시간 뉴스 반영)
//
// 기존엔 점수/등락률/환율 숫자 3개만 주고 해석을 만들게 해서, 매일 거의 비슷한 톤의
// 문장만 나오는 문제가 있었음("앱이 죽어있는 것처럼 느껴진다"는 피드백의 원인).
// web_search 도구를 켜서 Claude가 그날 실제 코스피/증시 관련 뉴스를 직접 찾아본 뒤
// 해석에 반영하도록 바꿈 — 매일 실제 이슈가 달라지므로 콘텐츠가 자연스럽게 갱신됨.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).end();

  const { score, kospiChg, usdkrw } = req.body || {};

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ai-analysis: ANTHROPIC_API_KEY 환경변수가 설정되지 않음');
    return res.status(500).json({ text: 'AI 분석 일시 불가. 잠시 후 새로고침해 주세요.' });
  }

  try {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // 빠르고 저렴한 모델 (웹 검색 도구도 지원)
        max_tokens: 400, // 검색 도구 사용 시 중간 추론 토큰이 더 필요해 여유를 둠
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages: [{
          role: 'user',
          content: `오늘(${today}) 한국 주식시장 상황입니다:
- K-공탐지수(공포탐욕지수): ${score}점
- KOSPI 등락률: ${kospiChg > 0 ? '+' : ''}${kospiChg}%
- 원달러 환율: ${usdkrw}원

오늘 코스피·코스닥 시장에 영향을 준 실제 뉴스나 이슈(반도체, 수급, 정책, 미국 증시 영향 등)를
1번만 검색해서 확인한 뒤, 그 내용을 반영해서 오늘 시장 분위기를 2문장으로 간결하게
한국어로 설명해주세요. 구체적인 이슈를 한 문장에 자연스럽게 녹여주세요.
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

    // 웹 검색 도구를 쓰면 응답에 tool_use/tool_result 블록이 섞여서 오므로,
    // type이 'text'인 블록만 모아서 최종 해석 문장을 구성함
    const text = (d.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join(' ')
      .trim();

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
